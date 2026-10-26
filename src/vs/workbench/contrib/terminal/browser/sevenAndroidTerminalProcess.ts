/*---------------------------------------------------------------------------------------------
 * Seven Code Android terminal adapter. Other Code OSS platforms remain unchanged.
 * Licensed under the MIT License. See LICENSE.txt in the project root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	type IProcessProperty, type IProcessReadyEvent, type ITerminalChildProcess,
	type ITerminalLaunchError, type IProcessPropertyMap, ProcessPropertyType
} from '../../../../platform/terminal/common/terminal.js';

const CHANNEL = 'seven-code-mobile-terminal-v1';
const MAX_PENDING_INPUT = 131072;
const MAX_MESSAGE_BYTES = 48000;

interface NativeTerminalHost {
	postMessage(message: string): void;
}
interface AndroidTerminalWindow extends Window {
	SevenTerminalNative?: NativeTerminalHost;
}
interface NativeTerminalEvent {
	type: string;
	sessionId?: string;
	value?: string;
	pid?: number;
	cwd?: string;
	exitCode?: number | null;
}

/** True only in the app's origin-scoped Android WebView (never on desktop/browser). */
export function hasSevenAndroidTerminal(): boolean {
	return typeof window !== 'undefined' &&
		typeof BroadcastChannel !== 'undefined' &&
		typeof (window as AndroidTerminalWindow).SevenTerminalNative?.postMessage === 'function';
}

/**
 * Implements the original VS Code ITerminalChildProcess contract in the browser.
 * Programmatic window.createTerminal/sendText (including extension tools) use the
 * same renderer terminal instance; only the PTY transport changes to Android.
 * Each native session requires approval in MainActivity before shell startup.
 */
export class SevenAndroidTerminalProcess extends Disposable implements ITerminalChildProcess {
	readonly id = 0;
	readonly shouldPersist = false;

	private readonly _onProcessData = this._register(new Emitter<string>());
	readonly onProcessData: Event<string> = this._onProcessData.event;
	private readonly _onProcessReady = this._register(new Emitter<IProcessReadyEvent>());
	readonly onProcessReady: Event<IProcessReadyEvent> = this._onProcessReady.event;
	private readonly _onDidChangeProperty = this._register(new Emitter<IProcessProperty>());
	readonly onDidChangeProperty: Event<IProcessProperty> = this._onDidChangeProperty.event;
	private readonly _onProcessExit = this._register(new Emitter<number | undefined>());
	readonly onProcessExit: Event<number | undefined> = this._onProcessExit.event;

	private readonly sessionId = crypto.randomUUID().replace(/-/g, '');
	private readonly decoder = new TextDecoder();
	private readonly channel: BroadcastChannel;
	private readonly queuedInput: Uint8Array[] = [];
	private pendingBytes = 0;
	private ready = false;
	private closed = false;
	private cwd = '';
	private dimensions: { cols: number; rows: number } | undefined;
	private startResolve: ((error: ITerminalLaunchError | undefined) => void) | undefined;
	private startPromise: Promise<ITerminalLaunchError | undefined> | undefined;
	private readonly startTimers: Array<ReturnType<typeof setTimeout>> = [];

	private finishStart(error: ITerminalLaunchError | undefined): void {
		for (const timer of this.startTimers) {
			clearTimeout(timer);
		}
		this.startTimers.length = 0;
		const resolve = this.startResolve;
		this.startResolve = undefined;
		resolve?.(error);
	}

	constructor(private readonly cols: number, private readonly rows: number) {
		super();
		if (!hasSevenAndroidTerminal()) {
			throw new Error('Seven Code Android PTY requires the trusted native WebView');
		}
		this.channel = new BroadcastChannel(CHANNEL);
		this.channel.onmessage = event => this.receive(event.data);
	}

	private send(type: string, data: Record<string, unknown> = {}): void {
		if (this.closed) {
			return;
		}
		(window as AndroidTerminalWindow).SevenTerminalNative?.postMessage(
			JSON.stringify({ type, sessionId: this.sessionId, ...data })
		);
	}

	private receive(input: unknown): void {
		if (this.closed || !input || typeof input !== 'object') {
			return;
		}
		const event = input as NativeTerminalEvent;
		if (event.sessionId !== this.sessionId) {
			return;
		}
		switch (event.type) {
			case 'ready':
				if (this.ready) {
					return;
				}
				this.ready = true;
				this.finishStart(undefined);
				this.cwd = typeof event.cwd === 'string' && event.cwd.startsWith('/') && event.cwd.length < 1024 ? event.cwd : '/';
				if (this.dimensions) {
					this.send('resize', this.dimensions);
					this.dimensions = undefined;
				}
				for (const pending of this.queuedInput) {
					this.sendInput(pending);
				}
				this.queuedInput.length = 0;
				this.pendingBytes = 0;
				// The terminal manager flushes its own queued commands upon
				// onProcessReady. Preserve original ordering by flushing this
				// adapter's older queued input first.
				this._onProcessReady.fire({
					pid: Number.isSafeInteger(event.pid) && (event.pid ?? 0) > 1 ? event.pid! : 0,
					cwd: this.cwd,
					windowsPty: undefined,
				});
				this._onProcessData.fire('[Seven Code] Shell Android conectado.\r\n');
				break;
			case 'data':
				if (typeof event.value === 'string' && event.value.length <= 100_000) {
					try {
						const bytes = Uint8Array.from(atob(event.value), char => char.charCodeAt(0));
						this._onProcessData.fire(this.decoder.decode(bytes, { stream: true }));
					} catch {
						this._onProcessData.fire('\r\n[Seven Code] Invalid Android terminal output\r\n');
					}
				}
				break;
			case 'error': {
				const detail = typeof event.value === 'string' ? event.value.slice(0, 1000) : 'Android PTY failed';
				this._onProcessData.fire('\r\n[Seven Code] ' + detail + '\r\n');
				if (!this.ready) {
					this.finishStart({ message: 'Seven Code Android: ' + detail });
				}
				break;
			}
			case 'exit':
				if (!this.ready) {
					this.finishStart({ message: 'O shell Android encerrou antes de ficar pronto.' });
				}
				this._onProcessData.fire(this.decoder.decode());
				this._onProcessExit.fire(typeof event.exitCode === 'number' ? event.exitCode : undefined);
				this.dispose();
				break;
		}
	}

