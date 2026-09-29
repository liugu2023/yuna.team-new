// 优先使用运行时 fetch。连接超时后为只读请求重试一次，给每个地址更充足的连接时间。
// --proxy 始终使用指定代理，不会因代理失败改成直连。

import { UsageError } from "./args.js";

export type FetchLike = typeof fetch;

export interface ProxySetup {
  proxy: string;
  /** 配置成功后由 undici 接管；配置失败直接抛出错误。 */
  via: "undici";
}

interface ManagedDispatcher {
  close?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

interface UndiciRuntime {
  fetch: (input: Parameters<FetchLike>[0], init?: Omit<NonNullable<Parameters<FetchLike>[1]>, "dispatcher"> & { dispatcher?: ManagedDispatcher }) => ReturnType<FetchLike>;
  Agent: new (options: { autoSelectFamily: boolean; autoSelectFamilyAttemptTimeout: number; connect: { timeout: number } }) => ManagedDispatcher;
  ProxyAgent: new (url: string) => ManagedDispatcher;
}

const RETRYABLE_CONNECTION_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH", "EHOSTUNREACH"]);
const dispatchers = new Set<ManagedDispatcher>();
let fallbackSetup: Promise<FetchLike> | null = null;
let activeFetch: FetchLike = directFetch;

function isConnectionFailure(error: unknown, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const value = error as { name?: string; code?: string; cause?: unknown; errors?: unknown[] };
  if (value.name === "AbortError" || value.name === "TimeoutError") return false;
  if (value.code && RETRYABLE_CONNECTION_CODES.has(value.code)) return true;
  return isConnectionFailure(value.cause, seen) || (Array.isArray(value.errors) && value.errors.some((item) => isConnectionFailure(item, seen)));
}

async function waitBeforeRetry(signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 200);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fallbackFetch(): Promise<FetchLike> {
  if (!fallbackSetup) {
    fallbackSetup = (async () => {
      const undici = (await import("undici")) as unknown as UndiciRuntime;
      const dispatcher = new undici.Agent({
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 1000,
        connect: { timeout: 5000 },
      });
      dispatchers.add(dispatcher);
      return (input, init) => undici.fetch(input, { ...init, dispatcher });
    })();
  }
  return fallbackSetup;
}

async function directFetch(input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]): ReturnType<FetchLike> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const signal = init?.signal ?? request?.signal;
    if (!["GET", "HEAD"].includes(method) || signal?.aborted || !isConnectionFailure(error)) throw error;
    await waitBeforeRetry(signal);
    let retry: FetchLike;
    try {
      retry = await fallbackFetch();
    } catch {
      throw error;
    }
    if (signal?.aborted) throw signal.reason;
    activeFetch = retry;
    // 同一个 signal 继续覆盖重试及正文读取，不重置 API 的整体超时时间。
    return retry(input, init);
  }
}

/** 当前出口：原生 fetch、连接失败后的直连 dispatcher，或显式配置的代理。 */
export function fetchImpl(): FetchLike {
  return activeFetch;
}

export async function configureProxy(proxy?: string): Promise<ProxySetup | null> {
  if (proxy === undefined) return null;
  const target = proxy.trim();

  try {
    const url = new URL(target);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new UsageError("--proxy 需要有效的 HTTP(S) 代理地址，例如 http://127.0.0.1:7890。");
  }

  try {
    // 只借用运行时实现，类型统一按本项目的 FetchLike 处理（undici 自带的类型与 @types/node 的
    // 全局 fetch 类型并不完全一致，没必要为此做类型体操）。
    const undici = (await import("undici")) as unknown as UndiciRuntime;
    const dispatcher = new undici.ProxyAgent(target);
    dispatchers.add(dispatcher);
    activeFetch = (input, init) => undici.fetch(input, { ...init, dispatcher });
    return { proxy: target, via: "undici" };
  } catch {
    throw new UsageError("无法启用代理，请检查代理地址或重新安装 yuna-team（需要 undici）。本次请求未发送。");
  }
}

/** 释放代理和直连回退的 dispatcher，并恢复原生 fetch 优先的初始状态。
 *  用 destroy 而不是 close：Windows 上 close 之后再退进程会触发 libuv 断言。 */
export async function shutdownProxy(): Promise<void> {
  activeFetch = directFetch;
  if (fallbackSetup) await fallbackSetup.catch(() => {});
  fallbackSetup = null;
  const pending = [...dispatchers];
  dispatchers.clear();
  for (const dispatcher of pending) {
    try {
      if (dispatcher.destroy) await dispatcher.destroy();
      else if (dispatcher.close) await dispatcher.close();
    } catch {
      // 退出路径上不必因为关闭失败而报错
    }
  }
}
