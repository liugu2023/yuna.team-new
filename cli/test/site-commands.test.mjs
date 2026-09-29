import assert from "node:assert/strict";
import test from "node:test";
import { runJoin } from "../dist/commands/join.js";
import { runLesson } from "../dist/commands/lesson.js";
import { resolveSafeLink } from "../dist/links.js";

const BASE = "https://example.test";
const jsonRecord = (value) => ({ kind: "json", content: JSON.stringify(value) });

function context(api, flags = {}) {
  const output = [];
  return {
    api: { base: BASE, ...api },
    flags: { json: true, all: false, with: [], ...flags },
    positionals: [],
    width: 88,
    out: (line = "") => output.push(line),
    output,
  };
}

test("join falls back to open for missing or malformed recruitment state", async () => {
  const states = [
    null,
    { kind: "markdown", content: '{"closed":true}' },
    { kind: "json", content: "{" },
    jsonRecord(null),
    jsonRecord({}),
    jsonRecord({ closed: "true" }),
    jsonRecord({ closed: 1 }),
    jsonRecord({ closed: false }),
  ];
  for (const state of states) {
    const ctx = context({ getRecords: async () => ({ "recruitment-status": state }) });
    await runJoin(ctx);
    const result = JSON.parse(ctx.output.join("\n"));
    assert.equal(result.closed, false);
    assert.equal(result.recruitmentStatus, "open");
    assert.equal(result.steps.length, 3);
    assert.equal(result.kpi.length, 3);
    assert.deepEqual(result.stats, []);
    assert.equal(result.recapUrl, null);
    assert.ok(result.actions.some((action) => action.url === `${BASE}/join#contact`));
  }
});

