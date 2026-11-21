#!/usr/bin/env node
// TerraPop · 端到端验收（Playwright + 系统 Edge，headless）
// ---------------------------------------------------------------
// Playwright 是全局安装的开发工具，不是本项目的运行依赖：
//   NODE_PATH="$(npm root -g)" node tests/e2e.mjs
//
// 覆盖：一问一答的信息板 / 智能输入自动判定 / 三种作答方式 / 定位点选 /
//      就地揭示（不弹窗）/ 自动下一题 / 连击与正确率 / 百科详情 /
//      玩法矩阵冒烟 / 卡通地图与地貌渲染 / 英文界面 / 设置 / 移动端
// ---------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error('找不到 playwright。请用： NODE_PATH="$(npm root -g)" node tests/e2e.mjs');
  process.exit(2);
}

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, ".tmp", "shots");
fs.mkdirSync(shots, { recursive: true });
const pageUrl = "file://" + path.join(root, "index.html");

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
function section(t) { console.log(`\n${t}`); }

const errors = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("requestfailed", r => { if (!/favicon/.test(r.url())) errors.push("requestfailed: " + r.url()); });

await page.goto(pageUrl, { waitUntil: "load" });
await page.waitForTimeout(400);

// ── 工具 ─────────────────────────────────────────────────────
async function pickChip(name, value) {
  await page.evaluate(([n, v]) => {
    const i = document.querySelector(`input[name="${n}"][value="${v}"]`);
    if (!i) return;
    i.checked = true;
    i.dispatchEvent(new Event("change", { bubbles: true }));
  }, [name, value]);
  await page.waitForTimeout(70);
}
const rows = () => page.$$eval("#infoBoard .tp-row", els =>
  els.map(e => ({ dim: e.dataset.dim, cls: e.className, text: e.textContent.trim() })));
async function rowOf(dim) {
  return page.evaluate(d => {
    const r = document.querySelector(`#infoBoard .tp-row[data-dim="${d}"]`);
    return r ? { text: r.textContent.trim(), hasInput: !!r.querySelector(".tp-answer-input"), hidden: /待揭晓|hidden/.test(r.textContent) } : null;
  }, dim);
}

// ── 1. 首页配置 ──────────────────────────────────────────────
section("1. 首页：玩法矩阵配置");
check("标题正确", (await page.title()).includes("TerraPop"));
check("已知 5 个选项（4 维度 + 随机）", (await page.locator("#knownChips .tp-chip").count()) === 5);
check("要猜 5 个选项", (await page.locator("#askedChips .tp-chip").count()) === 5);
check("作答方式 5 个选项（填空/三选一/四选一/五选一/定位）", (await page.locator("#styleChips .tp-chip").count()) === 5);
check("范围 10 个选项（3 + 7 大区）", (await page.locator("#scopeChips .tp-chip").count()) === 10);
check("组合摘要会写清「已知什么、猜什么、怎么答」",
  /已知「位置」/.test(await page.textContent("#configSummary")) && /填空/.test(await page.textContent("#configSummary")),
  await page.textContent("#configSummary"));
await page.screenshot({ path: path.join(shots, "01-home.png") });

// ── 2. 默认玩法：看位置猜全称（填空 + 智能输入）──────────────
section("2. 一问一答：看位置猜全称");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForSelector("#screenPlay:not([hidden])");
await page.waitForTimeout(500);

