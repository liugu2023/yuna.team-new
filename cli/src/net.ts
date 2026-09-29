// 网络出口：支持用 --proxy 指定代理。
//
// 为什么需要它：Node 的内置 fetch（undici）不接受代理参数，也不读 HTTP(S)_PROXY，
// 所以在需要代理的网络里会直接 "fetch failed"。这里用 undici 的 ProxyAgent 接管出口，
// 只有显式传了 --proxy 才会动态加载 undici，平时不付出启动开销。

import { style } from "./ui.js";

export type FetchLike = typeof fetch;

export interface ProxySetup {
  proxy: string;
  /** undici = 已接管出口；null = 没接管成功（会提示用户） */
  via: "undici" | null;
}

let activeFetch: FetchLike = (...args: Parameters<FetchLike>) => fetch(...args);
let activeDispatcher: { close?: () => Promise<void>; destroy?: () => Promise<void> } | null = null;

/** 实际使用的 fetch（传了 --proxy 时已被 undici 的代理 dispatcher 接管）。 */
export function fetchImpl(): FetchLike {
  return activeFetch;
}

export async function configureProxy(proxy?: string): Promise<ProxySetup | null> {
  const target = String(proxy ?? "").trim();
  if (!target) return null;

  try {
    // 只借用运行时实现，类型统一按本项目的 FetchLike 处理（undici 自带的类型与 @types/node 的
    // 全局 fetch 类型并不完全一致，没必要为此做类型体操）。
    const undici = (await import("undici")) as unknown as {
      fetch: FetchLike;
      ProxyAgent: new (url: string) => { close?: () => Promise<void>; destroy?: () => Promise<void> };
      setGlobalDispatcher: (dispatcher: unknown) => void;
    };
    const dispatcher = new undici.ProxyAgent(target);
    undici.setGlobalDispatcher(dispatcher);
    activeDispatcher = dispatcher;
    activeFetch = (...args: Parameters<FetchLike>) => undici.fetch(...args);
    return { proxy: target, via: "undici" };
  } catch {
    return { proxy: target, via: null };
  }
}

/** 收掉代理 dispatcher：否则它会一直持着连接，命令跑完进程也不退出。
 *  用 destroy 而不是 close：Windows 上 close 之后再退进程会触发 libuv 断言。 */
export async function shutdownProxy(): Promise<void> {
  const dispatcher = activeDispatcher;
  activeDispatcher = null;
  if (!dispatcher) return;
  try {
    if (dispatcher.destroy) await dispatcher.destroy();
    else if (dispatcher.close) await dispatcher.close();
  } catch {
    // 退出路径上不必因为关闭失败而报错
  }
}

export function proxyFailureHint(proxy: string): string {
  return (
    `${style.yellow("!")} 检测到 --proxy ${proxy}，但没能启用（缺少 undici）。\n` +
    style.dim("  重新安装一次即可：npm i -g yuna-team；或临时用 --base 指向可达地址。\n")
  );
}
