#!/usr/bin/env node
// TerraPop · 端到端验收（Playwright + 系统 Edge，headless）
// ---------------------------------------------------------------
// Playwright 是全局安装的开发工具，不是本项目的运行依赖：
//   NODE_PATH="$(npm root -g)" node tests/e2e.mjs
//
// 重点验收「位置固定 + 零阻断」：
//   · 第一题上方卡片是玩法说明
//   · 答完立刻换下一题（无揭示态、无弹窗、无等待），上一题信息落到上方卡片
//   · 作答区与首个选项的屏幕坐标在多题之间完全一致
//   · 选择题：问题在上、选项在下
//   · 已知位置时地图有聚光灯，一眼能看到高亮在哪
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

// 浏览器通道：本地默认用系统 Edge；CI 里用 TP_CHANNEL=bundled 走 Playwright 自带的 Chromium
const CHANNEL = process.env.TP_CHANNEL || "msedge";
const LAUNCH = CHANNEL === "bundled" ? {} : { channel: CHANNEL };

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
function section(t) { console.log(`\n${t}`); }

const errors = [];
const browser = await chromium.launch(Object.assign({ headless: true }, LAUNCH));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();

page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("requestfailed", r => { if (!/favicon/.test(r.url())) errors.push("requestfailed: " + r.url()); });

await page.goto(pageUrl, { waitUntil: "load" });
await page.waitForTimeout(350);

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
const head = () => page.textContent("#qCounter");
async function platformFonts(selector) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  await cdp.detach();
  return (fonts || []).map(f => f.familyName);
}
const prevInfo = () => page.evaluate(() => ({
  isAnswer: document.getElementById("prevCard").classList.contains("tp-prev-answer"),
  title: (document.querySelector("#prevCard .tp-prev-title") || {}).textContent || "",
  cells: document.querySelectorAll("#prevCard .tp-prev-cell").length,
  wiki: document.querySelectorAll("#prevCard .tp-wiki-section").length,
  name: (document.querySelector("#prevCard .tp-prev-name") || {}).textContent || "",
  verds: (document.querySelector("#prevCard .tp-verdict") || {}).textContent || ""
}));
async function leaveGame() {
  if (await page.isHidden("#screenPlay")) return;
  await page.click("#btnQuit");
  await page.waitForTimeout(90);
  if (!(await page.isHidden("#confirmOverlay"))) {
    await page.click("#btnConfirmLeave");
    await page.waitForSelector("#confirmOverlay", { state: "hidden" });
    await page.waitForTimeout(80);
  }
}
const answerBox = () => page.locator("#answerArea").boundingBox();

async function setToggle(hostId, value, on) {
  await page.evaluate(([h, v, o]) => {
    const i = document.querySelector(`#${h} input[value="${v}"]`);
    if (!i || i.checked === o) return;
    i.checked = o;
    i.dispatchEvent(new Event("change", { bubbles: true }));
  }, [hostId, value, on]);
  await page.waitForTimeout(35);
}
let ALL_GROUPS = [], ALL_TYPES = [];
async function loadScopeLists() {
  ALL_GROUPS = await page.$$eval("#scopeGroupChips input", els => els.map(e => e.value));
  ALL_TYPES = await page.$$eval("#scopeTypeChips input", els => els.map(e => e.value));
}
async function setScope(groups, types) {
  for (const g of ALL_GROUPS) await setToggle("scopeGroupChips", g, groups.includes(g));
  for (const ty of ALL_TYPES) await setToggle("scopeTypeChips", ty, types.includes(ty));
}
async function setScopeAll() {
  await setScope(await page.$$eval("#scopeGroupChips input", e => e.map(x => x.value)),
                 await page.$$eval("#scopeTypeChips input", e => e.map(x => x.value)));
}

// ── 1. 首页 ──────────────────────────────────────────────────
section("1. 首页：玩法矩阵配置");
check("作答方式顺序：三选一 / 四选一 / 五选一 / 填空 / 定位",
  (await page.$$eval("#styleChips .tp-chip span", els => els.map(e => e.textContent))).join(",")
    === "三选一,四选一,五选一,填空,定位",
  (await page.$$eval("#styleChips .tp-chip span", els => els.map(e => e.textContent))).join(","));
check("已知 / 要猜 / 作答方式各 5 个选项",
  (await page.locator("#knownChips .tp-chip").count()) === 5 &&
  (await page.locator("#askedChips .tp-chip").count()) === 5 &&
  (await page.locator("#styleChips .tp-chip").count()) === 5);
check("模式 4 个选项", (await page.locator("#modeChips .tp-chip").count()) === 4);
check("模式说明会跟着变", (await page.textContent("#modeDesc")).length > 6);
check("范围：大区 7 个多选项", (await page.locator("#scopeGroupChips .tp-chip").count()) === 7);
check("范围：类型 4 个多选项", (await page.locator("#scopeTypeChips .tp-chip").count()) === 4);
check("范围：3 个预设 + 大区全选/清空", (await page.locator("#scopePresets button").count()) === 5);
await loadScopeLists();
check("默认全选，覆盖 34 个", /34/.test(await page.textContent("#homeRegionCount")), await page.textContent("#homeRegionCount"));
// 多选：只留华北，再取消直辖市 → 3 个（河北/山西/内蒙古）
await setScope(["north"], ALL_TYPES);
check("大区多选：只选华北 = 5 个", /5/.test(await page.textContent("#homeRegionCount")), await page.textContent("#homeRegionCount"));
await setToggle("scopeTypeChips", "municipality", false);
check("大区 × 类型 自由组合：华北去掉直辖市 = 3 个", /3/.test(await page.textContent("#homeRegionCount")), await page.textContent("#homeRegionCount"));
await setScope([], ALL_TYPES);
check("一个大区都不选时提示为空且不能开局",
  !(await page.isEnabled("#btnStart")), await page.textContent("#homeRegionCount"));
await setScopeAll();
check("恢复全选后又能开局", await page.isEnabled("#btnStart"));
await page.screenshot({ path: path.join(shots, "01-home.png") });

