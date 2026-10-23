import { ALL_FEATURES } from '../capabilities/feature-catalog.ts';
import type { FeatureExecutor, FeatureRequest } from '../capabilities/feature-dispatcher.ts';

/** Narrow injection surface so transport can be tested without browser/network. */
export interface RemoteSocket {
  send(value: string): void;
  close(): void;
  addEventListener(
    kind: 'open' | 'message' | 'close' | 'error',
    handler: (event: { readonly data?: unknown }) => void
  ): void;
}
export type RemoteSocketFactory = (url: string) => RemoteSocket;

type Phase = 'disconnected' | 'connecting' | 'ready' | 'closed';
type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export interface WorkspaceRemoteState {
  readonly connected: boolean;
  readonly authenticated: boolean;
  readonly capabilities: readonly string[];
  readonly workspaceId: string | null;
}
const KNOWN_REMOTE_FEATURES = new Set(
  ALL_FEATURES.filter(feature => feature.remoteSupported).map(feature => feature.id)
);

/**
 * Transport-only client for future Seven Code Server.
 *
 * A real server MUST independently authenticate user/workspace permissions,
 * validate origin/session, authorize each feature/operation and sandbox tools.
 * A self-declared capability list from a non-trusted origin is not sufficient.
 * No server is shipped by this module.
 */
export class SevenWorkspaceClient implements FeatureExecutor {
  private readonly endpoint: string;
  private readonly workspaceId: string;
  private readonly socketFactory: RemoteSocketFactory;
  private phase: Phase = 'disconnected';
  private capabilities: readonly string[] = [];
  private socket: RemoteSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private handshakeReject: ((error: Error) => void) | null = null;

  constructor(endpoint: string, workspaceId: string, socketFactory: RemoteSocketFactory) {
    const url = new URL(endpoint);
    if (url.protocol !== 'wss:' || !url.hostname || url.username || url.password ||
        url.hash || url.search) {
      throw new TypeError('Remote workspaces require a clean wss:// endpoint');
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) {
      throw new TypeError('Invalid workspace ID');
    }
    this.endpoint = url.href;
    this.workspaceId = workspaceId;
    this.socketFactory = socketFactory;
  }

  get state(): WorkspaceRemoteState {
    const ready = this.phase === 'ready';
    return {
      connected: ready,
      authenticated: ready,
      capabilities: ready ? this.capabilities : [],
      workspaceId: ready ? this.workspaceId : null
    };
  }

  connect(ephemeralAccessToken: string, timeoutMs = 10_000): Promise<void> {
    if (this.phase !== 'disconnected') {
      return Promise.reject(new Error('Connection already attempted'));
    }
    if (!ephemeralAccessToken || ephemeralAccessToken.length > 4096) {
      return Promise.reject(new TypeError('Invalid ephemeral token'));
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) {
      return Promise.reject(new RangeError('Invalid handshake timeout'));
    }
    this.phase = 'connecting';
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.handshakeReject = null;
        if (err) {
          this.fail(err);
          reject(err);
        } else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('Remote handshake timed out')), timeoutMs);
      this.handshakeReject = error => finish(error);
      try {
        const socket = this.socketFactory(this.endpoint);
        this.socket = socket;
        socket.addEventListener('open', () => {
          if (this.phase !== 'connecting') return;
          // Never transmit access tokens in URLs (proxies and logs retain them).
          socket.send(JSON.stringify({
            type: 'session.open', protocol: 1,
            workspaceId: this.workspaceId,
            accessToken: ephemeralAccessToken
          }));
        });
        socket.addEventListener('message', event => {
          if (typeof event.data !== 'string' || event.data.length > 262144) return;
          let message: unknown;
          try { message = JSON.parse(event.data); } catch { return; }
          if (!message || typeof message !== 'object') return;
          const m = message as Record<string, unknown>;
          if (m.type === 'session.ready' && this.phase === 'connecting') {
            if (m.protocol !== 1 || m.authenticated !== true ||
                m.workspaceId !== this.workspaceId || !Array.isArray(m.capabilities) ||
                m.capabilities.length > 512 || !m.capabilities.every(x => typeof x === 'string')) {
              finish(new Error('Remote server did not authorize this workspace'));
              return;
            }
            this.capabilities = Object.freeze([...new Set(
              m.capabilities.filter((id): id is string =>
                typeof id === 'string' && KNOWN_REMOTE_FEATURES.has(id))
            )]);
            this.phase = 'ready';
            finish();
          } else if (m.type === 'feature.result' && this.phase === 'ready') {
            if (typeof m.requestId !== 'string') return;
            const pending = this.pending.get(m.requestId);
            if (!pending) return;
            this.pending.delete(m.requestId);
            clearTimeout(pending.timer);
            if (m.ok === true) pending.resolve(m.result);
            else pending.reject(new Error(
              typeof m.error === 'string' ? m.error.slice(0, 1000) : 'Remote operation failed'
            ));
          }
        });
        socket.addEventListener('error', () => this.fail(new Error('Remote socket error')));
        socket.addEventListener('close', () => this.fail(new Error('Remote connection closed')));
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Cannot open remote connection'));
      }
    });
  }

  execute(request: FeatureRequest): Promise<unknown> {
    if (this.phase !== 'ready' || !this.socket) {
      return Promise.reject(new Error('Remote workspace unavailable'));
    }
    if (!this.capabilities.includes(request.featureId)) {
      return Promise.reject(new Error('Remote capability was not advertised'));
    }
    if (!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(request.operation) ||
        !request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) {
      return Promise.reject(new TypeError('Invalid remote operation'));
    }
    if (this.pending.size >= 8) {
      return Promise.reject(new Error('Too many concurrent remote requests'));
    }
    const requestId = 'seven-' + (++this.sequence);
    const message = JSON.stringify({
      type: 'feature.execute', protocol: 1, workspaceId: this.workspaceId,
      requestId, featureId: request.featureId,
      operation: request.operation, payload: request.payload
    });
    if (message.length > 131072) {
      return Promise.reject(new RangeError('Remote request exceeds 128 KiB'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Remote operation timed out; execution status unknown'));
      }, 60_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.socket?.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error('Cannot send operation'));
      }
    });
  }

  disconnect(): void {
    if (this.phase === 'closed') return;
    this.fail(new Error('Remote workspace disconnected'));
  }

  private fail(error: Error): void {
    if (this.phase === 'closed') return;
    const handshake = this.handshakeReject;
    this.handshakeReject = null;
    this.phase = 'closed';
    this.capabilities = [];
    const oldSocket = this.socket;
    this.socket = null;
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.pending.clear();
    try { oldSocket?.close(); } catch { /* best-effort cleanup */ }
    if (handshake) handshake(error);
  }
}
