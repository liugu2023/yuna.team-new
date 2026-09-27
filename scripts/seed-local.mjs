// 本地模拟数据：生成 scripts/seed-local.sql 与若干 PNG 占位图，并写入本地 D1 / R2。
// 仅用于 `wrangler pages dev` 的本地状态（.wrangler/state），不会触碰线上资源。
//
//   npm run db:migrate:local   # 首次或迁移有更新时
//   npm run db:seed:local      # 重置本地 posts / site_records 并写入模拟数据
//
// 参数：--sql-only 只生成 SQL 文件，不执行 wrangler。
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sqlOnly = process.argv.includes("--sql-only");
const SQL_FILE = join(root, "scripts", "seed-local.sql");
const TMP_DIR = join(root, ".wrangler", "tmp", "seed-media");
const BUCKET = "cloudflare-markdown-blog";
const CONTROL_GROUP = "yuna-docs-edit";
const DEV_SESSION_ID = "seed-local-dev-admin-session";
const DEV_SESSION_EXPIRES = 4102444800; // 2100-01-01

// ---------------------------------------------------------------- 占位图片
// R2 媒体只内联展示 png/jpeg/gif/webp，SVG 会被强制下载，所以这里用 zlib 手写 PNG。
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function hex(color) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}
// 对角渐变 + 圆形/条纹装饰，足够区分不同图片。
function png(width, height, from, to, shape = "circle") {
  const a = hex(from);
  const b = hex(to);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      let rgb = a.map((v, i) => Math.round(v + (b[i] - v) * t));
      const dx = x - width * 0.72;
      const dy = y - height * 0.38;
      const inShape = shape === "circle"
        ? dx * dx + dy * dy < (Math.min(width, height) * 0.22) ** 2
        : Math.floor((x + y) / Math.max(8, width / 16)) % 2 === 0;
      if (inShape) rgb = rgb.map((v) => Math.round(v + (255 - v) * 0.28));
      raw.set(rgb, y * (width * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const media = [
  ["seed/covers/dev.png", () => png(960, 540, "#2563eb", "#7c3aed")],
  ["seed/covers/ops.png", () => png(960, 540, "#0f766e", "#22c55e", "stripe")],
  ["seed/covers/security.png", () => png(960, 540, "#111827", "#dc2626")],
  ["seed/covers/publicity.png", () => png(960, 540, "#f97316", "#facc15", "stripe")],
  ["seed/covers/event.png", () => png(960, 540, "#0ea5e9", "#6366f1")],
  ["seed/covers/tall.png", () => png(600, 900, "#db2777", "#9333ea", "stripe")],
  ["seed/site/hero.png", () => png(1600, 900, "#1e3a8a", "#0f172a")],
  ["seed/avatars/a1.png", () => png(160, 160, "#f43f5e", "#fb923c")],
  ["seed/avatars/a2.png", () => png(160, 160, "#10b981", "#3b82f6")],
  ["seed/avatars/a3.png", () => png(160, 160, "#8b5cf6", "#ec4899")],
  ["seed/avatars/a4.png", () => png(160, 160, "#64748b", "#0ea5e9", "stripe")],
  ["seed/icons/friend.png", () => png(64, 64, "#22c55e", "#15803d")],
  ["seed/files/lesson-notes.txt", () => Buffer.from("YUNA 本地模拟附件：授课讲义（纯文本占位）。\n")],
  ["seed/files/ctf-writeup.zip", () => Buffer.from("PK\u0005\u0006" + "\u0000".repeat(18), "binary")],
];
const M = (path) => `/media/${path}`;
const AV = [1, 2, 3, 4].map((n) => M(`seed/avatars/a${n}.png`));

// ---------------------------------------------------------------- 文章
const STYLE_GALLERY_A = `# 样式全集 A：排版与块元素

这是一段普通段落，包含 **粗体**、*斜体*、~~删除线~~、\`行内代码\`、[站内链接](/articles.html) 与 [外部链接](https://example.com)。
同一段落的第二行，行尾有两个空格
用于测试强制换行效果。

## 二级标题：列表

- 无序列表第一项
- 第二项带 **强调** 和 \`code\`
  - 缩进的“嵌套”子项（渲染器会拍平为同级）
  - 另一个子项
- 第三项带 [链接](https://github.com)

1. 有序列表第一步
2. 第二步：安装依赖 \`npm install\`
3. 第三步：启动 \`npm run dev\`

### 三级标题：引用

> 这是一段引用文字。优秀的代码是它自己最好的文档。
> 第二行引用，包含 **粗体** 与 \`code\`。

> [!NOTE]
> GitHub 风格的提示引用。

#### 四级标题：代码块

\`\`\`js
// JavaScript
export async function fetchPosts() {
  const res = await fetch("/api/posts?page=1&perPage=10");
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return (await res.json()).posts;
}
\`\`\`

\`\`\`python
# Python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

\`\`\`bash
wrangler d1 execute BLOG_DB --local --command "SELECT COUNT(*) FROM posts"
\`\`\`

\`\`\`sql
SELECT slug, title, view_count FROM posts WHERE status = 'published' ORDER BY view_count DESC LIMIT 5;
\`\`\`

\`\`\`
没有语言标记的代码块，包含一行非常非常长的内容用于测试横向滚动：aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
\`\`\`

---

## 自定义提示块

::: tip
默认标题的 tip 块，内含 \`行内代码\` 与 [链接](/join.html)。
:::

::: info 信息
带自定义标题的 info 块。
:::

::: note
note 块。
:::

::: warning 注意事项
- warning 块中的列表
- 第二项
:::

::: danger 高危操作
不要在生产环境执行 \`rm -rf /\`。

\`\`\`bash
# 块内代码
echo "danger"
\`\`\`
:::

## 图片

![横向封面](${M("seed/covers/dev.png")})

![校园背景（静态资源）](/images/campus-bg.webp)

## 附件与按钮

- 附件：[授课讲义.txt](${M("seed/files/lesson-notes.txt")})
- 附件：[CTF-writeup.zip](${M("seed/files/ctf-writeup.zip")})
- 邮件：[联系我们](mailto:yuna@example.com)

<a class="link-button" href="/join.html">按钮样式链接：加入我们</a>

## 表格（GFM，支持 :--- / :---: / ---: 对齐与行内格式）

| 部门 | 方向 | 人数 |
| :--- | :---: | ---: |
| 开发部 | Web / **全栈** | 12 |
| 网络安全部 | CTF、\`pwn\` | 9 |
| 运维部 | Linux 与 [容器](https://docs.docker.com/) | 7 |

结尾段落。
`;

const STYLE_GALLERY_B = `# 样式全集 B：长文与目录

本文用于测试文章目录（h2/h3 生成）、长段落和中英文混排。Lorem ipsum dolor sit amet, consectetur adipiscing elit. 燕山大学大学生网络信息协会（YUNA）成立于 2017 年，致力于把校园里的技术热情连接成可见的作品。

## 第一章 环境准备

${"这是一段较长的正文，用于测试行高、段间距与阅读宽度。".repeat(8)}

### 1.1 安装 Node.js

推荐使用 \`nvm\` 管理版本：

\`\`\`bash
nvm install 22
nvm use 22
node -v
\`\`\`

### 1.2 安装 Wrangler

\`\`\`json
{
  "devDependencies": {
    "wrangler": "^4.20.5"
  }
}
\`\`\`

## 第二章 编写第一个 Function

\`\`\`ts
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const row = await env.BLOG_DB.prepare("SELECT 1 AS ok").first();
  return Response.json(row);
};
\`\`\`

::: tip 小技巧
本地开发时 D1 数据保存在 \`.wrangler/state\` 目录。
:::

### 2.1 Go 与 Rust 对照

\`\`\`go
package main

import "fmt"

func main() { fmt.Println("hello yuna") }
\`\`\`

\`\`\`rust
fn main() {
    println!("hello yuna");
}
\`\`\`

\`\`\`yaml
services:
  web:
    image: nginx:alpine
    ports: ["80:80"]
\`\`\`

## 第三章 常见问题

1. 为什么登录后跳回首页？检查 Cookie 是否被浏览器拦截。
2. 为什么图片 404？确认已执行 \`npm run db:seed:local\`。
3. 其他问题请在 [GitHub](https://github.com) 提 issue。

> 引用：遇到问题先看日志，再看文档，最后再问人。

::: warning
这里是一个 warning。
:::

::: danger
这里是一个 danger。
:::

![竖版图片](${M("seed/covers/tall.png")})

## 第四章 总结

${"总结段落。".repeat(30)}

附件下载：[授课讲义](${M("seed/files/lesson-notes.txt")})
`;

const short = (title, extra = "") => `# ${title}

${extra || "这是一篇用于本地预览的模拟文章。正文包含一段文字、一个列表和一段代码。"}

- 要点一
- 要点二

\`\`\`js
console.log("${title.replace(/"/g, "")}");
\`\`\`
`;

const people = {
  a: { name: "林一", url: "https://github.com/lin-yi", avatar: AV[0] },
  b: { name: "王小二", url: "", avatar: AV[1] },
  c: { name: "张三丰", url: "https://example.com/zhang", avatar: AV[2] },
  d: { name: "Alice Chen", url: "https://example.com/alice", avatar: AV[3] },
  e: { name: "无头像同学", url: "", avatar: "" },
};

const posts = [
  { slug: "style-gallery-a", title: "样式全集 A：排版、代码块与提示块", tag: "开发,协会动态", cover: M("seed/covers/dev.png"), author: people.a, co: [people.b, people.c], views: 1024, date: "2026-09-20", md: STYLE_GALLERY_A, excerpt: "覆盖 h1-h4、列表、引用、多语言代码块、custom-block、图片与附件。" },
  { slug: "style-gallery-b", title: "样式全集 B：一篇很长很长的文章，用来测试标题在卡片和文章页里换行时的表现是否正常", tag: "开发", cover: "", author: people.d, co: [people.e], views: 88, date: "2026-09-18", md: STYLE_GALLERY_B, excerpt: "长标题、长正文、目录与竖版图片。" },
  { slug: "docker-compose-in-lab", title: "在实验室服务器上用 Docker Compose 部署服务", tag: "运维", cover: M("seed/covers/ops.png"), author: people.c, co: [], views: 532, date: "2026-09-12", md: short("在实验室服务器上用 Docker Compose 部署服务") },
  { slug: "ctf-week-review", title: "校赛 CTF 周赛复盘", tag: "网络安全", cover: M("seed/covers/security.png"), author: people.b, co: [people.a, people.d, people.c], views: 2890, date: "2026-09-08", md: short("校赛 CTF 周赛复盘", "附件：[writeup](/media/seed/files/ctf-writeup.zip)") },
  { slug: "poster-design-basics", title: "海报设计入门", tag: "组宣", cover: M("seed/covers/publicity.png"), author: people.e, co: [], views: 17, date: "2026-09-02", md: short("海报设计入门") },
  { slug: "recruit-2026", title: "2026 秋季招新公告", tag: "协会动态", cover: M("seed/covers/event.png"), author: null, co: [], views: 4521, date: "2026-08-30", md: short("2026 秋季招新公告") },
  { slug: "vue-state", title: "Vue 状态管理", tag: "开发", cover: "", author: people.a, co: [], views: 301, date: "2026-08-21", md: short("Vue 状态管理") },
  { slug: "linux-permissions", title: "Linux 文件权限速查", tag: "运维,知识分享", cover: "", author: people.c, co: [people.b], views: 760, date: "2026-08-10", md: short("Linux 文件权限速查") },
  { slug: "sql-injection-101", title: "SQL 注入原理与防御", tag: "网络安全", cover: M("seed/covers/tall.png"), author: people.d, co: [], views: 1200, date: "2026-07-28", md: short("SQL 注入原理与防御") },
  { slug: "wechat-article-workflow", title: "公众号推文排版流程", tag: "组宣,协会动态", cover: "", author: people.b, co: [], views: 45, date: "2026-07-15", md: short("公众号推文排版流程") },
  { slug: "hackathon-recap", title: "黑客松回顾", tag: "活动", cover: M("seed/covers/event.png"), author: people.a, co: [people.b, people.c, people.d, people.e], views: 999, date: "2026-06-30", md: short("黑客松回顾") },
  { slug: "k8s-intro", title: "Kubernetes 入门：从 Pod 到 Deployment", tag: "运维", cover: M("seed/covers/ops.png"), author: people.c, co: [], views: 0, date: "2026-06-12", md: short("Kubernetes 入门") },
  { slug: "reverse-engineering-start", title: "逆向工程第一课", tag: "网络安全", cover: "", author: null, co: [], views: 256, date: "2026-05-20", md: short("逆向工程第一课") },
  { slug: "graduation-2026", title: "毕业季｜致即将离开的你们", tag: "协会动态", cover: M("seed/covers/publicity.png"), author: people.e, co: [], views: 3333, date: "2026-05-10", md: short("毕业季") },
  { slug: "a", title: "短", tag: "其他", cover: "", author: null, co: [], views: 3, date: "2026-04-01", md: short("短") },
  { slug: "git-workflow", title: "团队 Git 协作规范", tag: "开发,知识分享", cover: M("seed/covers/dev.png"), author: people.d, co: [people.a], views: 640, date: "2026-03-18", md: short("团队 Git 协作规范") },
  // 草稿（仅管理员可见）
  { slug: "draft-ai-agent", title: "【草稿】用 Agent 搭建社团知识库", tag: "开发", cover: M("seed/covers/dev.png"), author: people.a, co: [], views: 0, date: "2026-09-25", md: short("用 Agent 搭建社团知识库"), status: "draft" },
  { slug: "draft-no-cover", title: "【草稿】无封面无作者的草稿", tag: "运维", cover: "", author: null, co: [], views: 0, date: "2026-09-24", md: short("无封面草稿"), status: "draft" },
  // knowledge 类型
  { slug: "kb-web-roadmap", title: "Web 学习路线", tag: "开发", cover: "", author: people.a, co: [], views: 120, date: "2026-09-01", md: short("Web 学习路线"), kind: "knowledge" },
  { slug: "kb-ctf-tools", title: "CTF 常用工具清单", tag: "网络安全", cover: M("seed/covers/security.png"), author: people.b, co: [], views: 80, date: "2026-08-15", md: short("CTF 常用工具清单"), kind: "knowledge" },
];

// ---------------------------------------------------------------- 站点记录
const records = [];
const json = (key, title, value) => records.push({ key, title, kind: "json", content: JSON.stringify(value) });
const markdown = (key, title, content) => records.push({ key, title, kind: "markdown", content });

markdown("homepage-notice", "协会公告", `**2026 秋季招新** 正在进行中！

- 报名截止：10 月 15 日
- 宣讲会：10 月 8 日 19:00，东区 [报名入口](/join.html)

> 有问题可以在答疑群 @ 管理员。

详情见 [招新公告](/post.html?slug=recruit-2026)。`);

json("homepage-gallery", "首页背景", [
  { url: "/images/campus-bg.webp", label: "校园背景", active: true },
  { url: M("seed/site/hero.png"), label: "本地模拟背景", active: false },
]);

json("friend-links", "友情链接", {
  title: "友情链接",
  links: [
    { label: "燕山大学", href: "https://www.ysu.edu.cn/", icon: "" },
    { label: "Cloudflare", href: "https://www.cloudflare.com/", icon: M("seed/icons/friend.png") },
    { label: "GitHub", href: "https://github.com/", icon: "" },
    { label: "站内：授课计划", href: "/lesson-plan.html", icon: "/images/logo.svg" },
    { label: "一个名字特别长的友情链接站点示例", href: "https://example.com/", icon: "" },
  ],
});

// 页脚：key = footer-<页面名>，与 public/js/footer.js footerCopyKey 一致。
for (const page of ["home", "articles", "post", "page", "team", "join", "knowledge", "lesson-plan", "departments", "department-dev", "department-ops", "department-publicity", "department-security", "admin-login"]) {
  json(`footer-${page}`, `页脚：${page}`, {
    left: `© 2017-2026 燕山大学大学生网络信息协会（本地模拟 · ${page}）`,
    right: "冀ICP备00000000号 · Powered by Cloudflare Pages",
  });
}

const blocks = {
  "home-hero-copy": { fields: { eyebrow: "YUNA · Local Mock Data", title: "本地模拟数据\n用于预览全站样式", lead: "这段文案来自 scripts/seed-local.mjs 写入的 site_records（home-hero-copy），用于确认可编辑块读取正常。" } },
  "home-stat-articles": { fields: { title: "20+ 文章", body: "含草稿与样式全集" } },
  "home-stat-knowledge": { fields: { title: "资料", body: "授课课件与学习路线" } },
  "home-stat-members": { fields: { title: "60+ 成员", body: "三届成员与名人堂" } },
  "join-kpi-time": { fields: { title: "时间", body: "9 月 20 日 - 10 月 15 日" } },
  "join-kpi-contact": { fields: { title: "答疑", body: "QQ 群 123456789" } },
  "join-process-register": { fields: { title: "报名入口", body: "填写线上报名表，选择意向部门。" }, tags: ["报名", "线上", "9 月开放"] },
};
for (const [key, value] of Object.entries(blocks)) json(key, key, value);

// 协会成员：三届，五个分组，部分有头像/链接/简介。
const depts = ["主席团", "开发部", "网络安全部", "运维部", "组宣部"];
const surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜";
const members = [];
[["第十届", 22], ["第九届", 16], ["第八届", 10]].forEach(([term, count], ti) => {
  for (let i = 0; i < count; i += 1) {
    const department = depts[i % depts.length];
    const lead = i < depts.length;
    const links = [];
    if (i % 3 === 0) links.push({ label: "GitHub", url: `https://github.com/yuna-${ti}-${i}` });
    if (i % 4 === 1) links.push({ label: "QQ", url: "123456789" });
    if (i % 5 === 2) links.push({ label: "博客", url: "https://example.com/blog" });
    members.push({
      name: `${surnames[(i * 7 + ti * 3) % surnames.length]}${["一", "明", "晓雨", "子涵", "Alex", "思远"][i % 6]}`,
      avatar: i % 3 === 1 ? "" : AV[(i + ti) % AV.length],
      desc: i % 4 === 3 ? "" : i % 2 ? "热爱折腾服务器和开源项目。" : "负责部门日常工作，一段稍长的个人简介用于测试卡片内文字换行效果。",
      links,
      term,
      department,
      role: lead ? (department === "主席团" ? "会长" : "部长") : "成员",
      title: lead ? (department === "主席团" ? "会长" : "部长") : "成员",
    });
  }
});
json("members", "协会成员", members);

json("hall-of-fame", "网协名人堂", Array.from({ length: 8 }, (_, i) => ({
  name: ["刘一鸣", "Bob Li", "孙悟", "周末", "吴优", "郑好", "王者", "冯程"][i],
  avatar: i % 2 ? "" : AV[i % AV.length],
  desc: i === 0 ? "协会创始人之一，现就职于某互联网公司，负责基础架构。" : i % 3 ? "往届会长。" : "",
  links: i % 2 ? [{ label: "GitHub", url: "https://github.com/" }] : [{ label: "QQ", url: "10001" }],
  term: "",
  department: "",
  role: "",
  title: `第${i + 1}届会长`,
})));

// 授课计划：多届、四部门 + 公开课、三种状态、有/无日期、有/无资源链接。
const lessonDepts = ["开发部", "网络安全部", "运维部", "组宣部", "公开课"];
const topics = {
  开发部: ["HTML/CSS 基础", "JavaScript 入门", "Vue 组件与状态", "后端 API 设计"],
  网络安全部: ["CTF 入门与环境搭建", "Web 漏洞：XSS/SQLi", "逆向基础", "密码学初步"],
  运维部: ["Linux 常用命令", "Docker 入门", "Nginx 反向代理", "CI/CD 流水线"],
  组宣部: ["海报设计", "公众号排版", "摄影基础", "视频剪辑"],
  公开课: ["新生第一课：协会介绍", "如何高效使用搜索引擎", "Git 与 GitHub"],
};
function lessonsFor(termIndex, baseDate) {
  const list = [];
  let n = 0;
  for (const department of lessonDepts) {
    topics[department].forEach((topic, i) => {
      n += 1;
      const d = new Date(`${baseDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n * 4);
      const iso = d.toISOString().slice(0, 10);
      const future = iso > "2026-09-26";
      const status = termIndex > 0 ? (n % 7 === 0 ? "cancelled" : "completed") : future ? (n % 6 === 0 ? "cancelled" : "planned") : "completed";
      const noDate = termIndex === 0 && i === topics[department].length - 1;
      list.push({
        date: noDate ? "" : iso,
        session: `第 ${i + 1} 次课`,
        topic,
        department,
        instructor: i % 3 === 2 ? "" : ["林一", "王小二", "张三丰", "Alice Chen"][(n + i) % 4],
        location: i % 2 ? "东区 A301" : n % 3 ? "线上 · 腾讯会议" : "",
        status,
        links: n % 3 === 0 ? [] : [
          { label: "课件", url: M("seed/files/lesson-notes.txt") },
          ...(n % 2 ? [{ label: "录播", url: "https://example.com/video" }] : []),
        ],
      });
    });
  }
  return list;
}
json("lesson-plan", "授课计划", {
  title: "授课计划",
  terms: [
    { label: "第十届 · 2026 秋", subtitle: "每周六 19:00 · 东区 A301 / 线上", order: 3, lessons: lessonsFor(0, "2026-09-01") },
    { label: "第十届 · 2026 春", subtitle: "每周日下午", order: 2, lessons: lessonsFor(1, "2026-03-01") },
    { label: "第九届 · 2025 秋", subtitle: "", order: 1, lessons: lessonsFor(2, "2025-09-01").slice(0, 8) },
  ],
});

// 部门详情页（departments/*）与一个固定 Markdown 页（/page.html?p=about/yuna）。
const deptPages = { dev: "开发部", ops: "运维部", publicity: "组宣部", security: "网络安全部" };
for (const [slug, name] of Object.entries(deptPages)) {
  markdown(`page:departments/${slug}`, name, `# ${name}

${name}是协会的核心部门之一（本地模拟内容）。

## 我们做什么

- 每周例会与技术分享
- 参与协会项目与比赛
- 带新人入门

## 学习路线

1. 基础阶段：环境搭建与工具使用
2. 进阶阶段：项目实战
3. 分享阶段：输出文章与授课

::: tip 欢迎加入
对${name}感兴趣？查看 [加入我们](/join.html) 或 [授课计划](/lesson-plan.html)。
:::

\`\`\`bash
echo "hello ${slug}"
\`\`\`

![部门封面](${M(`seed/covers/${slug}.png`)})
`);
}
markdown("page:about/yuna", "关于 YUNA", STYLE_GALLERY_A.replace("# 样式全集 A：排版与块元素", "# 关于 YUNA（固定页面样式全集）"));
markdown("page:guide/new-member", "新成员指南", short("新成员指南"));

// ---------------------------------------------------------------- SQL
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const lines = [
  "-- 由 scripts/seed-local.mjs 生成，请勿手改；仅用于本地 D1。",
  "DELETE FROM posts;",
  "DELETE FROM site_records;",
  "DELETE FROM site_record_backups;",
  `DELETE FROM sessions WHERE id = ${q(DEV_SESSION_ID)};`,
];
posts.forEach((p, i) => {
  const kind = p.kind || "article";
  const status = p.status || "published";
  const at = `${p.date}T0${i % 10}:30:00.000Z`;
  const cols = {
    id: `seed-${String(i + 1).padStart(2, "0")}`,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? "",
    status,
    r2_key: `db/${kind === "knowledge" ? "knowledge" : "posts"}/${p.slug}.md`,
    author_email: "seed@localhost",
    created_at: at,
    updated_at: at,
    published_at: status === "published" ? at : null,
    markdown_content: p.md,
    view_count: p.views,
    tag: p.tag,
    kind,
    cover_url: p.cover,
    author_name: p.author?.name || "网络信息协会",
    editor_name: i % 2 ? "网络信息协会" : "林一",
    author_url: p.author?.url || "",
    author_avatar: p.author?.avatar || "",
    coauthors_json: JSON.stringify(p.co),
  };
  lines.push(`INSERT INTO posts (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).map((v) => (typeof v === "number" ? v : q(v))).join(", ")});`);
});
for (const r of records) {
  lines.push(`INSERT INTO site_records (key, title, kind, content, updated_by, updated_at) VALUES (${[r.key, r.title, r.kind, r.content, "seed@localhost", "2026-09-26T00:00:00.000Z"].map(q).join(", ")});`);
}
lines.push(`INSERT INTO sessions (id, user_email, user_name, user_groups, expires_at) VALUES (${q(DEV_SESSION_ID)}, 'dev-admin@localhost', '本地开发管理员', ${q(JSON.stringify([CONTROL_GROUP]))}, ${DEV_SESSION_EXPIRES});`);
writeFileSync(SQL_FILE, `${lines.join("\n")}\n`);
console.log(`写入 ${SQL_FILE}：${posts.length} 篇文章，${records.length} 条站点记录。`);

if (sqlOnly) process.exit(0);

// ---------------------------------------------------------------- 执行
const isWin = process.platform === "win32";
const wrangler = (args) => execFileSync(
  isWin ? "cmd.exe" : "npx",
  isWin ? ["/d", "/c", "npx", "wrangler", ...args] : ["wrangler", ...args],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);

wrangler(["d1", "execute", "BLOG_DB", "--local", `--file=${SQL_FILE}`]);
console.log("本地 D1 已写入。");

mkdirSync(TMP_DIR, { recursive: true });
for (const [path, make] of media) {
  const file = join(TMP_DIR, path.replace(/\//g, "__"));
  writeFileSync(file, make());
  const type = path.endsWith(".png") ? "image/png" : path.endsWith(".txt") ? "text/plain" : "application/zip";
  wrangler(["r2", "object", "put", `${BUCKET}/media/${path}`, "--local", `--file=${file}`, `--content-type=${type}`]);
}
console.log(`本地 R2 已写入 ${media.length} 个媒体文件（/media/seed/...）。`);

// 打印可直接粘贴到浏览器的管理员 Cookie（签名依赖 .dev.vars 的 SESSION_SECRET）。
const devVars = join(root, ".dev.vars");
const secret = existsSync(devVars)
  ? (readFileSync(devVars, "utf8").match(/^SESSION_SECRET\s*=\s*"?([^"\r\n]*)"?/m) || [])[1]
  : "";
if (secret) {
  const sig = createHmac("sha256", secret).update(DEV_SESSION_ID).digest("base64url");
  console.log("\n本地管理员 Cookie（在 http://127.0.0.1:8788 的 DevTools 控制台执行）：");
  console.log(`document.cookie = "yuna_session=${DEV_SESSION_ID}.${sig}; path=/; max-age=31536000";`);
} else {
  console.log("\n未在 .dev.vars 找到 SESSION_SECRET，跳过打印管理员 Cookie。");
}