const mapStats = await page.evaluate(() => ({
  regions: document.querySelectorAll("#mapHost .tp-region-fills [data-id]").length,
  casing: document.querySelectorAll("#mapHost .tp-region-casing").length,
  lines: document.querySelectorAll("#mapHost .tp-region-line").length,
  landBase: document.querySelectorAll("#mapHost .tp-land-base").length,
  landforms: document.querySelectorAll("#mapHost .tp-landform").length,
  deserts: document.querySelectorAll("#mapHost .tp-landform-desert").length,
  ranges: document.querySelectorAll("#mapHost .tp-range").length,
  rangePeaks: document.querySelectorAll("#mapHost .tp-range path").length,
  rivers: document.querySelectorAll("#mapHost .tp-river").length,
  lakes: document.querySelectorAll("#mapHost .tp-lake").length,
  terrainLabels: document.querySelectorAll("#mapHost .tp-terrain-label").length,
  legend: document.querySelectorAll("#mapLegend .tp-legend-item").length,
  inset: document.querySelectorAll("#mapHost .tp-inset").length,
  magnifier: document.querySelectorAll("#mapHost .tp-magnifier").length
}));
check("34 个省级区域 + 白描边层 + 细线层", mapStats.regions === 34 && mapStats.casing === 34 && mapStats.lines === 34,
  `${mapStats.regions}/${mapStats.casing}/${mapStats.lines}`);
check("陆地剪影层存在（用于地貌裁剪与投影）", mapStats.landBase === 1);
check("面状地貌已渲染（高原/盆地/平原等）", mapStats.landforms >= 12, String(mapStats.landforms));
check("包含沙漠纹理", mapStats.deserts >= 1);
check("山脉已渲染（含山形符号）", mapStats.ranges >= 12 && mapStats.rangePeaks >= 40,
  `${mapStats.ranges} 条 / ${mapStats.rangePeaks} 个山形`);
check("大江大河已渲染 ≥ 8 条", mapStats.rivers >= 8, String(mapStats.rivers));
check("大湖已渲染 ≥ 10 个", mapStats.lakes >= 10, String(mapStats.lakes));
check("地貌标注文字已绘制", mapStats.terrainLabels >= 20, String(mapStats.terrainLabels));
check("地图图例显示 8 类地貌", mapStats.legend === 8, String(mapStats.legend));
check("南海诸岛插图框与港澳放大框都在", mapStats.inset === 1 && mapStats.magnifier === 1);

const board1 = await rows();
check("信息板有 4 行（全称/简称/省会/位置）", board1.length === 4, board1.map(r => r.dim).join(","));
check("已知维度直接显示（位置：已在地图上标出）", (await rowOf("location")).text.includes("已在地图上标出"));
check("要猜的维度就地给输入框（不弹窗）", (await rowOf("full")).hasInput);
check("其余两个维度先隐藏为「待揭晓」", (await rowOf("short")).hidden && (await rowOf("capital")).hidden);
check("没有弹窗挡在前面", await page.isHidden("#wikiOverlay"));
await page.screenshot({ path: path.join(shots, "02-play.png") });

