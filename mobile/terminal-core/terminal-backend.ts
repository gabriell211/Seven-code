/** Interface entre o workbench xterm.js e motores específicos de cada sistema. */
export type TerminalTarget = 'android-local' | 'ios-local' | 'remote-ssh';

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface TerminalOutput {
  readonly kind: 'data' | 'exit' | 'error';
  readonly data?: Uint8Array;
  readonly exitCode?: number | null;
  readonly message?: string;
}

export interface SevenTerminalBackend {
  readonly target: TerminalTarget;
  start(dimensions: TerminalDimensions, onOutput: (event: TerminalOutput) => void): Promise<void>;
  input(bytes: Uint8Array): Promise<void>;
  resize(dimensions: TerminalDimensions): Promise<void>;
  dispose(): Promise<void>;
}

export function assertTerminalDimensions(value: TerminalDimensions): void {
  if (!Number.isSafeInteger(value.columns) || !Number.isSafeInteger(value.rows)
      || value.columns < 1 || value.columns > 1000
      || value.rows < 1 || value.rows > 1000) {
    throw new RangeError('Terminal size must be 1..1000 columns and rows');
  }
}

/** Não deixa o cliente web acionar processos sem um host nativo explicitamente presente. */
export function resolveTerminalTarget(platform: string, localEnabled: boolean): TerminalTarget {
  if (localEnabled && platform === 'android') return 'android-local';
  if (localEnabled && platform === 'ios') return 'ios-local';
  return 'remote-ssh';
}