	async start(): Promise<ITerminalLaunchError | undefined> {
		if (this.closed || !hasSevenAndroidTerminal()) {
			return { message: 'Android terminal host is unavailable' };
		}
		if (this.startPromise) {
			return this.startPromise;
		}
		this.startPromise = new Promise<ITerminalLaunchError | undefined>(resolve => {
			this.startResolve = resolve;
		});
		const dimensions = { cols: this.clamp(this.cols), rows: this.clamp(this.rows) };
		// Return only after the native host confirms a real PTY. Previously
		// we resolved immediately, leaving a permanently empty terminal if
		// the first WebView message raced bridge initialization.
		this._onProcessData.fire('[Seven Code] Solicitando shell Android; confirme o diálogo do sistema.\r\n');
		this.send('start', dimensions);
		// MainActivity deduplicates by sessionId across pending and active PTYs.
		// Never replay input or create a second shell during these retries.
		for (const delay of [1200, 3500, 8000]) {
			this.startTimers.push(setTimeout(() => {
				if (!this.closed && !this.ready) {
					this.send('start', dimensions);
				}
			}, delay));
		}
		this.startTimers.push(setTimeout(() => {
			if (this.closed || this.ready) {
				return;
			}
			const error = { message: 'Sem resposta do terminal Android. Verifique a permissão nativa e reabra o terminal.' };
			this._onProcessData.fire('\r\n[Seven Code] ' + error.message + '\r\n');
			this.finishStart(error);
			this.send('close');
			this.dispose();
		}, 30000));
		return this.startPromise;
	}

	private clamp(value: number): number {
		return Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.round(value))) : 80;
	}

	private sendInput(bytes: Uint8Array): void {
		for (let index = 0; index < bytes.length; index += MAX_MESSAGE_BYTES) {
			const chunk = bytes.subarray(index, index + MAX_MESSAGE_BYTES);
			let binary = '';
			for (const byte of chunk) {
				binary += String.fromCharCode(byte);
			}
			this.send('input', { data: btoa(binary) });
		}
	}

	input(value: string): void {
		if (this.closed) {
			return;
		}
		const bytes = new TextEncoder().encode(value);
		if (!this.ready) {
			if (this.pendingBytes + bytes.length > MAX_PENDING_INPUT) {
				this._onProcessData.fire('\r\n[Seven Code] Command queue exceeded its safe limit; terminal terminated.\r\n');
				this.shutdown(true);
				return;
			}
			this.queuedInput.push(bytes);
			this.pendingBytes += bytes.length;
			return;
		}
		this.sendInput(bytes);
	}

	sendSignal(signal: string): void {
		if (signal === 'SIGINT') {
			this.input('\u0003');
		} else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
			this.shutdown(true);
		}
	}

	async processBinary(data: string): Promise<void> {
		this.input(data);
	}

	resize(cols: number, rows: number): void {
		if (this.closed || !Number.isFinite(cols) || !Number.isFinite(rows)) {
			return;
		}
		const dimensions = { cols: this.clamp(cols), rows: this.clamp(rows) };
		if (!this.ready) {
			this.dimensions = dimensions;
		} else {
			this.send('resize', dimensions);
		}
	}

	shutdown(_immediate: boolean): void {
		this.send('close');
		this.dispose();
	}

	clearBuffer(): void {}
	acknowledgeDataEvent(_charCount: number): void {}
	async setUnicodeVersion(_version: '6' | '11'): Promise<void> {}
	async getInitialCwd(): Promise<string> { return this.cwd; }
	async getCwd(): Promise<string> { return this.cwd; }

	async refreshProperty<T extends ProcessPropertyType>(property: T): Promise<IProcessPropertyMap[T]> {
		if (property === ProcessPropertyType.Cwd || property === ProcessPropertyType.InitialCwd) {
			return this.cwd as IProcessPropertyMap[T];
		}
		throw new Error('Android PTY does not support this property');
	}

	async updateProperty<T extends ProcessPropertyType>(_property: T, _value: IProcessPropertyMap[T]): Promise<void> {}

	override dispose(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.finishStart({ message: 'O terminal Android foi encerrado antes de iniciar.' });
		this.queuedInput.length = 0;
		this.pendingBytes = 0;
		this.channel.close();
		super.dispose();
	}
}