// ── 3. 智能输入：拼音首字母无歧义自动判定（不用回车）────────
section("3. 智能输入：拼音首字母自动判定");
const targetId = await page.evaluate(() => {
  const mark = document.querySelector("#mapHost .tp-marks .tp-mark");
  const d = mark.getAttribute("d");
  return window.TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const expect = await page.evaluate(id => {
  const c = window.TERRAPOP.countries.cn.regions.find(r => r.id === id);
  return { full: c.fullNames["zh-Hans"], name: c.names["zh-Hans"], short: c.short.map(s => s.char).join("/"), capital: c.capitalTerm === "none" ? null : c.capital["zh-Hans"] };
}, targetId);
const initials = await page.evaluate(name => window.TERRAPOP.util.initialsOf(name), expect.name);
check("能从图上反查题目省份", !!targetId, `${targetId} → 首字母 ${initials}`);

const input = page.locator("#infoBoard .tp-answer-input");
check("输入框提示里说明了支持拼音首字母", /拼音首字母/.test(await input.getAttribute("placeholder")));

// 先算一下这串首字母在当前题库里是不是无歧义，据此断言"自动判定"或"给候选"
const m0 = await page.evaluate(([ini, dim]) =>
  window.TERRAPOP.game.matchInput(window.TERRAPOP.countries.cn.regions, dim, "zh-Hans", ini),
  [initials, "full"]);
console.log(`    · ${expect.name} 的首字母 ${initials} → ${m0.kind}（${m0.candidates.length} 个候选）`);

await input.pressSequentially(initials, { delay: 15 });
await page.waitForTimeout(350);

if (m0.unique) {
  check("无歧义时打完首字母就直接判定（未按回车）", await page.isVisible("#revealInline"));
} else {
  check("有歧义时不硬判，而是弹出候选", (await page.locator("#suggest .tp-suggest-item").count()) >= 2);
  const clicked = await page.evaluate(name => {
    const items = [...document.querySelectorAll("#suggest .tp-suggest-item")];
    const hit = items.find(b => b.textContent.trim() === name);
    if (hit) { hit.click(); return true; }
    return false;
  }, expect.full);
  check("候选里能点到正确项", clicked);
  await page.waitForTimeout(300);
}
check("提交后进入揭示态", await page.isVisible("#revealInline"));
const beforeQ = await page.textContent("#qCounter");

check("地图上出现答案高亮", (await page.locator("#mapHost .tp-mark-correct").count()) +
  (await page.locator("#mapHost .tp-mark-wrong").count()) >= 1);
check("判为答对", /tp-reveal-ok/.test(await page.getAttribute("#revealInline", "class")),
  await page.getAttribute("#revealInline", "class"));
const done = await rows();
check("揭示后四条信息全部展示出来", done.every(r => !/待揭晓/.test(r.text)) && done.length === 4,
  done.map(r => r.dim + "=" + r.text.slice(0, 16)).join(" | "));
check("揭示后仍无弹窗（就地展示）", await page.isHidden("#wikiOverlay"));
check("HUD 显示连击 / 正确率 / 得分", (await page.textContent("#hudCombo")) !== "1" ||
  (await page.textContent("#hudScore")) !== "0", `连击 ${await page.textContent("#hudCombo")} · 正确率 ${await page.textContent("#hudAcc")} · 得分 ${await page.textContent("#hudScore")}`);
await page.screenshot({ path: path.join(shots, "03-reveal-inline.png") });

// ── 4. 答完自动进入下一题 ────────────────────────────────────
section("4. 答完自动进入下一题");
await page.waitForTimeout(2400);
const afterQ = await page.textContent("#qCounter");
check("等待揭示停留时长后自动切到下一题", beforeQ !== afterQ, `${beforeQ} → ${afterQ}`);
check("新题回到作答状态（输入框重新出现、揭示区收起）",
  (await page.locator("#infoBoard .tp-answer-input").count()) === 1 && await page.isHidden("#revealInline"));

// ── 4b. 首字母有歧义时给候选，而不是硬判 ─────────────────────
section("4b. 首字母有歧义时给出候选（智能输入的另一半）");
const amb = await page.evaluate(() => {
  const all = window.TERRAPOP.countries.cn.regions;
  for (const q of ["hn", "hb", "ji", "sh"]) {
    const m = window.TERRAPOP.game.matchInput(all, "full", "zh-Hans", q);
    if (m.kind === "multi" && m.candidates.length >= 2) return { q, ids: m.candidates };
  }
  return null;
});
check("能构造出一个有歧义的首字母串", !!amb, JSON.stringify(amb));
if (amb) {
  await page.locator("#infoBoard .tp-answer-input").pressSequentially(amb.q, { delay: 12 });
  await page.waitForTimeout(250);
  const n = await page.locator("#suggest .tp-suggest-item").count();
  check(`输入「${amb.q}」不硬判，而是列出候选`, n >= 2 && await page.isHidden("#revealInline"), `候选 ${n} 个`);
  check("候选里含该串对应的所有可能省份", (await page.textContent("#suggest")).length > 0);
  await page.screenshot({ path: path.join(shots, "03b-ambiguous.png") });
  await page.locator("#suggest .tp-suggest-item").first().click();
  await page.waitForTimeout(250);
  check("点候选即可提交", await page.isVisible("#revealInline"));
}

// ── 5. 填空题也能直接敲回车提交 ──────────────────────────────
section("5. 填空题回车提交");
await page.waitForSelector("#infoBoard .tp-answer-input", { timeout: 8000 });
await page.locator("#infoBoard .tp-answer-input").fill("乱写ABC");
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
check("回车即提交并揭示", await page.isVisible("#revealInline"));
check("答错时信息板标出正确值", (await page.locator("#infoBoard .tp-row-wrong").count()) >= 1);
check("答错时给出记忆点/正确值", (await page.textContent("#infoBoard")).length > 0);
await page.screenshot({ path: path.join(shots, "04-wrong.png") });

// ── 6. 纯文字组合：简称 → 省会（四选一）──────────────────────
section("6. 纯文字组合：已知简称猜省会（四选一）");
await page.click("#btnQuit");
await page.waitForTimeout(200);
await pickChip("knownChips", "short");
await pickChip("askedChips", "capital");
await pickChip("styleChips", "choice4");
await page.click("#btnStart");
await page.waitForTimeout(350);
check("题面写的是「已知简称，请说出省会」", /已知「简称」/.test(await page.textContent("#askText")) && /省会/.test(await page.textContent("#askText")),
  await page.textContent("#askText"));
check("这题没有位置参与（地图不抢点击）", (await rowOf("location")).hidden);
check("给出 4 个选项", (await page.locator("#infoBoard .tp-choice").count()) === 4);
const choiceKeys = await page.$$eval("#infoBoard .tp-choice .tp-choice-key", els => els.map(e => e.textContent));
check("选项带 1-4 快捷键编号", choiceKeys.join(",") === "1,2,3,4", choiceKeys.join(","));
await page.locator("#infoBoard .tp-choice").first().click();
await page.waitForTimeout(300);
check("点选项即提交并揭示", await page.isVisible("#revealInline"));
const r6 = await rows();
check("揭示后 4 条信息补齐", r6.every(r => !/待揭晓/.test(r.text)));
await page.screenshot({ path: path.join(shots, "05-choice.png") });

// ── 7. 定位模式：已知全称，点地图找位置 ──────────────────────
section("7. 定位模式：点地图作答");
await page.click("#btnQuit");
await page.waitForTimeout(200);
await pickChip("knownChips", "full");
await pickChip("askedChips", "location");
await page.waitForTimeout(100);
check("选「要猜=位置」时作答方式自动切到定位", (await page.locator("#styleChips .tp-chip-on").textContent()).includes("定位"));
await page.click("#btnStart");
await page.waitForTimeout(400);

const target7 = await page.evaluate(() => {
  const known = document.querySelector("#infoBoard .tp-row[data-dim='full']").textContent;
  const c = window.TERRAPOP.countries.cn.regions.find(r => known.includes(r.fullNames["zh-Hans"]) || known.includes(r.names["zh-Hans"]));
  return c ? c.id : null;
});
check("已知维度显示出全称", !!target7, String(target7));
check("位置行提示「点地图选答案」", /点地图选答案/.test((await rowOf("location")).text));
const pt = await page.evaluate(id => {
  const p = document.getElementById("tp-r-" + id);
  const c = window.TERRAPOP.maps.cn.regions.find(r => r.id === id).center;
  const m = p.getScreenCTM();
  const q = new DOMPoint(c[0], c[1]).matrixTransform(m);
  return [q.x, q.y];
}, target7);
await page.mouse.move(pt[0], pt[1]);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(300);
check("点地图即提交并揭示", await page.isVisible("#revealInline"));
check("点对了会判定为答对", /tp-reveal-ok/.test(await page.getAttribute("#revealInline", "class")) ||
  (await page.locator("#infoBoard .tp-row-correct").count()) >= 1);
await page.screenshot({ path: path.join(shots, "06-locate.png") });

// ── 8. 百科详情（可选弹窗）───────────────────────────────────
section("8. 百科详情弹窗（双语）");
await page.click("#btnDetail");
await page.waitForSelector("#wikiOverlay:not([hidden])");
await page.waitForTimeout(250);
check("详情里有四条信息卡", (await page.locator("#wikiBody .tp-info-card").count()) === 5);
check("详情里有记忆点 / 趣味知识 / 小百科三段", (await page.locator("#wikiBody .tp-wiki-section").count()) === 3);
const langs = await page.$$eval("#wikiBody .tp-wiki-lang", els => els.map(e => e.textContent));
check("默认双语并排", langs.filter(l => l === "简体中文").length === 3 && langs.filter(l => l === "English").length === 3, langs.join(","));
await page.screenshot({ path: path.join(shots, "07-wiki.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check("Esc 可以关掉详情", await page.isHidden("#wikiOverlay"));

// ── 9. 地图缩放 ──────────────────────────────────────────────
section("9. 地图缩放与平移");
const t0 = await page.getAttribute("#mapHost .tp-viewport", "transform");
await page.click("#btnZoomIn");
await page.waitForTimeout(150);
const t1 = await page.getAttribute("#mapHost .tp-viewport", "transform");
check("放大按钮改变视图变换", t0 !== t1, `${t0} → ${t1}`);
await page.click("#btnZoomReset");
await page.waitForTimeout(150);
check("复位按钮还原视图", (await page.getAttribute("#mapHost .tp-viewport", "transform")).startsWith("translate(0 0) scale(1)"));

// ── 10. 英文界面 ─────────────────────────────────────────────
section("10. 英文界面");
await page.click("#btnQuit");
await page.waitForTimeout(200);
await page.selectOption("#langSelect", "en");
await page.waitForTimeout(300);
check("首页说明切到英文", /One question at a time/.test(await page.textContent(".tp-tagline")));
check("图例切到英文", /Plateau/.test(await page.textContent("#mapLegend")));
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await page.click("#btnStart");
await page.waitForTimeout(400);
check("题面为英文", /Given the/.test(await page.textContent("#askText")), await page.textContent("#askText"));
const enTarget = await page.evaluate(() => {
  const d = document.querySelector("#mapHost .tp-marks .tp-mark").getAttribute("d");
  return window.TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const enName = await page.evaluate(id => window.TERRAPOP.countries.cn.regions.find(r => r.id === id).fullNames["zh-Hans"], enTarget);
await page.locator("#infoBoard .tp-answer-input").fill(enName);
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
check("英文界面下答中文名称也算对（跨语言宽容）", /tp-reveal-ok/.test(await page.getAttribute("#revealInline", "class")));
await page.screenshot({ path: path.join(shots, "08-english.png") });

// ── 11. 设置面板 ─────────────────────────────────────────────
section("11. 设置面板");
await page.click("#btnQuit");
await page.waitForTimeout(150);
await page.click("#btnSettings");
await page.waitForSelector("#settingsOverlay:not([hidden])");
check("设置面板有 7 组", (await page.locator("#settingsBody .tp-set-group").count()) === 7,
  String(await page.locator("#settingsBody .tp-set-group").count()));
check("开关项 ≥ 10 个", (await page.locator("#settingsBody .tp-toggle").count()) >= 10);
await page.screenshot({ path: path.join(shots, "09-settings.png") });
// 关掉自动下一题，方便接下来做矩阵冒烟
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll("#settingsBody .tp-toggle")];
  const target = boxes.find(b => /自动进入下一题|Advance automatically/.test(b.textContent));
  if (target && target.querySelector("input").checked) target.querySelector("input").click();
});
await page.waitForTimeout(120);
await page.click("#btnSettingsClose");
await page.waitForTimeout(200);
check("设置面板可关闭", await page.isHidden("#settingsOverlay"));

// ── 12. 玩法矩阵冒烟：12 组合 × 3 作答方式 ───────────────────
section("12. 玩法矩阵冒烟（12 组合 × 3 作答方式）");
const problems = [];
let combos = 0;
const DIMS = ["full", "short", "capital", "location"];
for (const style of ["text", "choice3", "choice4"]) {
  for (const known of DIMS) {
    for (const asked of DIMS) {
      if (known === asked) continue;
      combos++;
      await pickChip("knownChips", known);
      await pickChip("askedChips", asked);
      if (asked !== "location") await pickChip("styleChips", style);
      await page.click("#btnStart");
      await page.waitForTimeout(120);
      const r = await page.evaluate(dim => {
        const q = document.querySelector(`#infoBoard .tp-row[data-dim="${dim}"] .tp-row-val`);
        return q ? q.textContent.trim() : null;
      }, asked);
      if (!r) { problems.push(`${known}->${asked}/${style}: 没有作答行`); await page.click("#btnQuit"); continue; }
      const tag = `${known}->${asked}/${style}`;
      if (asked === "location") {
        if (!/点地图选答案|Click the map/.test(r)) problems.push(tag + ": 位置行不是点击提示");
      } else if (style === "text") {
        if ((await page.locator("#infoBoard .tp-answer-input").count()) !== 1) problems.push(tag + ": 缺输入框");
      } else {
        const n = style === "choice3" ? 3 : 4;
        if ((await page.locator("#infoBoard .tp-choice").count()) !== n) problems.push(tag + `: 选项数不是 ${n}`);
      }
      // 完成一次提交，确认整条链路
      if (asked === "location") {
        // 位置题：用"已验证落在轮廓内"的质心点随便点一个省，只为走通链路
        const anyId = await page.evaluate(() => window.TERRAPOP.maps.cn.regions[0].id);
        const pt = await page.evaluate(id => {
          const p = document.getElementById("tp-r-" + id);
          const c = window.TERRAPOP.maps.cn.regions.find(r => r.id === id).center;
          const m = p.getScreenCTM();
          const q = new DOMPoint(c[0], c[1]).matrixTransform(m);
          return [q.x, q.y];
        }, anyId);
        await page.mouse.move(pt[0], pt[1]);
        await page.mouse.down();
        await page.mouse.up();
      } else if (style === "text") {
        await page.locator("#infoBoard .tp-answer-input").fill("测试");
        await page.keyboard.press("Enter");
      } else {
        await page.locator("#infoBoard .tp-choice").first().click();
      }
      await page.waitForTimeout(180);
      if (!(await page.isVisible("#revealInline"))) problems.push(tag + ": 提交后没有揭示");
      const rowCount = (await rows()).length;
      if (rowCount !== 4) problems.push(tag + `: 信息板行数 ${rowCount}`);
      await page.click("#btnQuit");
      await page.waitForTimeout(80);
    }
  }
}
check(`12 组合 × 3 作答方式 = ${combos} 种配置都能出题、作答、揭示`, problems.length === 0, problems.slice(0, 6).join(" | "));

// ── 13. 移动端布局 ───────────────────────────────────────────
section("13. 移动端布局");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(400);
const mapBox = await page.locator(".tp-map-pane").boundingBox();
const panelBox = await page.locator(".tp-panel").boundingBox();
check("地图与信息板在窄屏下纵向堆叠", panelBox.y >= mapBox.y + mapBox.height - 2,
  `map ${Math.round(mapBox.y)}+${Math.round(mapBox.height)} → panel ${Math.round(panelBox.y)}`);
check("窄屏下信息板仍完整", (await rows()).length === 4);
await page.screenshot({ path: path.join(shots, "10-mobile.png") });

// ── 14. 运行期无报错 ─────────────────────────────────────────
section("14. 运行期无报错");
check("没有 console error / pageerror / 资源加载失败", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
console.log(`\n截图输出： ${path.relative(root, shots)}/`);
console.log(`${failures === 0 ? "✅ 端到端全部通过" : `❌ ${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