// ── 1b. 左上角返回：进行中先确认 ─────────────────────────────
section("1b. 左上角点回首页：本局进行中要先确认");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(300);
check("答题时点左上角品牌区会先弹确认框", await (async () => {
  await page.click("#btnBrand");
  await page.waitForTimeout(120);
  return !(await page.isHidden("#confirmOverlay"));
})());
check("确认框说明还没答过题", /还没答过|haven't answered/.test(await page.textContent("#confirmBody")));
await page.click("#btnConfirmStay");
await page.waitForSelector("#confirmOverlay", { state: "hidden" });
check("选「继续答题」留在本局，且计时恢复", await page.isHidden("#confirmOverlay") && !(await page.isHidden("#screenPlay")));

// 答一题，让确认文案带上已答题数
await page.locator("#answerArea .tp-answer-input").fill("随便写");
await page.keyboard.press("Enter");
await page.waitForTimeout(120);
await page.click("#btnQuit");
await page.waitForSelector("#confirmOverlay:not([hidden])");
check("确认框写明已答题量", /已经答了|answered 1/.test(await page.textContent("#confirmBody")),
  await page.textContent("#confirmBody"));
await page.screenshot({ path: path.join(shots, "01b-confirm.png") });
await page.click("#btnConfirmLeave");
await page.waitForSelector("#confirmOverlay", { state: "hidden" });
check("选「退出本局」回到首页", !(await page.isHidden("#screenHome")) && await page.isHidden("#screenPlay"));
check("首页时长按左上角不会弹确认框", await (async () => {
  await page.click("#btnBrand");
  await page.waitForTimeout(120);
  return await page.isHidden("#confirmOverlay");
})());

// ── 2. 第一题：上方卡片是玩法说明 ────────────────────────────
section("2. 开场：上方卡片是玩法说明");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForSelector("#screenPlay:not([hidden])");
await page.waitForTimeout(400);

const first = await prevInfo();
check("第一题上方卡片标题是「怎么玩」", first.title.includes("怎么玩") && !first.isAnswer, JSON.stringify(first.title));
check("上方卡片里是说明文字而不是答案", (await page.textContent("#prevCard")).length > 40);
check("当前题给出已知信息", (await page.textContent("#knownChip")).includes("已在地图上圈出"));
check("题面就是当前要答的维度", (await page.textContent("#askText")).includes("全称"));
check("作答区就是填空控件", (await page.locator("#answerArea .tp-answer-input").count()) === 1);
const askSizes = await page.evaluate(() => ({
  strong: parseFloat(getComputedStyle(document.querySelector("#askText .tp-ask-strong")).fontSize),
  fixed: parseFloat(getComputedStyle(document.querySelector("#askText .tp-ask-fixed")).fontSize)
}));
const prevH = (await page.locator("#prevCard").boundingBox()).height;
check("要答的那一项是大字、够显眼", askSizes.strong >= 22, askSizes.strong + "px");
check("提问的固定句式是小字", askSizes.fixed <= 14 && askSizes.fixed < askSizes.strong,
  `${askSizes.fixed}px vs ${askSizes.strong}px`);
check("上一题卡片被压矮，不抢戏", prevH <= 264, Math.round(prevH) + "px");
await page.screenshot({ path: path.join(shots, "02-play.png") });

// ── 3. 零阻断：答完立刻换下一题 ──────────────────────────────
section("3. 零阻断：答完题立刻换下一题");
const targetId = await page.evaluate(() => {
  const d = document.querySelector("#mapHost .tp-marks .tp-mark").getAttribute("d");
  return window.TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const expectName = await page.evaluate(id => window.TERRAPOP.countries.cn.regions.find(r => r.id === id).names["zh-Hans"], targetId);
const initials = await page.evaluate(n => window.TERRAPOP.util.initialsOf(n), expectName);
const m0 = await page.evaluate(([ini, dim]) =>
  window.TERRAPOP.game.matchInput(window.TERRAPOP.countries.cn.regions, dim, "zh-Hans", ini), [initials, "full"]);
console.log(`    · ${expectName} 的首字母 ${initials} → ${m0.kind}（${m0.candidates.length} 个候选）`);
const beforeHead = await head();

// 打首字母：无歧义时应当在同一 tick 内自动判定并换题；有歧义时给候选、点一下也能立刻换题
const box = await page.locator("#answerArea .tp-answer-input").boundingBox();
const headAfterTyping = [];
for (const ch of initials) {
  await page.keyboard.type(ch, { delay: 10 });
  const h = await head();          // 不等待、立刻读
  headAfterTyping.push(h);
  if (h !== beforeHead) break;     // 已经判定并换题，别再往新题的输入框里打字
}
if (m0.unique) {
  check("输入无歧义时立即判定并直接换题（同一 tick，无需等待）",
    headAfterTyping.some(h => h !== beforeHead), `${beforeHead} → ${headAfterTyping.join(" → ")}`);
} else {
  check("有歧义时不硬判，而是给候选", headAfterTyping[headAfterTyping.length - 1] === beforeHead &&
    (await page.locator("#suggest .tp-suggest-item").count()) >= 2);
  await page.evaluate(name => {
    const hit = [...document.querySelectorAll("#suggest .tp-suggest-item")]
      .find(b => b.textContent.trim().indexOf(name) === 0 || name.indexOf(b.textContent.trim()) === 0);
    if (hit) hit.click();
  }, expectName);
  check("点候选即提交并立刻换题", (await head()) !== beforeHead);
}
const afterHead = await head();
check("没有出现任何弹窗", await page.isHidden("#settingsOverlay"));
check("作答区已经换成新题的控件，不需要点「下一题」",
  (await page.locator("#answerArea .tp-answer-input").count()) === 1);
void box;

const p1 = await prevInfo();
check("上一题的信息落到了上方卡片", p1.isAnswer && p1.cells === 4, JSON.stringify({ cells: p1.cells, isAnswer: p1.isAnswer }));
check("上方卡片写明判对 / 判错", p1.verds.includes("答对") || p1.verds.includes("答错"), p1.verds);
check("上方卡片含记忆点 / 趣味知识 / 小百科三段", p1.wiki === 3, String(p1.wiki));
check("上方卡片显示正确答案的全称", p1.name.length > 0, p1.name);

// 简称要带声调拼音
const shortCell = await page.evaluate(() => {
  const c = [...document.querySelectorAll("#prevCard .tp-prev-cell")]
    .find(x => x.querySelector("em") && x.querySelector("em").textContent.includes("简称"));
  return c ? c.textContent.trim() : "";
});
check("信息卡片里的简称带上了带声调的拼音",
  /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(shortCell), shortCell);
const shortPinyinLang = await page.evaluate(() => {
  const el = document.querySelector("#prevCard .tp-prev-pinyin");
  return el ? el.getAttribute("lang") : null;
});
check("拼音用 zh-Latn 标了语言", shortPinyinLang === "zh-Latn", String(shortPinyinLang));

// 字体回归：汉字必须是中文字体（不能是日文字形），拼音声调字符不能混字体
const JP_FONTS = ["Hiragino Maru Gothic ProN", "Hiragino Kaku Gothic ProN", "YuGothic", "Yu Gothic",
  "Meiryo", "MS Gothic", "Hiragino Sans", "Osaka", "Noto Sans JP"];
const isJapanese = f => !/GB/.test(f) && JP_FONTS.some(j => f.startsWith(j));

async function probeFonts(text, lang) {
  await page.evaluate(([t, l]) => {
    let d = document.getElementById("tpFontProbe");
    if (!d) {
      d = document.createElement("div");
      d.id = "tpFontProbe";
      d.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999;font-size:24px;white-space:nowrap;font-family:var(--round)";
      document.body.appendChild(d);
    }
    d.setAttribute("lang", l);
    d.textContent = t;
  }, [text, lang]);
  await page.waitForTimeout(60);
  return platformFonts("#tpFontProbe");
}

const hanFonts = await probeFonts("冀蜀陕高原盆地长江", "zh-Hans");
check("汉字只用一种字体渲染", hanFonts.length === 1, hanFonts.join(" + "));
check("汉字没有落到日文字体上", !hanFonts.some(isJapanese), hanFonts.join(" + "));
const toneFonts = await probeFonts("lǒng shǔ shǎn zàng měng ǖǘǚǜ lǎ bǐ", "zh-Latn");
check("拼音声调字符（Latin Extended-B）只用一种字体，一个音节不混字体",
  toneFonts.length === 1, toneFonts.join(" + "));
console.log(`    · 汉字字体：${hanFonts.join(",")}；拼音/拉丁字体：${toneFonts.join(",")}`);
await page.evaluate(() => { const d = document.getElementById("tpFontProbe"); if (d) d.remove(); });
await page.screenshot({ path: path.join(shots, "03-after-answer.png") });

// ── 3b. 填错不自动提交，回车才确定 ──────────────────────────
section("3b. 填空：填错不会自动提交，回车才确定");
await page.waitForTimeout(2200);   // 等上一题的答案画面退场、本题高亮就位
const tgt3 = await page.evaluate(() => {
  const d = document.querySelector("#mapHost .tp-marks .tp-mark").getAttribute("d");
  return TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const wrongUnique = await page.evaluate(tid => {
  const all = TERRAPOP.countries.cn.regions;
  for (const r of all) {
    if (r.id === tid) continue;
    const ini = TERRAPOP.util.initialsOf(r.names["zh-Hans"]);
    if (!ini || ini.length < 2) continue;
    const m = TERRAPOP.game.matchInput(all, "full", "zh-Hans", ini);
    if (m.kind === "exact" && m.candidates.length === 1 && m.candidates[0] === r.id) {
      return { ini: ini, name: r.names["zh-Hans"] };
    }
  }
  return null;
}, tgt3);
check("能构造一个「唯一但答错」的输入", !!wrongUnique, JSON.stringify(wrongUnique));

const headPre = await head();
await page.locator("#answerArea .tp-answer-input").fill(wrongUnique.ini);
await page.waitForTimeout(250);
check("唯一但答的是别的省 → 不自动提交，还停在本题",
  (await head()) === headPre && (await page.isVisible("#answerArea .tp-answer-input")),
  `题号 ${headPre} → ${await head()}`);
check("输入框仍可编辑，方便改", await page.evaluate(() => {
  const i = document.querySelector("#answerArea .tp-answer-input");
  return !!i && !i.disabled && i.value.length > 0;
}));
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
check("按回车才提交，并判为答错", (await head()) !== headPre && /答错|Wrong/.test((await prevInfo()).verds),
  (await prevInfo()).verds);

// ── 3c. 多候选：↑↓ 选择，回车提交 ────────────────────────────
section("3c. 同音多候选：↑↓ 选择，回车提交");
await page.waitForTimeout(2200);
const ambQ = await page.evaluate(() => {
  const all = TERRAPOP.countries.cn.regions;
  for (const q of ["h", "hb", "hn", "j", "ji", "s", "sh", "g", "n", "z", "l", "f", "y", "x", "d", "t"]) {
    const m = TERRAPOP.game.matchInput(all, "full", "zh-Hans", q);
    if (m.kind === "multi" && m.candidates.length >= 2) return { q: q, n: m.candidates.length };
  }
  return null;
});
check("能构造一个多候选输入", !!ambQ, JSON.stringify(ambQ));

const input3c = page.locator("#answerArea .tp-answer-input");
await input3c.fill(ambQ.q);
await page.waitForTimeout(180);
const nSug = await page.locator("#suggest .tp-suggest-item").count();
check("出现多个候选", nSug >= 2, `${nSug} 个`);
check("界面上提示了 ↑↓ 选择、回车确定", /↑↓/.test(await page.textContent("#suggest")),
  await page.textContent("#suggest"));
check("多候选时不会硬判", await page.isVisible("#answerArea .tp-answer-input"));

await input3c.focus();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(60);
check("第一次按 ↓ 高亮第一个候选", await page.evaluate(() => {
  const items = [...document.querySelectorAll("#suggest .tp-suggest-item")];
  return document.querySelector("#suggest .tp-suggest-item-active") === items[0];
}));
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(60);
check("按 ↑ 会回绕到最后一个候选", await page.evaluate(() => {
  const items = [...document.querySelectorAll("#suggest .tp-suggest-item")];
  return document.querySelector("#suggest .tp-suggest-item-active") === items[items.length - 1];
}));

// 走到第 2 个候选，记下它的文本，回车应当提交它（而不是输入框里的字母）
const pickIdx = Math.min(1, nSug - 1);
await page.keyboard.press("ArrowDown");   // 从最后回绕到第一个
await page.waitForTimeout(40);
for (let i = 0; i < pickIdx; i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(30); }
const pickedText = await page.evaluate(() => {
  const a = document.querySelector("#suggest .tp-suggest-item-active");
  return a ? a.textContent.trim() : null;
});
check("方向键能高亮指定候选", !!pickedText, String(pickedText));

const head3c = await head();
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
const p3c = await prevInfo();
const your3c = await page.textContent("#prevCard .tp-prev-your");
check("回车提交的是高亮候选（而不是输入框里的原文）",
  (await head()) !== head3c && your3c.includes(pickedText),
  `${your3c}`);

// ── 4. 位置固定 ──────────────────────────────────────────────
section("4. 位置固定：多题之间作答区坐标完全一致");
const box0 = await answerBox();
const boxes = [box0];
for (let i = 0; i < 5; i++) {
  await page.locator("#answerArea .tp-answer-input").fill("测试" + i);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  boxes.push(await answerBox());
}
const same = boxes.every(b => Math.abs(b.y - box0.y) < 1 && Math.abs(b.x - box0.x) < 1 &&
  Math.abs(b.height - box0.height) < 1 && Math.abs(b.width - box0.width) < 1);
check("连续 6 题的作答区位置与尺寸完全一致", same,
  boxes.map(b => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`).join(" | "));
check("答错时上方卡片也照常更新", (await prevInfo()).isAnswer);

// ── 5. 选择题：问题在上、选项在下 ────────────────────────────
section("5. 选择题：问题在上，选项在下");
await leaveGame();
await page.waitForTimeout(150);
await pickChip("knownChips", "short");
await pickChip("askedChips", "capital");
await pickChip("styleChips", "choice4");
await page.click("#btnStart");
await page.waitForTimeout(300);
check("选出 4 个选项", (await page.locator("#answerArea .tp-choice").count()) === 4);
const askBox = await page.locator("#askText").boundingBox();
const chipBox = await page.locator("#knownChip").boundingBox();
const firstChoice = await page.locator("#answerArea .tp-choice").first().boundingBox();
check("题面在选项上方", askBox.y + askBox.height <= firstChoice.y, `题面底 ${Math.round(askBox.y + askBox.height)} ≤ 选项顶 ${Math.round(firstChoice.y)}`);
check("已知信息在题面上方", chipBox.y + chipBox.height <= askBox.y + 1);
check("选项排成固定两列", (await page.$$eval("#answerArea .tp-choice", els => {
  const ys = els.map(e => Math.round(e.getBoundingClientRect().top));
  return new Set(ys).size <= 2;
})) === true);

// 记录首个选项坐标，看看下一题是否一样
const choiceY = [firstChoice.y];
await page.keyboard.press("1");
await page.waitForTimeout(80);
choiceY.push((await page.locator("#answerArea .tp-choice").first().boundingBox()).y);
const choiceY2 = [choiceY[1]];
for (let i = 0; i < 3; i++) {
  await page.keyboard.press(String((i % 4) + 1));
  await page.waitForTimeout(80);
  choiceY2.push((await page.locator("#answerArea .tp-choice").first().boundingBox()).y);
}
check("数字键 1-5 可以直接选，且首个选项位置固定",
  choiceY2.every(y => Math.abs(y - choiceY2[0]) < 1), choiceY2.map(Math.round).join(","));
await page.screenshot({ path: path.join(shots, "05-choice.png") });

// ── 6. 定位题：点地图 ────────────────────────────────────────
section("6. 定位题：点地图作答");
await leaveGame();
await page.waitForTimeout(150);
await pickChip("knownChips", "full");
await pickChip("askedChips", "location");
await page.waitForTimeout(80);
check("要猜位置时作答方式自动切到定位", (await page.locator("#styleChips .tp-chip-on").textContent()).includes("定位"));
await page.click("#btnStart");
await page.waitForTimeout(300);
check("作答区显示「点地图选答案」", /点地图选答案/.test(await page.textContent("#answerArea")));
const target6 = await page.evaluate(() => {
  const known = document.querySelector("#knownChip").textContent;
  const c = window.TERRAPOP.countries.cn.regions.find(r => known.includes(r.fullNames["zh-Hans"]) || known.includes(r.names["zh-Hans"]));
  return c ? c.id : null;
});
const pt = await page.evaluate(id => {
  const p = document.getElementById("tp-r-" + id);
  const c = window.TERRAPOP.maps.cn.regions.find(r => r.id === id).center;
  const m = p.getScreenCTM();
  const q = new DOMPoint(c[0], c[1]).matrixTransform(m);
  return [q.x, q.y];
}, target6);
await page.mouse.move(pt[0], pt[1]);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(120);
const p6 = await prevInfo();
check("点地图即提交并立刻换题", p6.isAnswer && p6.name.length > 0, p6.name);
check("点对了判为答对", p6.verds.includes("答对"), p6.verds);

// ── 7. 地图：低调配色 + 聚光灯 ───────────────────────────────
section("7. 地图：低调配色与聚光灯");
await leaveGame();
await page.waitForTimeout(150);
await pickChip("knownChips", "location");
await pickChip("askedChips", "capital");
await pickChip("styleChips", "choice4");
await page.click("#btnStart");
await page.waitForTimeout(400);
const mapStats = await page.evaluate(() => ({
  regions: document.querySelectorAll("#mapHost .tp-region-fills [data-id]").length,
  spotOn: !!document.querySelector("#mapHost .tp-spot-on"),
  givenMark: document.querySelectorAll("#mapHost .tp-mark-given").length,
  halo: document.querySelectorAll("#mapHost .tp-mark-halo").length,
  landforms: document.querySelectorAll("#mapHost .tp-landform").length,
  ranges: document.querySelectorAll("#mapHost .tp-range").length,
  rangePeaks: [...document.querySelectorAll("#mapHost .tp-range")]
    .reduce((n, path) => n + ((path.getAttribute("d") || "").match(/M/g) || []).length, 0),
  rivers: document.querySelectorAll("#mapHost .tp-river").length,
  lakes: document.querySelectorAll("#mapHost .tp-lake").length,
  labels: [...document.querySelectorAll("#mapHost .tp-terrain-label")].map(e => e.textContent),
  typeLabels: document.querySelectorAll("#mapHost .tp-tl-type").length,
  terrainEls: document.querySelector("#mapHost .tp-landforms").childElementCount
}));
check("34 个省级区域", mapStats.regions === 34);
check("已知位置时亮起聚光灯", mapStats.spotOn);
check("目标省有高亮描边 + 脉动光环", mapStats.givenMark === 1 && mapStats.halo === 1);
check("已知位置的高亮带闪动效果（tp-flash ×3）", await page.evaluate(() => {
  const p = document.querySelector("#mapHost .tp-marks .tp-mark-given");
  if (!p) return false;
  const cs = getComputedStyle(p);
  return cs.animationName === "tp-flash" && cs.animationIterationCount === "3";
}));
check("地貌仍然完整（面状 / 山脉 / 河流 / 湖泊）",
  mapStats.landforms >= 12 && mapStats.ranges >= 12 && mapStats.rangePeaks >= 40 &&
  mapStats.rivers >= 8 && mapStats.lakes >= 10,
  `${mapStats.landforms} / ${mapStats.ranges} 座山(${mapStats.rangePeaks} 峰) / ${mapStats.rivers} / ${mapStats.lakes}`);
check("地形元素做了合并（每条山脉一个 path，元素总数 ≤ 120）",
  mapStats.terrainEls <= 120, `${mapStats.terrainEls} 个元素（合并前约 340）`);
check("面状地貌只标类型名（高原/盆地/平原/沙漠/丘陵）", mapStats.typeLabels >= 10, String(mapStats.typeLabels));
const badLabels = mapStats.labels.filter(l => /四川|内蒙古|青藏|云贵|青海|滇|黑龙江|雅鲁藏布|秦岭/.test(l));
check("图上没有任何会泄露省份的标注", badLabels.length === 0, badLabels.join(","));
check("会泄露的山河名也没被标出来（黑龙江/雅鲁藏布江/青海湖/滇池/秦岭）",
  !mapStats.labels.some(l => ["黑龙江", "雅鲁藏布江", "青海湖", "滇池", "秦岭"].includes(l)));
await page.screenshot({ path: path.join(shots, "07-map-spotlight.png") });

// ── 7b. 港澳高亮时放大框也一起高亮 ───────────────────────────
section("7b. 港澳高亮时放大框一起高亮");
await leaveGame();
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await setScope(ALL_GROUPS, ["sar"]);            // 只要特别行政区：香港 / 澳门
check("范围缩到港澳后只剩 2 个", /2/.test(await page.textContent("#homeRegionCount")),
  await page.textContent("#homeRegionCount"));
await page.click("#btnStart");
await page.waitForTimeout(400);
check("港澳放大框存在", (await page.locator("#mapHost .tp-magnifier").count()) === 1);
check("放大框里也出现高亮（主图上看不见，必须在小图上标出来）",
  (await page.locator("#mapHost .tp-mag-marks .tp-mark").count()) === 1);
check("放大框高亮用 non-scaling-stroke，描边不会被放大成粗块", await page.evaluate(() => {
  const p = document.querySelector("#mapHost .tp-mag-marks .tp-mark");
  return !!p && p.getAttribute("vector-effect") === "non-scaling-stroke";
}));
await page.screenshot({ path: path.join(shots, "07b-magnifier.png") });

const hkId = await page.evaluate(() => {
  const d = document.querySelector("#mapHost .tp-marks .tp-mark").getAttribute("d");
  return TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const hkFull = await page.evaluate(id => TERRAPOP.countries.cn.regions.find(r => r.id === id).fullNames["zh-Hans"], hkId);
await page.locator("#answerArea .tp-answer-input").fill(hkFull);
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
check("揭示正确答案时放大框显示正确色高亮",
  (await page.locator("#mapHost .tp-mag-marks .tp-mark-correct").count()) === 1);
await setScopeAll();

// ── 8. 缩放 ──────────────────────────────────────────────────
section("8. 地图缩放");
const t0 = await page.getAttribute("#mapHost .tp-viewport", "transform");
await page.click("#btnZoomIn");
await page.waitForTimeout(150);
check("放大按钮改变视图变换", t0 !== (await page.getAttribute("#mapHost .tp-viewport", "transform")));
await page.click("#btnZoomReset");
await page.waitForTimeout(150);
check("复位按钮还原视图", (await page.getAttribute("#mapHost .tp-viewport", "transform")).startsWith("translate(0 0) scale(1)"));

// ── 9. 英文界面 ──────────────────────────────────────────────
section("9. 英文界面");
await leaveGame();
await page.waitForTimeout(150);
await page.selectOption("#langSelect", "en");
await page.waitForTimeout(300);
check("首页说明切到英文", /One question at a time/.test(await page.textContent(".tp-tagline")));
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(350);
check("第一题上方卡片是英文说明", (await prevInfo()).title.includes("How to play"));
check("题面为英文", /What is its/.test(await page.textContent("#askText")));
const enTarget = await page.evaluate(() => {
  const d = document.querySelector("#mapHost .tp-marks .tp-mark").getAttribute("d");
  return window.TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const enName = await page.evaluate(id => window.TERRAPOP.countries.cn.regions.find(r => r.id === id).fullNames["zh-Hans"], enTarget);
await page.locator("#answerArea .tp-answer-input").fill(enName);
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
check("英文界面下答中文名也算对", (await prevInfo()).verds.includes("Correct"), (await prevInfo()).verds);

// 回归：英文界面 · 已知全称猜简称 · 把界面显示的简称原样填进去必须判对
await leaveGame();
await pickChip("knownChips", "full");
await pickChip("askedChips", "short");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(300);
const knownFullEn = (await page.textContent("#knownChip")).trim();
check("英文界面里题干不含括号注音", !/[()（）]/.test(knownFullEn), knownFullEn);
const tid9 = await page.evaluate(t => {
  const r = TERRAPOP.countries.cn.regions.find(x =>
    t.includes(x.fullNames["en"]) || t.includes(x.names["en"]) || t.includes(x.fullNames["zh-Hans"]));
  return r ? r.id : null;
}, knownFullEn);
const shownShort = await page.evaluate(id =>
  TERRAPOP.game.shortText(TERRAPOP.countries.cn.regions.find(r => r.id === id)), tid9);
console.log(`    · ${knownFullEn} 的简称显示为「${shownShort}」`);
const head9 = await head();
await page.locator("#answerArea .tp-answer-input").fill(shownShort);
await page.waitForTimeout(200);
if ((await head()) === head9) { await page.keyboard.press("Enter"); await page.waitForTimeout(200); }
check("把界面显示的简称原样提交能判对（多简称也一样）",
  /Correct/.test((await prevInfo()).verds), (await prevInfo()).verds);
await page.screenshot({ path: path.join(shots, "09-english.png") });

// ── 10. 设置面板 ─────────────────────────────────────────────
section("10. 设置面板");
await leaveGame();
await page.waitForTimeout(150);
await page.click("#btnSettings");
await page.waitForSelector("#settingsOverlay:not([hidden])");
check("设置面板有 6 组", (await page.locator("#settingsBody .tp-set-group").count()) === 6,
  String(await page.locator("#settingsBody .tp-set-group").count()));
check("不再有「自动下一题 / 停留时长」这类会造成等待的设置",
  !/自动进入下一题|Advance automatically|停留时长|dwell/.test(await page.textContent("#settingsBody")));
await page.screenshot({ path: path.join(shots, "10-settings.png") });
await page.click("#btnSettingsClose");
await page.waitForTimeout(200);
check("设置面板可关闭", await page.isHidden("#settingsOverlay"));

// ── 11. 玩法矩阵冒烟：12 组合 × 3 作答方式 ───────────────────
section("11. 玩法矩阵冒烟（12 组合 × 3 作答方式）");
const problems = [];
let combos = 0;
const DIMS = ["full", "short", "capital", "location"];
for (const style of ["text", "choice3", "choice4"]) {
  for (const known of DIMS) {
    for (const asked of DIMS) {
      if (known === asked) continue;
      combos++;
      const tag = `${known}->${asked}/${style}`;
      await pickChip("knownChips", known);
      await pickChip("askedChips", asked);
      if (asked !== "location") await pickChip("styleChips", style);
      await page.click("#btnStart");
      await page.waitForTimeout(140);

      const h0 = await head();
      if (asked === "location") {
        if (!/点地图选答案|Click the map/.test(await page.textContent("#answerArea"))) problems.push(tag + ": 位置行不是点击提示");
        await page.waitForTimeout(1000);   // 等上一题的聚光灯退场后地图才可点
        const anyId = await page.evaluate(() => window.TERRAPOP.maps.cn.regions[0].id);
        const p = await page.evaluate(id => {
          const el = document.getElementById("tp-r-" + id);
          const c = window.TERRAPOP.maps.cn.regions.find(r => r.id === id).center;
          const m = el.getScreenCTM();
          const q = new DOMPoint(c[0], c[1]).matrixTransform(m);
          return [q.x, q.y];
        }, anyId);
        await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.up();
      } else if (style === "text") {
        if ((await page.locator("#answerArea .tp-answer-input").count()) !== 1) problems.push(tag + ": 缺输入框");
        await page.locator("#answerArea .tp-answer-input").fill("测试");
        await page.keyboard.press("Enter");
      } else {
        const n = style === "choice3" ? 3 : 4;
        if ((await page.locator("#answerArea .tp-choice").count()) !== n) problems.push(tag + `: 选项数不是 ${n}`);
        await page.locator("#answerArea .tp-choice").first().click();
      }
      await page.waitForTimeout(120);
      if (h0 === (await head())) problems.push(tag + ": 提交后没有立刻换题");
      if (!(await prevInfo()).isAnswer) problems.push(tag + ": 上一题信息没进上方卡片");
      if ((await prevInfo()).cells !== 4) problems.push(tag + ": 上方卡片缺信息");
      await leaveGame();
      await page.waitForTimeout(60);
    }
  }
}
check(`12 组合 × 3 作答方式 = ${combos} 种配置都能出题、零阻断作答、信息回填`, problems.length === 0,
  problems.slice(0, 6).join(" | "));

// ── 12. 四种模式 ─────────────────────────────────────────────
section("12. 四种模式：邻接 / 极速 / 全答对");
await page.selectOption("#langSelect", "zh-Hans");
await page.waitForTimeout(200);
await setScopeAll();
await pickChip("knownChips", "short");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");

// 建一个「简称 → 省份 id」的索引，方便按题面作答
await page.evaluate(() => {
  window.__shortIdx = {};
  for (const r of TERRAPOP.countries.cn.regions) {
    window.__shortIdx[TERRAPOP.game.shortText(r)] = r.id;
  }
});
async function currentByShort() {
  return page.evaluate(() => {
    const b = document.querySelector("#knownChip b");
    return b ? (window.__shortIdx[b.textContent.trim()] || null) : null;
  });
}

// 12a 邻接漫游
await pickChip("modeChips", "adjacency");
check("模式说明切到邻接漫游", /接壤/.test(await page.textContent("#modeDesc")), await page.textContent("#modeDesc"));
await page.click("#btnStart");
await page.waitForTimeout(300);
const seq = [];
for (let i = 0; i < 9; i++) {
  const sid = await currentByShort();
  if (!sid) break;
  seq.push(sid);
  const full = await page.evaluate(id => TERRAPOP.countries.cn.regions.find(r => r.id === id).fullNames["zh-Hans"], sid);
  await page.locator("#answerArea .tp-answer-input").fill(full);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(90);
}
check("邻接模式能连续出题", seq.length >= 6, `出了 ${seq.length} 题`);
const adjOk = await page.evaluate(list => {
  const adj = TERRAPOP.map.buildAdjacency(TERRAPOP.maps.cn, 1.6, 160);
  let n = 0;
  for (let i = 1; i < list.length; i++) if ((adj[list[i - 1]] || []).includes(list[i])) n++;
  return { n: n, total: list.length - 1 };
}, seq);
check("邻接模式下相邻两题大多是真的接壤", adjOk.n >= Math.floor(adjOk.total * 0.6),
  `${adjOk.n}/${adjOk.total}`);

// 12b 1 分钟极速
await leaveGame();
await pickChip("modeChips", "timed");
check("模式说明切到 1 分钟极速", /60 秒|60 秒内/.test(await page.textContent("#modeDesc")), await page.textContent("#modeDesc"));
await page.click("#btnStart");
await page.waitForTimeout(300);
check("极速模式显示倒计时", (await page.isVisible("#qTimer")) && /\d+s/.test(await page.textContent("#qTimer")),
  await page.textContent("#qTimer"));
const headT = await head();
await page.locator("#answerArea .tp-answer-input").fill("随便写");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
check("极速模式答完继续出题、不会立刻结束",
  (await head()) !== headT && !(await page.isHidden("#screenPlay")));

// 12b2 五选一：桌面端选项不该出滚动条
await leaveGame();
await pickChip("knownChips", "short");
await pickChip("askedChips", "capital");
await pickChip("styleChips", "choice5");
await page.click("#btnStart");
await page.waitForTimeout(300);
check("五选一渲染出 5 个选项", (await page.locator("#answerArea .tp-choice").count()) === 5);
check("桌面端选项区没有滚动条", await page.evaluate(() => {
  const b = document.querySelector("#answerArea .tp-answer-body");
  return b.scrollHeight <= b.clientHeight + 1;
}), await page.evaluate(() => {
  const b = document.querySelector("#answerArea .tp-answer-body");
  return `${b.scrollHeight} / ${b.clientHeight}`;
}));

// 12c 全答对为止（缩到华北的 2 个省）
await leaveGame();
await pickChip("modeChips", "perfect");
await pickChip("knownChips", "short");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await setScope(["north"], ["province"]);
await page.click("#btnStart");
await page.waitForTimeout(300);
check("全答对模式：题号里显示已答对数", /已答对/.test(await head()), await head());
check("范围缩小后总数为 2", /\/ ?2/.test(await head()), await head());
await page.locator("#answerArea .tp-answer-input").fill("一定答错");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
check("答错时卡片提示「稍后会再出现」", /再出现/.test(await page.textContent("#prevCard")));
check("全答对模式：答错不会结束本局", !(await page.isHidden("#screenPlay")));
for (let i = 0; i < 12; i++) {
  if (await page.isHidden("#screenPlay")) break;
  const sid = await currentByShort();
  if (!sid) break;
  const full = await page.evaluate(id => TERRAPOP.countries.cn.regions.find(r => r.id === id).fullNames["zh-Hans"], sid);
  await page.locator("#answerArea .tp-answer-input").fill(full);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);
}
await page.waitForSelector("#screenSummary:not([hidden])", { timeout: 8000 });
const sumMap = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll("#summaryBody .tp-summary-cell").forEach(c => {
    out[c.querySelector("em").textContent.trim()] = c.querySelector("b").textContent.trim();
  });
  return out;
});
check("全答对模式：2 个省全部答对才结算", sumMap["答对"] === "2", JSON.stringify(sumMap));
check("全答对模式：题量多于省份数（错题确实回到了队尾）", Number(sumMap["题量"]) > 2,
  `题量 ${sumMap["题量"]} > 省份数 2`);

// ── 13. 结算 ─────────────────────────────────────────────────
section("13. 结算：含总耗时");
await leaveGame();
await page.waitForTimeout(150);
if (await page.isHidden("#screenHome")) { await page.click("#btnHome"); await page.waitForTimeout(150); }
await setScope(["north"], ALL_TYPES);
await pickChip("modeChips", "random");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(200);
for (let i = 0; i < 12; i++) {
  if (await page.isHidden("#screenPlay")) break;      // 题答完了，结算页已经出现
  const inp = page.locator("#answerArea .tp-answer-input");
  if (!(await inp.isVisible())) break;
  await inp.fill("跳过");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(70);
}
await page.waitForSelector("#screenSummary:not([hidden])", { timeout: 8000 });
const cells = await page.$$eval("#summaryBody .tp-summary-cell", els => els.map(e => e.textContent.trim()));
check("结算有 6 项", cells.length === 6, cells.join(" | "));
check("最后一项是总耗时且带单位", /总耗时|Total time/.test(cells[5]) && /秒|s$|s\b/.test(cells[5]), cells[5]);
await page.screenshot({ path: path.join(shots, "12-summary.png") });

// ── 14. 移动端（紧凑模式：不滚动 / 地图自适应 / 一行摘要）─────
section("14. 移动端紧凑模式");
await page.click("#btnHome");
await page.waitForTimeout(150);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(350);
await setScopeAll();
await pickChip("modeChips", "random");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");

const homeFits = await page.evaluate(() => ({
  scroll: document.querySelector("#screenHome").scrollHeight,
  client: document.querySelector("#screenHome").clientHeight
}));
check("首页在手机上一屏放得下（不需要滚动）", homeFits.scroll <= homeFits.client + 2,
  `${homeFits.scroll} / ${homeFits.client}`);
check("手机上去掉了「怎么玩」大段说明卡",
  await page.evaluate(() => getComputedStyle(document.querySelector(".tp-card-plain")).display === "none"));

await page.click("#btnStart");
await page.waitForTimeout(500);

const noScroll = await page.evaluate(() => ({
  docScroll: document.documentElement.scrollHeight,
  docClient: document.documentElement.clientHeight,
  bodyScroll: document.body.scrollHeight,
  bodyClient: document.body.clientHeight
}));
check("答题时整页不滚动", noScroll.docScroll <= noScroll.docClient + 2 && noScroll.bodyScroll <= noScroll.bodyClient + 2,
  JSON.stringify(noScroll));
check("地图在手机上隐藏图例，把空间让出来",
  await page.evaluate(() => getComputedStyle(document.getElementById("mapLegend")).display === "none"));

const mapBox = await page.locator(".tp-map-pane").boundingBox();
const panelBox = await page.locator(".tp-panel").boundingBox();
check("地图在上、面板在下", panelBox.y >= mapBox.y + mapBox.height - 2,
  `map ${Math.round(mapBox.y)}+${Math.round(mapBox.height)} → panel ${Math.round(panelBox.y)}`);

const strip = await page.evaluate(() => {
  const el = document.getElementById("prevCard");
  return { strip: el.classList.contains("tp-prev-strip"), h: el.getBoundingClientRect().height, text: el.textContent.trim() };
});
check("上一题只留一行摘要（不是大卡片）", strip.strip && strip.h <= 44, `${Math.round(strip.h)}px`);

// 已知位置：地图应当自动局部放大
const zoomed = await page.evaluate(() => {
  const t = document.querySelector("#mapHost .tp-viewport").getAttribute("transform");
  const m = /scale\(([\d.]+)\)/.exec(t);
  return m ? parseFloat(m[1]) : 1;
});
check("手机上已知位置时地图自动局部放大", zoomed > 1.5, `scale ${zoomed}`);

// 模拟输入法弹起：可视高度变矮，答题区必须还在屏幕内
await page.locator("#answerArea .tp-answer-input").focus();
await page.setViewportSize({ width: 390, height: 520 });
await page.waitForTimeout(400);
const kb = await page.evaluate(() => {
  const a = document.getElementById("answerArea").getBoundingClientRect();
  const m = document.querySelector(".tp-map-pane").getBoundingClientRect();
  return { answerBottom: Math.round(a.bottom), vh: window.innerHeight, mapH: Math.round(m.height) };
});
check("模拟输入法弹起后，作答区仍在可视范围内", kb.answerBottom <= kb.vh,
  `作答区底 ${kb.answerBottom} ≤ ${kb.vh}`);
check("模拟输入法弹起后，地图会自动缩小让位", kb.mapH < 200, `地图高 ${kb.mapH}`);
await page.screenshot({ path: path.join(shots, "14-mobile-keyboard.png") });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

// 先答一题，让摘要行有内容
const mAnswer = await page.evaluate(() => {
  const d = document.querySelector("#mapHost .tp-marks .tp-mark").getAttribute("d");
  return TERRAPOP.maps.cn.regions.find(x => x.d === d).id;
});
const mFull = await page.evaluate(id => TERRAPOP.countries.cn.regions.find(r => r.id === id).fullNames["zh-Hans"], mAnswer);
await page.locator("#answerArea .tp-answer-input").fill(mFull);
await page.waitForTimeout(150);
if ((await page.locator("#answerArea .tp-answer-input").count())) await page.keyboard.press("Enter");
await page.waitForTimeout(300);

// 点摘要行 → 底部抽屉里看完整信息与百科
await page.locator("#prevCard").click();
await page.waitForSelector("#infoSheet:not([hidden])");
await page.waitForTimeout(250);
check("点摘要在底部抽屉里展开完整信息", (await page.locator("#infoSheetBody .tp-prev-cell").count()) === 4);
check("抽屉里有记忆点 / 趣味知识 / 小百科", (await page.locator("#infoSheetBody .tp-wiki-section").count()) === 3);
await page.screenshot({ path: path.join(shots, "14-mobile-sheet.png") });
await page.click("#btnInfoSheetClose");
await page.waitForSelector("#infoSheet", { state: "hidden" });
check("抽屉可关闭", await page.isHidden("#infoSheet"));

// 触屏：轻点选省（不该被判成拖动）
await leaveGame();
await pickChip("askedChips", "location");
await pickChip("knownChips", "full");
await page.waitForTimeout(120);
check("手机端做定位题时，首页会提示缩小范围", await page.isVisible("#scopeTip"),
  await page.textContent("#scopeTip"));
check("提示里带「一键只玩某个大区」的按钮",
  (await page.locator("#scopeTip .tp-hint-btn").count()) === 7);
await page.locator("#scopeTip .tp-hint-btn").first().click();
await page.waitForTimeout(250);
check("点一下就把范围收成一个大区", /5/.test(await page.textContent("#homeRegionCount")),
  await page.textContent("#homeRegionCount"));
await setScopeAll();
await page.click("#btnStart");
await page.waitForTimeout(400);
const tapTarget = await page.evaluate(() => {
  const t = document.querySelector("#knownChip").textContent;
  const c = TERRAPOP.countries.cn.regions.find(r => t.includes(r.fullNames["zh-Hans"]) || t.includes(r.names["zh-Hans"]));
  return c ? c.id : null;
});
const tapPt = await page.evaluate(id => {
  const p = document.getElementById("tp-r-" + id);
  const c = TERRAPOP.maps.cn.regions.find(r => r.id === id).center;
  const m = p.getScreenCTM();
  const q = new DOMPoint(c[0], c[1]).matrixTransform(m);
  return [q.x, q.y];
}, tapTarget);
await page.touchscreen.tap(tapPt[0], tapPt[1]);
await page.waitForTimeout(250);
check("轻点一下就能选省（不会被当成拖动）", (await prevInfo()).isAnswer, (await prevInfo()).verds);
check("手机上每个省的可点区域被放大（透明描边 14px + non-scaling-stroke）", await page.evaluate(() => {
  const p = document.querySelector("#mapHost .tp-region-fills .tp-region");
  const cs = getComputedStyle(p);
  return parseFloat(cs.strokeWidth) >= 10 && cs.vectorEffect === "non-scaling-stroke";
}));
check("答题时地图不再自动放大（定位题要能点全国）", await page.evaluate(() => {
  const t = document.querySelector("#mapHost .tp-viewport").getAttribute("transform");
  const m = /scale\(([\d.]+)\)/.exec(t);
  return !m || parseFloat(m[1]) <= 1.01;
}));
await page.screenshot({ path: path.join(shots, "14-mobile-play.png") });

// 手机端五选一：不能出现纵向滚动条
await leaveGame();
await pickChip("knownChips", "short");
await pickChip("askedChips", "capital");
await pickChip("styleChips", "choice5");
await page.click("#btnStart");
await page.waitForTimeout(350);
check("手机端五选一渲染出 5 个选项", (await page.locator("#answerArea .tp-choice").count()) === 5);
const mobCls = await page.evaluate(() => {
  const g = document.querySelector("#answerArea .tp-choices");
  const b = document.querySelector("#answerArea .tp-answer-body");
  return {
    cols: getComputedStyle(g).gridTemplateColumns.split(" ").length,
    overflow: b.scrollHeight - b.clientHeight
  };
});
check("手机端选项是两列而不是单列", mobCls.cols === 2, `${mobCls.cols} 列`);
check("手机端选项区没有滚动条", mobCls.overflow <= 1, `溢出 ${mobCls.overflow}px`);

// ── 首次进入的三步引导 ──
await page.evaluate(() => { try { localStorage.removeItem("terrapop.onboarded.v1"); } catch (e) {} });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(800);
check("小屏首次进入会自动弹出三步引导", !(await page.isHidden("#onboard")));
check("引导第一步讲「每题只问一处」", /每题只问一处/.test(await page.textContent("#onboardBody")),
  await page.textContent("#onboardBody"));
await page.click("#btnOnboardNext");
await page.waitForTimeout(120);
check("第二步讲按住拖动", /按住/.test(await page.textContent("#onboardBody")));
await page.screenshot({ path: path.join(shots, "14-onboard.png") });
await page.click("#btnOnboardNext");
await page.waitForTimeout(120);
check("第三步讲摘要行", /上一题/.test(await page.textContent("#onboardBody")));
await page.click("#btnOnboardNext");
await page.waitForTimeout(320);
check("走完引导后关闭", await page.isHidden("#onboard"));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(700);
check("再次进入不会重复弹引导", await page.isHidden("#onboard"));

// ── 横屏手机：左右分栏 ──
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(420);
await setScopeAll();
await pickChip("modeChips", "random");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(500);
const lr = await page.evaluate(() => {
  const play = document.querySelector(".tp-play");
  const map = document.querySelector(".tp-map-pane").getBoundingClientRect();
  const panel = document.querySelector(".tp-panel").getBoundingClientRect();
  return {
    dir: getComputedStyle(play).flexDirection,
    mapW: Math.round(map.width), mapH: Math.round(map.height),
    sideBySide: Math.abs(map.top - panel.top) < 10
  };
});
check("横屏手机改成左右分栏", lr.dir === "row" && lr.sideBySide, JSON.stringify(lr));
check("横屏下地图是宽大于高的主体", lr.mapW > lr.mapH, `${lr.mapW}x${lr.mapH}`);
check("横屏下也一屏放得下", await page.evaluate(() =>
  document.documentElement.scrollHeight <= document.documentElement.clientHeight + 2));
await page.screenshot({ path: path.join(shots, "14-landscape.png") });

// 横屏下五选一也不能出滚动条
await leaveGame();
await pickChip("knownChips", "short");
await pickChip("askedChips", "capital");
await pickChip("styleChips", "choice5");
await page.click("#btnStart");
await page.waitForTimeout(350);
check("横屏五选一渲染出 5 个选项", (await page.locator("#answerArea .tp-choice").count()) === 5);
check("横屏选项区没有滚动条", await page.evaluate(() => {
  const b = document.querySelector("#answerArea .tp-answer-body");
  return b.scrollHeight <= b.clientHeight + 1;
}), await page.evaluate(() => {
  const b = document.querySelector("#answerArea .tp-answer-body");
  return `${b.scrollHeight} / ${b.clientHeight}`;
}));
check("横屏下一屏仍然放得下", await page.evaluate(() =>
  document.documentElement.scrollHeight <= document.documentElement.clientHeight + 2));

// ── 15. 无报错 ───────────────────────────────────────────────
section("15. 运行期无报错");
check("没有 console error / pageerror / 资源加载失败", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
console.log(`\n截图输出： ${path.relative(root, shots)}/`);
console.log(`${failures === 0 ? "✅ 端到端全部通过" : `❌ ${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