test("closed recruitment uses published recap fields and omits stale registration data", async () => {
  const records = {
    "recruitment-status": jsonRecord({ version: 1, closed: true }),
    "join-hero-copy": jsonRecord({ fields: { lead: "旧报名说明", primaryAction: "旧报名按钮" }, hrefs: { primaryAction: "/register" } }),
    "join-contact-card": jsonRecord({ fields: { body: "旧报名联系方式" }, hrefs: { primaryAction: "/register" } }),
    "join-process-register": jsonRecord({ fields: { title: "旧报名流程" } }),
    "join-closed-notice": jsonRecord({ fields: { title: "本轮已收官", lead: "感谢参与" } }),
    "recap-stat-signup": jsonRecord({ fields: { title: "报名人数", body: "160" } }),
    "recap-stat-admitted": jsonRecord({ fields: { body: "42" } }),
    "recap-contact": jsonRecord({ fields: { lead: "欢迎邮件咨询", primaryAction: "发邮件" }, hrefs: { primaryAction: "mailto:hello@example.test" } }),
  };
  let requestCount = 0;
  const api = {
    getRecords: async (keys) => {
      requestCount++;
      assert.ok(keys.includes("recruitment-status"));
      assert.ok(keys.includes("recap-stat-signup"));
      return records;
    },
  };
  const ctx = context(api);
  await runJoin(ctx);
  const result = JSON.parse(ctx.output.join("\n"));
  assert.equal(requestCount, 1);
  assert.equal(result.closed, true);
  assert.equal(result.recruitmentStatus, "closed");
  assert.equal(result.title, "本轮已收官");
  assert.equal(result.lead, "感谢参与");
  assert.deepEqual(result.steps, []);
  assert.deepEqual(result.kpi, []);
  assert.deepEqual(result.stats[0], { label: "报名人数", value: "160" });
  assert.equal(result.stats[3].value, "42");
  assert.equal(result.contact.body, "欢迎邮件咨询");
  assert.equal(result.url, `${BASE}/join`);
  assert.equal(result.recapUrl, `${BASE}/recap`);
  assert.ok(result.actions.some((action) => action.url === `${BASE}/recap.html`));
  assert.ok(result.actions.some((action) => action.url === `${BASE}/lesson-plan.html`));
  assert.ok(result.actions.some((action) => action.url === "mailto:hello@example.test"));
  assert.doesNotMatch(ctx.output.join("\n"), /旧报名|join#contact|\/register/);

  const textCtx = context(api, { json: false });
  await runJoin(textCtx);
  assert.match(textCtx.output.join("\n"), /本轮已收官/);
  assert.match(textCtx.output.join("\n"), /报名人数\s+160/);
  assert.match(textCtx.output.join("\n"), /mailto:hello@example.test/);
  assert.doesNotMatch(textCtx.output.join("\n"), /旧报名|招新流程|联系与报名方式|join#contact|\/register/);
});

test("join preserves mailto and relative links and excludes unsafe actions", async () => {
  const ctx = context({ getRecords: async () => ({
    "join-hero-copy": jsonRecord({ hrefs: { primaryAction: "mailto:hello@example.test", secondaryAction: "../departments" } }),
    "join-contact-card": jsonRecord({ hrefs: { primaryAction: "javascript:alert(1)", secondaryAction: "data:text/html,x" } }),
  }) });
  await runJoin(ctx);
  const result = JSON.parse(ctx.output.join("\n"));
  assert.deepEqual(result.actions.map((action) => action.url), ["mailto:hello@example.test", `${BASE}/departments`]);
});

test("join propagates network failures instead of claiming recruitment is open", async () => {
  const failure = new Error("network unavailable");
  const ctx = context({ getRecords: async () => { throw failure; } });
  await assert.rejects(runJoin(ctx), (error) => error === failure);
  assert.deepEqual(ctx.output, []);
});

test("lesson retains relative attachments and unlabeled or email links in both output formats", async () => {
  const plan = { terms: [{ label: "第10届", lessons: [{
    topic: "从零开始部署服务",
    instructor: "小林",
    links: [
      { label: "课件", url: "/media/intro.pdf" },
      { url: "https://resources.example.test/notes" },
      { label: "咨询", url: "mailto:teacher@example.test" },
      { label: "锚点", url: "#materials" },
      { label: "危险脚本", url: "javascript:alert(1)" },
      { label: "危险数据", url: "data:text/html,bad" },
      { label: "无地址" },
    ],
  }] }] };
  const api = { getJsonRecord: async () => plan };
  const ctx = context(api);
  await runLesson(ctx);
  const result = JSON.parse(ctx.output.join("\n"));
  assert.deepEqual(result.terms[0].lessons[0].links, [
    { label: "课件", url: `${BASE}/media/intro.pdf` },
    { label: "https://resources.example.test/notes", url: "https://resources.example.test/notes" },
    { label: "咨询", url: "mailto:teacher@example.test" },
    { label: "锚点", url: `${BASE}/lesson-plan#materials` },
  ]);
  const textCtx = context(api, { json: false });
  await runLesson(textCtx);
  const text = textCtx.output.join("\n");
  assert.match(text, /授课人 小林/);
  assert.match(text, /https:\/\/example.test\/media\/intro.pdf/);
  assert.match(text, /https:\/\/resources.example.test\/notes/);
  assert.match(text, /mailto:teacher@example.test/);
  assert.doesNotMatch(text, /危险|javascript:|data:/);
});

test("lesson selects the newest numeric term unless an explicit order overrides it", async () => {
  const terms = [
    { label: "第9届", lessons: [] },
    { label: "第10届", lessons: [] },
    { label: "第2届", lessons: [] },
  ];
  const api = { getJsonRecord: async () => ({ terms }) };
  const latestCtx = context(api);
  await runLesson(latestCtx);
  assert.deepEqual(JSON.parse(latestCtx.output.join("\n")).terms.map((term) => term.label), ["第10届"]);
  const allCtx = context(api, { all: true });
  await runLesson(allCtx);
  assert.deepEqual(JSON.parse(allCtx.output.join("\n")).terms.map((term) => term.label), ["第10届", "第9届", "第2届"]);
  terms[0].order = 5;
  const orderedCtx = context(api);
  await runLesson(orderedCtx);
  assert.equal(JSON.parse(orderedCtx.output.join("\n")).terms[0].label, "第9届");
});

test("safe links resolve URLs using their page and reject other protocols", () => {
  assert.equal(resolveSafeLink("/media/slides.pdf", BASE, "/join"), `${BASE}/media/slides.pdf`);
  assert.equal(resolveSafeLink("#contact", BASE, "/join"), `${BASE}/join#contact`);
  assert.equal(resolveSafeLink("../guide", BASE, "/page/first"), `${BASE}/guide`);
  assert.equal(resolveSafeLink("//cdn.example.test/slides.pdf", BASE), "https://cdn.example.test/slides.pdf");
  assert.equal(resolveSafeLink("mailto:hello@example.test?subject=Hi", BASE), "mailto:hello@example.test?subject=Hi");
  for (const value of ["javascript:alert(1)", "data:text/html,x", "file:///C:/secret", "ftp://example.test", "java\nscript:alert(1)", "\u001b[31munsafe", "", null]) {
    assert.equal(resolveSafeLink(value, BASE), "");
  }
});
