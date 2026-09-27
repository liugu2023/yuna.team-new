// 按页面校验前台脚本的依赖是否齐全。
//
// public/js/*.js 与 public/admin/js/*.js 都是普通 <script>（没有打包步骤），顶层声明共享
// 全局作用域，每个页面只引入自己用到的模块。漏引一个文件不会在加载时报错，而是在某个
// 分支运行到时才抛 ReferenceError，所以这里逐页把「引入的脚本 + 内联脚本」交给 TypeScript
// 当作同一全局作用域检查，只关心三类问题：
//   1. 引用了当前页面没加载的函数/变量（Cannot find name）；
//   2. 两个脚本声明了同名顶层标识符（后加载的会覆盖或直接抛 SyntaxError）；
//   3. 内联脚本调用的 window.blog.xxx 没有任何已加载模块挂出来。
// 另外要求 /js/core.js 是第一个脚本：它创建 window.blog，其余模块在加载时往上追加。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const publicDir = path.join(root, "public");

const RELEVANT_CODES = new Set([
  2304, // Cannot find name
  2552, // Cannot find name. Did you mean
  2448, // Block-scoped variable used before its declaration
]);

const GLOBALS_D_TS = "/__globals__.d.ts";
const GLOBALS = "declare var blog: any;\ninterface Window { blog: any }\n";

function htmlPages() {
  const pages = readdirSync(publicDir)
    .filter((name) => name.endsWith(".html"))
    .map((name) => path.join(publicDir, name));
  const adminIndex = path.join(publicDir, "admin", "index.html");
  if (existsSync(adminIndex)) pages.push(adminIndex);
  // Functions 里内嵌的整页 HTML（如后台 403 页）同样引用前台脚本。
  pages.push(path.join(root, "functions", "admin", "_middleware.ts"));
  return pages;
}

// 按出现顺序取出外链脚本和可执行的内联脚本（跳过 type="text/plain" 这类数据块）。
function pageScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1];
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type && !/^(text|application)\/javascript$|^module$/i.test(type)) continue;
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) {
      scripts.push({ src });
    } else if (match[2].trim()) {
      scripts.push({ inline: match[2] });
    }
  }
  return scripts;
}

function registeredBlogNames(source) {
  const names = new Set();
  const blocks = source.matchAll(/(?:window\.blog\s*=|Object\.assign\(\s*window\.blog\s*,)\s*\{([\s\S]*?)\}/g);
  for (const block of blocks) {
    for (const entry of block[1].split(",")) {
      const name = entry.trim().split(/\s*:/)[0];
      if (/^\w+$/.test(name)) names.add(name);
    }
  }
  return names;
}

// 顶层同名声明单独查：TypeScript 在 JS 文件里允许 function 重复声明，但浏览器里
// 后加载的会静默覆盖先加载的（let/const 撞名则直接让后一个脚本整个执行失败）。
function duplicateTopLevelNames(program, files, rel) {
  const owners = new Map();
  const issues = [];
  for (const fileName of files.keys()) {
    if (fileName === GLOBALS_D_TS) continue;
    const sourceFile = program.getSourceFile(fileName);
    const names = [];
    for (const statement of sourceFile?.statements || []) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
        names.push(statement.name.text);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
        }
      }
    }
    const shortName = fileName.replace(/^\/public/, "public");
    for (const name of names) {
      const previous = owners.get(name);
      if (previous) {
        issues.push(`${rel}: 顶层标识符 ${name} 在 ${previous} 和 ${shortName} 中重复声明`);
      } else {
        owners.set(name, shortName);
      }
    }
  }
  return issues;
}

function checkPage(pagePath) {
  const rel = path.relative(root, pagePath).replaceAll("\\", "/");
  const issues = [];
  const scripts = pageScripts(readFileSync(pagePath, "utf8"));
  if (!scripts.length) return issues;

  const files = new Map([[GLOBALS_D_TS, GLOBALS]]);
  const blogNames = new Set();
  const blogCalls = [];
  const localSrcs = [];

  scripts.forEach((script, index) => {
    if (script.src) {
      if (/^(https?:)?\/\//i.test(script.src)) return;
      const clean = script.src.split(/[?#]/, 1)[0];
      const file = path.join(publicDir, ...clean.split("/").filter(Boolean));
      if (!existsSync(file)) {
        issues.push(`${rel}: 引用的脚本不存在 ${script.src}`);
        return;
      }
      const source = readFileSync(file, "utf8");
      localSrcs.push(clean);
      files.set(`/public${clean}`, source);
      registeredBlogNames(source).forEach((name) => blogNames.add(name));
      // 后台脚本通过 window.blog.xxx 调前台模块，属性访问 TypeScript 查不出来，单独核对。
      for (const call of source.matchAll(/\bwindow\.blog\.(\w+)/g)) {
        blogCalls.push({ name: call[1], where: `public${clean}` });
      }
    } else {
      const name = `/${rel}#inline-${index + 1}.js`;
      files.set(name, script.inline);
      for (const call of script.inline.matchAll(/\b(?:window\.)?blog\.(\w+)/g)) {
        blogCalls.push({ name: call[1], where: `内联脚本 #${index + 1}` });
      }
    }
  });

  const moduleSrcs = localSrcs.filter((src) => src.startsWith("/js/") || src.startsWith("/admin/js/"));
  if (moduleSrcs.length && localSrcs[0] !== "/js/core.js") {
    issues.push(`${rel}: /js/core.js 必须是第一个脚本（当前是 ${localSrcs[0]}）`);
  }

  const reported = new Set();
  for (const call of blogCalls) {
    const key = `${call.where} ${call.name}`;
    if (!blogNames.has(call.name) && !reported.has(key)) {
      reported.add(key);
      issues.push(`${rel}: ${call.where} 调用了 blog.${call.name}，但没有已加载的模块挂出它`);
    }
  }

  const options = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    noLib: false,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    target: ts.ScriptTarget.ES2022,
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options, true);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    if (files.has(fileName)) return ts.createSourceFile(fileName, files.get(fileName), languageVersion, true);
    return baseGetSourceFile(fileName, languageVersion, ...rest);
  };
  const baseFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => files.has(fileName) || baseFileExists(fileName);
  const baseReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => files.get(fileName) ?? baseReadFile(fileName);

  const program = ts.createProgram([...files.keys()], options, host);
  issues.push(...duplicateTopLevelNames(program, files, rel));
  const diagnostics = [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.file || !files.has(diagnostic.file.fileName)) continue;
    const syntactic = diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code < 2000;
    if (!RELEVANT_CODES.has(diagnostic.code) && !syntactic) continue;
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const where = `${diagnostic.file.fileName.replace(/^\/public/, "public")}:${line + 1}`;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const key = `${where} ${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(`${rel}: ${where} ${message}`);
  }

  return issues;
}

const issues = htmlPages().flatMap(checkPage);
if (issues.length) {
  console.error(issues.join("\n"));
  console.error(`\n脚本依赖检查失败：${issues.length} 个问题。`);
  process.exit(1);
}
console.log("脚本依赖检查通过。");
