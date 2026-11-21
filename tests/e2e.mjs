#!/usr/bin/env node
// TerraPop · 端到端验收（Playwright + 系统 Edge，headless）
// ---------------------------------------------------------------
// Playwright 是全局安装的开发工具，不是本项目的运行依赖：
//   NODE_PATH="$(npm root -g)" node tests/e2e.mjs
// 也可以用 npx 或改成本地安装后的 import。
//
// 覆盖：页面无报错 → 首页配置 → 出题（看位置猜省份）→ 答对 → 揭示卡含双语百科
//      → 下一题 → 切换到"看名称找位置"并点击地图作答 → 切换英文界面 → 设置面板
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
  console.error("找不到 playwright。请用： NODE_PATH=\"$(npm root -g)\" node tests/e2e.mjs");
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
page.on("requestfailed", r => {
  // file:// 下 favicon 之类的失败忽略
  if (!/favicon/.test(r.url())) errors.push("requestfailed: " + r.url());
});

await page.goto(pageUrl, { waitUntil: "load" });
await page.waitForTimeout(400);

// ── 1. 页面加载 ───────────────────────────────────────────────
section("1. 页面加载");
check("标题正确", (await page.title()).includes("TerraPop"));
check("首页可见", await page.isVisible("#screenHome"));
check("玩法选项 5 个", (await page.locator("#homeModeList .tp-option").count()) === 5);
check("范围选项 10 个（3 + 7 大区）", (await page.locator("#homeScopeList .tp-chip-option").count()) === 10);
check("范围提示显示覆盖数量", /34/.test(await page.textContent("#homeRegionCount")));
await page.screenshot({ path: path.join(shots, "01-home.png") });

// ── 2. 开始一局（默认：看位置猜省份）──────────────────────────
section("2. 出题与地图渲染");
await page.click("#btnStart");
await page.waitForSelector("#screenPlay:not([hidden])");
await page.waitForTimeout(600);

const mapStats = await page.evaluate(() => ({
  regions: document.querySelectorAll("#mapHost .tp-regions [data-id]").length,
  inset: document.querySelectorAll("#mapHost .tp-inset").length,
  magnifier: document.querySelectorAll("#mapHost .tp-magnifier").length,
  rivers: document.querySelectorAll("#mapHost .tp-river").length,
  lakes: document.querySelectorAll("#mapHost .tp-lake").length,
  mountains: document.querySelectorAll("#mapHost .tp-mountain").length,
  labels: document.querySelectorAll("#mapHost .tp-label-main").length,
  capitals: document.querySelectorAll("#mapHost .tp-capital").length,
  dashed: document.querySelectorAll("#mapHost .tp-dash-line").length
}));
check("地图渲染 34 个省级区域", mapStats.regions === 34, String(mapStats.regions));
check("南海诸岛插图框存在", mapStats.inset === 1 && mapStats.dashed >= 1);
check("港澳放大框存在", mapStats.magnifier === 1);
check("江河已绘制", mapStats.rivers === 5, String(mapStats.rivers));
check("湖泊已绘制", mapStats.lakes === 10, String(mapStats.lakes));
check("山脉装饰已绘制", mapStats.mountains >= 20, String(mapStats.mountains));
check("省会标记点已生成 34 个", mapStats.capitals === 34, String(mapStats.capitals));
check("题面已在图上高亮一个省", (await page.locator("#mapHost .tp-marks .tp-mark-given").count()) === 1);
const askedDims = await page.$$eval("#answerArea .tp-answer-row", rows => rows.map(r => r.dataset.dim));
check("作答区覆盖本题要猜的每个维度", askedDims.length >= 2 &&
  askedDims.every(d => ["full", "short", "capital", "location"].includes(d)), askedDims.join(","));
await page.screenshot({ path: path.join(shots, "02-play.png") });

// 从高亮轮廓反查正确答案
async function currentAnswerId() {
  return page.evaluate(() => {
    const mark = document.querySelector("#mapHost .tp-marks .tp-mark");
    if (!mark) return null;
    const d = mark.getAttribute("d");
    const r = window.TERRAPOP.maps.cn.regions.find(x => x.d === d);
    return r ? r.id : null;
  });
}
async function expectedOf(id) {
  return page.evaluate(rid => {
    const c = window.TERRAPOP.countries.cn.regions.find(r => r.id === rid);
    return {
      full: c.fullNames["zh-Hans"],
      short: c.short[0].char,
      capital: c.capitalTerm === "none" ? null : c.capital["zh-Hans"],
      name: c.names["zh-Hans"]
    };
  }, id);
}

const ansId = await currentAnswerId();
check("能从图上反查出题目对应的省份", !!ansId, String(ansId));
const exp = await expectedOf(ansId);

