import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { SevenCommandTool, type CommandToolRequest, type CommandToolResult, type CommandToolEvent } from '../../terminal-core/ai-terminal-tool';

interface NativeMessage { type: string; value?: string; requestId?: string; approved?: boolean; exitCode?: number | null; output?: string; truncated?: boolean; error?: string }
interface NativeBridge { postMessage(message: string): void }
declare global {
  interface Window {
    SevenTerminalNative?: NativeBridge;
    sevenNativeEvent?: (message: NativeMessage) => void;
    SevenCodeTerminalTools?: Readonly<{
      execute_command: (request: CommandToolRequest) => Promise<CommandToolResult>;
    }>;
  }
}
const terminalElement = document.getElementById('terminal');
if (!terminalElement) throw new Error('Terminal container missing');

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  lineHeight: 1.35,
  scrollback: 3000,
  allowTransparency: false,
  theme: {
    background: '#0B1124',
    foreground: '#E7E9FA',
    cursor: '#09e5ef',
    selectionBackground: '#7955e955'
  }
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(terminalElement);

const encoder = new TextEncoder();
const commandTool = window.SevenTerminalNative ? new SevenCommandTool(window.SevenTerminalNative) : null;
if (commandTool) {
  // Trusted host adapter for future Seven Code AI model tool integration.
  // Android will show a native permission dialog before every command.
  window.SevenCodeTerminalTools = Object.freeze({
    execute_command: (request: CommandToolRequest) => commandTool.executeCommand(request)
  });
}
window.addEventListener('pagehide', () => commandTool?.dispose());
const send = (payload: object) => window.SevenTerminalNative?.postMessage(JSON.stringify(payload));
const b64 = (bytes: Uint8Array) => {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
};
const bytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0));

window.sevenNativeEvent = (message) => {
  if (message.type === 'ai-result') {
    commandTool?.handleEvent(message as CommandToolEvent);
    return;
  }
  if (message.type === 'data' && message.value) term.write(bytes(message.value));
  if (message.type === 'error') term.writeln('\r\n\x1b[31m' + (message.value ?? 'Erro') + '\x1b[0m');
  if (message.type === 'exit') term.writeln('\r\n\x1b[33mSessão encerrada\x1b[0m');
};

term.onData(data => {
  const raw = encoder.encode(data);
  // Android native session validates maximum input size.
  if (raw.byteLength <= 65536) send({type: 'input', data: b64(raw)});
});

function resize(): void {
  fit.fit();
  if (term.cols >= 1 && term.rows >= 1) send({type:'resize', cols: term.cols, rows: term.rows});
}
const viewport = window.visualViewport;
viewport?.addEventListener('resize', resize);
window.addEventListener('resize', resize);
document.querySelectorAll<HTMLButtonElement>('button[data-key]').forEach(button => {
  button.addEventListener('click', () => {
    const shortcuts: Record<string, string> = {
      esc: '\\x1b', tab: '\\t', ctrlc: '\\x03',
      up: '\\x1b[A', down: '\\x1b[B', left: '\\x1b[D', right: '\\x1b[C'
    };
    const key = shortcuts[button.dataset.key ?? ''];
    if (key) send({type:'input', data:b64(encoder.encode(key))});
    term.focus();
  });
});
requestAnimationFrame(() => {
  fit.fit();
  if (!window.SevenTerminalNative) {
    term.writeln('\x1b[33mExecute este terminal pelo APK Seven Code Android.\x1b[0m');
    return;
  }
  send({type:'start', cols:term.cols, rows:term.rows});
  term.focus();
});
