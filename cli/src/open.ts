// 在系统默认浏览器里打开链接。命令失败时返回 false，由调用方提示手动访问。
import { spawn } from "node:child_process";

interface BrowserOpenOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
}

export async function openInBrowser(url: string, options: BrowserOpenOptions = {}): Promise<boolean> {
  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) return false;
  } catch {
    return false;
  }
  const platform = options.platform ?? process.platform;
  const launch = options.spawn ?? spawn;
  const command = platform === "win32" ? "powershell.exe" : platform === "darwin" ? "open" : "xdg-open";
  // cmd /c start 会解释 URL 中的 & 等字符。这里只拼接受控 Base64；URL 解码后始终是参数值。
  const script = "$ErrorActionPreference='Stop'; $url=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
    Buffer.from(url, "utf8").toString("base64") + "')); Start-Process -FilePath $url";
  const args = platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]
    : [url];

  return new Promise((resolve) => {
    try {
      const child = launch(command, args, { stdio: "ignore", shell: false, windowsHide: true });
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}