/** 按维度填文本答案（该维度不存在时自动跳过，例如直辖市没有省会） */
async function fillText(dim, value) {
  const inp = page.locator(`#answerArea .tp-answer-row[data-dim="${dim}"] .tp-input`);
  if (await inp.count()) { await inp.first().fill(value); return true; }
  return false;
}
async function fillAllInputs(value) {
  const n = await page.locator("#answerArea .tp-input").count();
  for (let i = 0; i < n; i++) await page.locator("#answerArea .tp-input").nth(i).fill(value);
  return n;
}

// ── 3. 答对 → 揭示卡 ─────────────────────────────────────────
section("3. 作答与揭示卡");
await fillText("full", exp.full);
await fillText("short", exp.short);
if (exp.capital) await fillText("capital", exp.capital);
await page.click("#btnSubmit");
await page.waitForSelector("#revealOverlay:not([hidden])");
await page.waitForTimeout(350);

check("判定为答对", (await page.textContent("#revealBadge")).includes("答对"));
check("揭示卡标题为全称", (await page.textContent("#revealTitle")) === exp.full);
check("四维信息卡 5 张（含类型/大区）", (await page.locator("#revealBody .tp-info-card").count()) === 5);
check("揭示了百科分区（记忆点/趣味知识/小百科）", (await page.locator("#revealBody .tp-wiki-section").count()) === 3);
const wikiLangs = await page.$$eval("#revealBody .tp-wiki-lang", els => els.map(e => e.textContent));
check("百科默认双语并排", wikiLangs.filter(l => l === "简体中文").length === 3 && wikiLangs.filter(l => l === "English").length === 3,
  wikiLangs.join(","));
check("地图上出现正确省的高亮", (await page.locator("#mapHost .tp-mark-correct").count()) === 1);
check("地图上出现省名标签", (await page.locator("#mapHost .tp-label-main").count()) === 1);
await page.screenshot({ path: path.join(shots, "03-reveal.png") });

// ── 4. 答错路径 ──────────────────────────────────────────────
section("4. 答错也能揭示全部信息");
await page.click("#btnRevealNext");
await page.waitForTimeout(350);
const filledWrong = await fillAllInputs("乱写的答案");
await page.click("#btnSubmit");
await page.waitForSelector("#revealOverlay:not([hidden])");
await page.waitForTimeout(300);
check("判定为答错", (await page.textContent("#revealBadge")).includes("答错"));
check("答错时依然展示完整百科", (await page.locator("#revealBody .tp-wiki-section").count()) === 3);
check("答错时标出错误信息卡", (await page.locator("#revealBody .tp-info-wrong").count()) === filledWrong,
  `wrong=${await page.locator("#revealBody .tp-info-wrong").count()} filled=${filledWrong}`);
await page.screenshot({ path: path.join(shots, "04-wrong.png") });

// ── 5. 位置点击作答 ──────────────────────────────────────────
section("5. 位置点击作答（看名称找位置）");
await page.click("#btnRevealNext");
await page.waitForTimeout(300);
await page.click("#btnQuit");
await page.waitForTimeout(250);
await page.check('input[name="tp-mode"][value="name-to-location"]');
await page.waitForTimeout(150);
await page.click("#btnStart");
await page.waitForSelector("#screenPlay:not([hidden])");
await page.waitForTimeout(500);

const knownName = (await page.textContent("#knownCard")).trim();
check("题面给出了全称", knownName.includes("全称"), knownName);
const targetId = await page.evaluate(name => {
  const c = window.TERRAPOP.countries.cn;
  const hit = c.regions.find(r => name.includes(r.fullNames["zh-Hans"]) || name.includes(r.names["zh-Hans"]));
  return hit ? hit.id : null;
}, knownName);
check("能定位到目标省份", !!targetId, String(targetId));

const clicked = await page.evaluate(id => {
  const p = document.getElementById("tp-r-" + id);
  if (!p) return null;
  const b = p.getBBox();
  const r = p.getBoundingClientRect();
  return { bbox: [b.x, b.y, b.width, b.height], rect: [r.x, r.y, r.width, r.height] };
}, targetId);
check("目标省份 path 可计算包围盒", clicked && clicked.bbox[2] > 0);

// 用"已验证落在本省轮廓内"的质心点来点击，避免窄条省份的包围盒中心落在多边形外
const clickPoint = await page.evaluate(id => {
  const path = document.getElementById("tp-r-" + id);
  const c = window.TERRAPOP.maps.cn.regions.find(r => r.id === id).center;
  const m = path.getScreenCTM();
  const p = new DOMPoint(c[0], c[1]).matrixTransform(m);
  return [p.x, p.y];
}, targetId);
await page.mouse.move(clickPoint[0], clickPoint[1]);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(250);
check("点击后地图上出现选择标记", (await page.locator("#mapHost .tp-mark-picked").count()) === 1);
check("点击后面板显示已选中的省名", (await page.textContent("#answerArea .tp-location-box")).trim().length > 0,
  (await page.textContent("#answerArea .tp-location-box")).trim());
