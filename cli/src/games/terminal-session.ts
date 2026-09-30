import { emitKeypressEvents } from "node:readline";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { truncateWidth } from "../ui.js";
import { claimTerminalOutput } from "../terminal-errors.js";

export interface TerminalKey {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export type TerminalInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

export type TerminalOutput = Writable & {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
};

export interface TerminalSessionOptions {
  render: (columns: number, rows: number) => string;
  onKey: (key: TerminalKey) => "exit" | void;
  /** Requests from asynchronous game updates are safe even after the session exits. */
  onReady?: (redraw: () => void) => void;
  input?: TerminalInput;
  output?: TerminalOutput;
}

/** Owns raw input and the alternate screen only for the duration of a game. */
export async function runTerminalSession(options: TerminalSessionOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("小游戏需要交互式终端，请直接在终端中运行，不要重定向输入或输出。");
  }

  const setRawMode = input.setRawMode.bind(input);
  const wasRaw = Boolean(input.isRaw);
  const wasFlowing = input.readableFlowing === true;
  // readline keeps a decoder and generator on its input. Give it a private
  // stream, so ending this session removes all parsing state along with it.
  const keyboard = new PassThrough();

  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let enteredScreen = false;
    let touchedRawMode = false;
    let outputUsable = true;
    let settled = false;
    let blocked = false;
    let releaseOutput: (() => void) | undefined;
    let finishError: unknown;
    type Frame = { lines: string[]; columns: number; rows: number };
    let lastFrame: Frame | undefined;
    let pendingFrame: Frame | undefined;

    const complete = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      // Error listeners run synchronously in registration order. Keep ownership
      // until the current dispatch ends, including listeners installed after us.
      queueMicrotask(() => {
        output.removeListener("error", onOutputError);
        output.removeListener("close", onOutputClose);
        releaseOutput?.();
      });
      const failure = finishError !== undefined ? finishError : error;
      if (failure !== undefined) reject(failure);
      else resolve();
    };

    const finish = (error?: unknown, exitCode?: number): void => {
      if (finished) return;
      finished = true;
      pendingFrame = undefined;
      input.removeListener("data", onData);
      input.removeListener("error", onInputError);
      input.removeListener("end", onInputEnd);
      input.removeListener("close", onInputEnd);
      output.removeListener("resize", onResize);
      output.removeListener("drain", onDrain);
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      keyboard.removeAllListeners();
      keyboard.destroy();

      let cleanupError: unknown;
      try {
        if (touchedRawMode) setRawMode(wasRaw);
      } catch (cause) {
        cleanupError = cause;
      }
      try {
        if (wasFlowing) input.resume();
        else input.pause();
      } catch (cause) {
        cleanupError ??= cause;
      }
      if (exitCode !== undefined) process.exitCode = exitCode;
      finishError = error !== undefined ? error : cleanupError;
      if (!enteredScreen || !outputUsable) { complete(); return; }
      try {
        // This small restore sequence follows any accepted frame, even under
        // backpressure. Wait for its callback before returning to the CLI.
        output.write("\x1b[0m\x1b[?25h\x1b[?1049l", error => {
          if (!error) { complete(); return; }
          outputUsable = false;
          finishError ??= error;
          // Writable may emit its error after invoking the write callback.
          // Retain ownership for that event, with a fallback for destroyed streams.
          setImmediate(() => complete());
        });
      } catch (cause) {
        complete(cause);
      }
    };

    const flush = (): void => {
      if (finished || blocked || !pendingFrame) return;
      const frame = pendingFrame;
      pendingFrame = undefined;
      const full = !lastFrame || lastFrame.columns !== frame.columns || lastFrame.rows !== frame.rows;
      let update = "";
      if (full) {
        update = `\x1b[H${frame.lines.map(line => `${line}\x1b[0m\x1b[K`).join("\r\n")}\x1b[J`;
      } else {
        for (let row = 0; row < frame.lines.length; row++) {
          if (frame.lines[row] !== lastFrame!.lines[row]) {
            update += `\x1b[${row + 1};1H${frame.lines[row]}\x1b[0m\x1b[K`;
          }
        }
        if (frame.lines.length < lastFrame!.lines.length) update += `\x1b[${frame.lines.length + 1};1H\x1b[0m\x1b[J`;
      }
      if (!update) return;
      lastFrame = frame;
      blocked = !output.write(update);
    };

    const redraw = (): void => {
      if (finished) return;
      try {
        const columns = Math.max(1, Math.floor(output.columns || 80));
        const rows = Math.max(1, Math.floor(output.rows || 24));
        // Leave the last column empty to avoid delayed autowrap on narrow TTYs.
        const lines = options.render(columns, rows).split(/\r?\n/).slice(0, rows)
          .map((line) => truncateWidth(line.replace(/\r/g, "").replace(/\t/g, "  "), columns - 1));
        // Keep processing every input, but retain only the latest unsent view.
        pendingFrame = { lines, columns, rows };
        flush();
      } catch (error) {
        finish(error);
      }
    };
    const onDrain = (): void => {
      if (finished) return;
      blocked = false;
      try { flush(); } catch (error) { finish(error); }
    };
    const onResize = (): void => {
      lastFrame = undefined;
      redraw();
    };
    const onKey = (_text: string | undefined, key: TerminalKey = {}): void => {
      if (finished) return;
      if (key.ctrl && key.name === "c") {
        finish(undefined, 130);
        return;
      }
      try {
        const result = options.onKey(key);
        if (result === "exit") finish();
        else redraw();
      } catch (error) {
        finish(error);
      }
    };
    const onData = (chunk: Buffer | string): void => { keyboard.write(chunk); };
    const onInputError = (error: Error): void => { finish(error); };
    const onInputEnd = (): void => { finish(); };
    const onOutputError = (error: Error): void => {
      outputUsable = false;
      if (finished) complete(error);
      else finish(error);
    };
    const onOutputClose = (): void => {
      outputUsable = false;
      if (finished) complete();
      else finish();
    };
    const onInterrupt = (): void => { finish(undefined, 130); };
    const onTerminate = (): void => { finish(undefined, 143); };

    try {
      releaseOutput = claimTerminalOutput(output);
      output.on("error", onOutputError);
      output.on("close", onOutputClose);
      output.on("drain", onDrain);
      emitKeypressEvents(keyboard);
      keyboard.on("keypress", onKey);
      input.on("data", onData);
      input.on("error", onInputError);
      input.on("end", onInputEnd);
      input.on("close", onInputEnd);
      output.on("resize", onResize);
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
      touchedRawMode = true;
      setRawMode(true);
      enteredScreen = true;
      blocked = !output.write("\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H");
      redraw();
      if (finished) return;
      input.resume();
      if (!finished) options.onReady?.(redraw);
    } catch (error) {
      finish(error);
    }
  });
}
