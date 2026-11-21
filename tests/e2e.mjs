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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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

// ── 1. 首页 ──────────────────────────────────────────────────
section("1. 首页：玩法矩阵配置");
check("已知 / 要猜 / 作答方式各 5 个选项",
  (await page.locator("#knownChips .tp-chip").count()) === 5 &&
  (await page.locator("#askedChips .tp-chip").count()) === 5 &&
  (await page.locator("#styleChips .tp-chip").count()) === 5);
check("范围 10 个选项", (await page.locator("#scopeChips .tp-chip").count()) === 10);
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
const askSize = await page.$eval("#askText", el => parseFloat(getComputedStyle(el).fontSize));
const prevH = (await page.locator("#prevCard").boundingBox()).height;
check("题面字号够大、够显眼", askSize >= 20, askSize + "px");
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
  ranges: document.querySelectorAll("#mapHost .tp-range path").length,
  rivers: document.querySelectorAll("#mapHost .tp-river").length,
  lakes: document.querySelectorAll("#mapHost .tp-lake").length,
  labels: [...document.querySelectorAll("#mapHost .tp-terrain-label")].map(e => e.textContent),
  typeLabels: document.querySelectorAll("#mapHost .tp-tl-type").length
}));
check("34 个省级区域", mapStats.regions === 34);
check("已知位置时亮起聚光灯", mapStats.spotOn);
check("目标省有高亮描边 + 脉动光环", mapStats.givenMark === 1 && mapStats.halo === 1);
check("地貌仍然完整（面状 / 山脉 / 河流 / 湖泊）",
  mapStats.landforms >= 12 && mapStats.ranges >= 40 && mapStats.rivers >= 8 && mapStats.lakes >= 10,
  `${mapStats.landforms}/${mapStats.ranges}/${mapStats.rivers}/${mapStats.lakes}`);
check("面状地貌只标类型名（高原/盆地/平原/沙漠/丘陵）", mapStats.typeLabels >= 10, String(mapStats.typeLabels));
const badLabels = mapStats.labels.filter(l => /四川|内蒙古|青藏|云贵|青海|滇|黑龙江|雅鲁藏布|秦岭/.test(l));
check("图上没有任何会泄露省份的标注", badLabels.length === 0, badLabels.join(","));
check("会泄露的山河名也没被标出来（黑龙江/雅鲁藏布江/青海湖/滇池/秦岭）",
  !mapStats.labels.some(l => ["黑龙江", "雅鲁藏布江", "青海湖", "滇池", "秦岭"].includes(l)));
await page.screenshot({ path: path.join(shots, "07-map-spotlight.png") });

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

// ── 12. 结算 ─────────────────────────────────────────────────
section("12. 结算：含总耗时");
await leaveGame();
await page.waitForTimeout(150);
if (await page.isHidden("#screenHome")) { await page.click("#btnHome"); await page.waitForTimeout(150); }
await pickChip("scopeChips", "group:north");
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

// ── 13. 移动端 ───────────────────────────────────────────────
section("13. 移动端布局");
await page.click("#btnHome");
await page.waitForTimeout(150);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await pickChip("scopeChips", "all");
await pickChip("knownChips", "location");
await pickChip("askedChips", "full");
await pickChip("styleChips", "text");
await page.click("#btnStart");
await page.waitForTimeout(350);
const mapBox = await page.locator(".tp-map-pane").boundingBox();
const panelBox = await page.locator(".tp-panel").boundingBox();
check("地图与侧栏在窄屏下纵向堆叠", panelBox.y >= mapBox.y + mapBox.height - 2,
  `map ${Math.round(mapBox.y)}+${Math.round(mapBox.height)} → panel ${Math.round(panelBox.y)}`);
check("窄屏下作答区仍然可用", (await answerBox()).height > 100);
await page.screenshot({ path: path.join(shots, "13-mobile.png") });

// ── 14. 无报错 ───────────────────────────────────────────────
section("14. 运行期无报错");
check("没有 console error / pageerror / 资源加载失败", errors.length === 0, errors.slice(0, 4).join(" | "));

await browser.close();
console.log(`\n截图输出： ${path.relative(root, shots)}/`);
console.log(`${failures === 0 ? "✅ 端到端全部通过" : `❌ ${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