await page.screenshot({ path: path.join(shots, "05-click-location.png") });

const shortVal = await page.evaluate(id => window.TERRAPOP.countries.cn.regions.find(r => r.id === id).short[0].char, targetId);
await fillText("short", shortVal);
await page.click("#btnSubmit");
await page.waitForSelector("#revealOverlay:not([hidden])");
await page.waitForTimeout(300);
check("点位置答对后判定为答对", (await page.textContent("#revealBadge")).includes("答对"));

// ── 6. 英文界面 ──────────────────────────────────────────────
section("6. 切换英文界面");
await page.click("#btnRevealNext");
await page.waitForTimeout(200);
await page.click("#btnQuit");
await page.waitForTimeout(200);
await page.selectOption("#langSelect", "en");
await page.waitForTimeout(300);
check("首页标题切换为英文描述", (await page.textContent(".tp-tagline")).startsWith("A hand-drawn map"));
check("玩法选项切换为英文", (await page.textContent("#homeModeList .tp-option b")).length > 0);
check("html lang 属性更新", (await page.getAttribute("html", "lang")) === "en");

await page.check('input[name="tp-mode"][value="location-to-name"]');
await page.waitForTimeout(150);
await page.click("#btnStart");
await page.waitForTimeout(500);
const enInputs = page.locator("#answerArea .tp-input");
check("英文占位符生效", /e\.g\./.test(await enInputs.first().getAttribute("placeholder")));
await page.screenshot({ path: path.join(shots, "06-english.png") });

// 英文界面下用中文答题，验证跨语言宽容
const enAnsId = await currentAnswerId();
const enExp = await expectedOf(enAnsId);
await fillText("full", enExp.full);
await fillText("short", enExp.short);
if (enExp.capital) await fillText("capital", enExp.capital);
await page.click("#btnSubmit");
await page.waitForSelector("#revealOverlay:not([hidden])");
await page.waitForTimeout(300);
check("英文界面下答中文名称也算对（跨语言宽容）", (await page.textContent("#revealBadge")).includes("Correct"),
  await page.textContent("#revealBadge"));
await page.screenshot({ path: path.join(shots, "07-reveal-en.png") });

// ── 7. 设置面板 ──────────────────────────────────────────────
section("7. 设置面板与难度旋钮");
await page.click("#btnRevealNext");
await page.waitForTimeout(250);
await page.click("#btnSettings");
await page.waitForSelector("#settingsOverlay:not([hidden])");
const groupsInSettings = await page.locator("#settingsBody .tp-set-group").count();
const togglesInSettings = await page.locator("#settingsBody .tp-toggle").count();
check("设置面板有 6 组选项", groupsInSettings === 6, String(groupsInSettings));
check("有 6 个开关（提示/音效/动画/朗读）", togglesInSettings === 6, String(togglesInSettings));
await page.screenshot({ path: path.join(shots, "08-settings.png") });
await page.click("#btnSettingsClose");
await page.waitForTimeout(250);
check("设置面板可关闭", await page.isHidden("#settingsOverlay"));

// ── 8. 缩放交互 ──────────────────────────────────────────────
section("8. 地图缩放");
const before = await page.getAttribute("#mapHost .tp-viewport", "transform");
await page.click("#btnZoomIn");
await page.waitForTimeout(150);
const after = await page.getAttribute("#mapHost .tp-viewport", "transform");
check("放大按钮改变视图变换", before !== after, `${before} → ${after}`);
await page.click("#btnZoomReset");
await page.waitForTimeout(150);
check("复位按钮还原视图", (await page.getAttribute("#mapHost .tp-viewport", "transform")).startsWith("translate(0 0) scale(1)"));

// ── 9. 移动端视口 ────────────────────────────────────────────
section("9. 移动端布局");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const mapBox = await page.locator(".tp-map-pane").boundingBox();
const panelBox = await page.locator(".tp-panel").boundingBox();
check("地图与面板在窄屏下纵向堆叠", panelBox.y >= mapBox.y + mapBox.height - 2,
  `map.y=${Math.round(mapBox.y)}+${Math.round(mapBox.height)} panel.y=${Math.round(panelBox.y)}`);
await page.screenshot({ path: path.join(shots, "09-mobile.png"), fullPage: false });

// ── 10. 控制台干净 ───────────────────────────────────────────
section("10. 运行期无报错");
check("没有 console error / pageerror / 资源加载失败", errors.length === 0, errors.slice(0, 5).join(" | "));

await browser.close();

console.log(`\n截图输出： ${path.relative(root, shots)}/`);
console.log(`${failures === 0 ? "✅ 端到端全部通过" : `❌ ${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
