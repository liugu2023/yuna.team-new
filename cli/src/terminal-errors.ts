import type { Writable } from "node:stream";

const terminalOutputs = new WeakSet<Writable>();

/** The full-screen session handles this stream's errors and restores raw input. */
export function isTerminalOutputOwned(stream: Writable): boolean {
  return terminalOutputs.has(stream);
}

export function claimTerminalOutput(stream: Writable): () => void {
  if (terminalOutputs.has(stream)) throw new Error("终端已被另一个交互会话使用。");
  terminalOutputs.add(stream);
  return () => { terminalOutputs.delete(stream); };
}
