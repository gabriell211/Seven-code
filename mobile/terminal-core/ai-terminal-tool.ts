/**
 * Same execute_command tool contract for Windows/PowerShell, macOS/Linux shells,
 * Android local PTY, and iOS embedded commands.
 *
 * On native mobile hosts approval MUST occur inside the trusted native UI.
 * This module only transports requests/results; it cannot grant permissions.
 */
export type TerminalPlatform = 'windows' | 'linux' | 'macos' | 'android' | 'ios';

export interface CommandToolRequest {
  readonly requestId: string;
  readonly command: string;
  readonly timeoutMs?: number;
}

export interface CommandToolResult {
  readonly requestId: string;
  readonly approved: boolean;
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
  readonly error?: string;
}

export interface NativeTerminalTransport {
  postMessage(data: string): void;
}

export interface CommandToolEvent {
  readonly type: 'ai-result';
  readonly requestId: string;
  readonly approved: boolean;
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
  readonly error?: string;
}

type Pending = {
  resolve: (result: CommandToolResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class SevenCommandTool {
  private readonly pending = new Map<string, Pending>();
  private disposed = false;

  private readonly transport: NativeTerminalTransport;
  constructor(transport: NativeTerminalTransport) {
    this.transport = transport;
  }

  executeCommand(request: CommandToolRequest): Promise<CommandToolResult> {
    if (this.disposed) return Promise.reject(new Error('Terminal tool disposed'));
    const { requestId, command } = request;
    const timeout = request.timeoutMs ?? 60_000;

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestId)) {
      return Promise.reject(new TypeError('Invalid request ID'));
    }
    if (command.trim().length === 0 || command.length > 4096 || command.includes('\0')) {
      return Promise.reject(new TypeError('Invalid command'));
    }
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 120_000) {
      return Promise.reject(new RangeError('Timeout must be 1000..120000 ms'));
    }
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error('Duplicate request ID'));
    }
    if (this.pending.size >= 1) {
      return Promise.reject(new Error('Wait for the previous command to finish'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        // Native process uses its own timeout as well.
        reject(new Error('Terminal command timed out'));
      }, timeout + 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.transport.postMessage(JSON.stringify({
          type: 'ai-propose', requestId, command, timeoutMs: timeout
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error('Terminal transport failure'));
      }
    });
  }

  handleEvent(message: CommandToolEvent): boolean {
    if (message.type !== 'ai-result') return false;
    const item = this.pending.get(message.requestId);
    if (!item) return false;
    clearTimeout(item.timer);
    this.pending.delete(message.requestId);
    item.resolve({
      requestId: message.requestId,
      approved: message.approved,
      exitCode: Number.isInteger(message.exitCode) ? message.exitCode : null,
      output: String(message.output ?? '').slice(0, 131072),
      truncated: Boolean(message.truncated),
      ...(message.error ? { error: String(message.error) } : {})
    });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('Terminal tool disposed'));
    }
    this.pending.clear();
  }
}
