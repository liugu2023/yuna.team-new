// 在系统默认浏览器里打开链接。命令失败时返回 false，由调用方提示手动访问。
import { spawn } from "node:child_process";

export async function openInBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
