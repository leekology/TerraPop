#!/usr/bin/env node
// TerraPop · 数据与规则自检
// ---------------------------------------------------------------
// 用法： node scripts/selfcheck.mjs
// 在没有浏览器的环境下加载全部运行时脚本，校验数据完整性、
// 中英文案对齐、地图与行政区数据一一对应、地貌落点、拼音表、
// 智能输入判定、玩法矩阵正交性等。
// ---------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;

const FILES = [
  "data/han-variants.js",
  "data/han-initials.js",
  "js/core.js",
  "locales/zh-Hans.js",
  "locales/en.js",
  "js/i18n.js",
  "js/voice.js",
  "data/cn.js",
  "data/cn.wiki.js",
  "data/cn.terrain.js",
  "maps/cn.js",
  "js/map.js",
  "js/game.js"
];

for (const f of FILES) {
  try {
    new Function(fs.readFileSync(path.join(root, f), "utf8"))();
  } catch (e) {
    console.error(`✗ 加载失败 ${f}: ${e.message}`);
    process.exit(1);
  }
}

const T = globalThis.TERRAPOP;
const U = T.util;
T.localeOrder = ["zh-Hans", "en"];
T.i18n.setLocale("zh-Hans");

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
function section(t) { console.log(`\n${t}`); }

const country = T.countries.cn;
const map = T.maps.cn;
const wiki = T.wiki.cn;
const terrain = T.terrain.cn;
const ids = country.regions.map(r => r.id);
const byId = Object.fromEntries(country.regions.map(r => [r.id, r]));

// ── 行政区 ───────────────────────────────────────────────────
section("行政区数据");
check("34 个省级行政区", country.regions.length === 34, `实际 ${country.regions.length}`);
check("id 唯一", new Set(ids).size === ids.length);
check("必填字段完整", country.regions.every(r =>
  r.id && r.type && r.group && r.names && r.fullNames && r.short?.length && r.capitalTerm));
check("直辖市 / 特别行政区不设省会", country.regions
  .filter(r => r.type === "municipality" || r.type === "sar")
  .every(r => r.capitalTerm === "none" && r.capital === null));
check("自治区首府标记为 seat", country.regions.filter(r => r.type === "autonomous").every(r => r.capitalTerm === "seat"));
let missingName = 0;
for (const r of country.regions) {
  for (const l of T.i18n.available()) {
    if (!r.names[l] || !r.fullNames[l]) missingName++;
    if (r.capitalTerm !== "none" && (!r.capital || !r.capital[l])) missingName++;
  }
}
check("中英名称 / 省会齐全", missingName === 0, `缺失 ${missingName}`);
const noPinyin = country.regions.filter(r => (r.short || []).some(sh => !sh.pinyin || !sh.char)).map(r => r.id);
check("每个简称都有带声调的拼音（信息卡片要用来标注读音）", noPinyin.length === 0, noPinyin.join(","));
const toneless = [];
country.regions.forEach(r => (r.short || []).forEach(sh => { if (sh.pinyin && !/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/.test(sh.pinyin)) toneless.push(r.id + ":" + sh.pinyin); }));
check("简称拼音都标了声调", toneless.length === 0, toneless.slice(0, 5).join(","));

// ── 百科 ─────────────────────────────────────────────────────
section("百科与记忆点");
check("34 条百科齐全", ids.every(id => wiki[id]));
check("memo / facts / wiki 三字段齐全", ids.every(id => wiki[id]?.memo && wiki[id]?.facts && wiki[id]?.wiki));
check("每条都有 zh-Hans 与 en", ids.every(id =>
  ["memo", "facts", "wiki"].every(k => ["zh-Hans", "en"].every(l => (wiki[id][k][l] || "").trim().length > 3))));
check("百科没有多余 key", Object.keys(wiki).every(k => ids.includes(k)));

// ── 拼音表 ───────────────────────────────────────────────────
section("拼音表与拼音推导");
const py = T.hanPinyin || {};
check("拼音表有 148 个字", Object.keys(py).length === 148, String(Object.keys(py).length));
check("每个值都是合法拼音", Object.values(py).every(v => /^[a-z]{1,7}$/.test(v)));
const PY_SPOT = {
  "石家庄": ["shijiazhuang", "sjz"],
  "呼和浩特": ["huhehaote", "hhht"],
  "乌鲁木齐": ["wulumuqi", "wlmq"],
  "哈尔滨": ["haerbin", "heb"],
  "内蒙古": ["neimenggu", "nmg"],
  "广西壮族自治区": ["guangxizhuangzuzizhiqu", "gxzzzzq"],
  "新疆维吾尔自治区": ["xinjiangweiwuerzizhiqu", "xjwwezzq"],
  "拉萨": ["lasa", "ls"]
};
Object.entries(PY_SPOT).forEach(([word, [flat, ini]]) => {
  check(`拼音推导 ${word}`, U.pinyinFlat(word) === flat && U.initialsOf(word) === ini,
    `${U.pinyinFlat(word)} / ${U.initialsOf(word)}`);
});
// 数据里出现的所有汉字都要能查到拼音
const usedHan = new Set();
const collect = s => { for (const ch of String(s || "")) if (/[\u3400-\u9fff]/.test(ch)) usedHan.add(ch); };
country.regions.forEach(r => {
  collect(r.names["zh-Hans"]); collect(r.fullNames["zh-Hans"]);
  (r.aliases["zh-Hans"] || []).forEach(collect);
  if (r.capital) collect(r.capital["zh-Hans"]);
  (r.capitalAliases["zh-Hans"] || []).forEach(collect);
  (r.short || []).forEach(s => collect(s.char));
});
const missingPy = [...usedHan].filter(ch => !py[ch]);
check("数据里用到的汉字都在拼音表里", missingPy.length === 0, missingPy.join(""));

// ── 地图几何 ─────────────────────────────────────────────────
section("地图几何");
check("地图 region 数与行政区一致", map.regions.length === 34);
check("地图 id 与行政区 id 一一对应", JSON.stringify([...map.regions.map(r => r.id)].sort()) === JSON.stringify([...ids].sort()));
check("每个省都有省会坐标", ids.every(id => Array.isArray(map.capitals[id])));
check("南海诸岛插图框存在", !!map.inset?.box?.length && map.inset.shapes.length > 0);
const proj = map.projection;
const W = map.viewBox[2], H = map.viewBox[3];
const project = ([lon, lat]) => [(lon - proj.lon0) * proj.cosLat * proj.k, (proj.lat0 - lat) * proj.k];

function polygonsFromPath(d) {
  return String(d).split(/[Mm]/).filter(Boolean).map(sp => {
    const nums = sp.match(/-?\d+(?:\.\d+)?/g) || [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([+nums[i], +nums[i + 1]]);
    return pts;
  }).filter(p => p.length > 2);
}
function insidePolygons(pt, polys) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
const labelOutside = map.regions.filter(r => !insidePolygons(r.label || r.center, polygonsFromPath(r.d))).map(r => r.id);
check("34 个省份标签点都落在本省轮廓内", labelOutside.length === 0, labelOutside.join(","));

let outsideBox = 0;
for (const r of map.regions) for (const p of T.map.pathPoints(r.d, 400)) {
  if (p[0] < -2 || p[0] > W + 2 || p[1] < -2 || p[1] > H + 2) outsideBox++;
}
check("省界没有跑出 viewBox", outsideBox === 0, `越界点 ${outsideBox}`);

// ── 地貌 ─────────────────────────────────────────────────────
section("地貌数据（大江大河大湖 + 高原盆地平原沙漠山脉）");
check("河流 ≥ 8 条", (terrain.rivers || []).length >= 8, String(terrain.rivers.length));
check("湖泊 ≥ 10 个", (terrain.lakes || []).length >= 10, String(terrain.lakes.length));
check("面状地貌 ≥ 12 个", (terrain.landforms || []).length >= 12, String(terrain.landforms.length));
check("山脉 ≥ 12 条", (terrain.ranges || []).length >= 12, String(terrain.ranges.length));
const kinds = new Set((terrain.landforms || []).map(l => l.kind));
check("地貌类型齐全（高原/盆地/平原/沙漠/丘陵）",
  ["plateau", "basin", "plain", "desert", "hills"].every(k => kinds.has(k)), [...kinds].join(","));
const named = [...(terrain.rivers || []), ...(terrain.lakes || []), ...(terrain.landforms || []), ...(terrain.ranges || [])];
check("地貌都有中英双名", named.every(f => f.names && f.names["zh-Hans"] && f.names.en),
  named.filter(f => !f.names?.["zh-Hans"] || !f.names?.en).map(f => f.id).join(","));

const landPolys = map.regions.map(r => polygonsFromPath(r.d));
function onLand(pt) { return landPolys.some(p => insidePolygons(pt, p)); }
const lfOut = (terrain.landforms || []).filter(l => !onLand(project(l.center))).map(l => l.id);
check("每个面状地貌的中心都在中国陆地内", lfOut.length === 0, lfOut.join(","));
const rgOut = [];
(terrain.ranges || []).forEach(r => r.points.forEach((p, i) => { if (!onLand(project(p))) rgOut.push(`${r.id}[${i}]`); }));
check("每条山脉的每个点都在陆地内", rgOut.length === 0, rgOut.slice(0, 6).join(","));
const rvOut = [];
(terrain.rivers || []).forEach(r => r.points.forEach((p, i) => { if (!onLand(project(p))) rvOut.push(`${r.id}[${i}]`); }));
check("河流顶点基本都在陆地内（允许 ≤3 个入海口/界河点）", rvOut.length <= 3, rvOut.slice(0, 6).join(","));
const lkOut = [];
(terrain.lakes || []).forEach(l => l.points.forEach((p, i) => { if (!onLand(project(p))) lkOut.push(`${l.id}[${i}]`); }));
check("湖泊顶点都在陆地内", lkOut.length === 0, lkOut.slice(0, 6).join(","));

const allTerrain = [
  ...(terrain.rivers || []).flatMap(r => r.points),
  ...(terrain.lakes || []).flatMap(l => l.points),
  ...(terrain.landforms || []).map(l => l.center),
  ...(terrain.ranges || []).flatMap(r => r.points)
];
const tOut = allTerrain.map(project).filter(p => p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H);
check("地貌投影后都在 viewBox 内", tOut.length === 0, `越界 ${tOut.length}`);

// ── 邻接表 ───────────────────────────────────────────────────
section("位置判定的邻接表");
const adj = T.map.buildAdjacency(map, 1.6, 160);
const ISLANDS = ["CN-TW", "CN-HI"];
const isolates = ids.filter(id => !adj[id]?.length).filter(id => !ISLANDS.includes(id));
check("除岛屿外每个省都至少有一个相邻省", isolates.length === 0, isolates.join(","));
check("河北的邻居识别正确", ["CN-BJ", "CN-TJ", "CN-SX", "CN-SD", "CN-HA", "CN-LN", "CN-NM"].filter(n => adj["CN-HE"].includes(n)).length >= 5,
  adj["CN-HE"].join(","));
check("港澳与广东相邻", adj["CN-HK"]?.includes("CN-GD") && adj["CN-MO"]?.includes("CN-GD"));

// ── 智能输入 ─────────────────────────────────────────────────
section("智能输入与判定");
const hebei = byId["CN-HE"];
const pool = country.regions;

function match(q, dim) { return T.game.matchInput(pool, dim, "zh-Hans", q); }
check("石家庄：打 sj 就唯一，自动判对", match("sj", "capital").kind === "unique" && match("sj", "capital").candidates[0] === "CN-HE");
check("石家庄：sj → 唯一；sjz → 精确（别称「盛京」不会来抢 sj）", match("sj", "capital").candidates.join() === "CN-HE");
check("石家庄：sjz 是精确匹配", match("sjz", "capital").kind === "exact" && match("sjz", "capital").candidates[0] === "CN-HE");
check("石家庄：shijiazhuang 也是精确匹配", match("shijiazhuang", "capital").kind === "exact");
check("石家庄：汉字「石家庄」是精确匹配", match("石家庄", "capital").kind === "exact");
check("别称只在完全输入时才算：石头城 → 南京", match("石头城", "capital").candidates.join() === "CN-JS");

// ── 地貌标注不能泄露省份 ─────────────────────────────────────
section("地图标注不泄露省份");
const forbidden = T.map.buildForbiddenWords(country, "zh-Hans");
check("省名 / 全称 / 简称都被列入敏感词", ["四川", "四川省", "Sichuan", "冀"].every(w => forbidden.indexOf(w) !== -1));
const LEAKY = ["四川盆地", "内蒙古高原", "青藏高原", "云贵高原", "青海湖", "滇池", "黑龙江", "雅鲁藏布江", "秦岭"];
check("会泄露省名/简称的地貌名都能被识别出来", LEAKY.every(n => T.map.leaks(n, forbidden)), 
  LEAKY.filter(n => !T.map.leaks(n, forbidden)).join(","));
const GENERIC = ["plateau", "basin", "plain", "desert", "hills"].map(k => T.locales["zh-Hans"]["legend." + k]);
check("面状地貌用的通用类型名本身不含省名", GENERIC.every(g => !T.map.leaks(g, forbidden)), GENERIC.join(","));
const SAFE_NAMES = ["长江", "黄河", "珠江", "松花江", "淮河", "澜沧江", "塔里木河", "鄱阳湖", "洞庭湖", "太湖", "天山", "昆仑山", "大兴安岭", "太行山", "南岭", "武夷山"];
check("不会泄露的山河湖名可以照常标注", SAFE_NAMES.every(n => !T.map.leaks(n, forbidden)),
  SAFE_NAMES.filter(n => T.map.leaks(n, forbidden)).join(","));
check("湖北/河北 的 hb 有歧义，会给出候选", (() => {
  const m = match("hb", "full");
  return m.kind === "multi" && m.candidates.includes("CN-HE") && m.candidates.includes("CN-HB");
})(), JSON.stringify(match("hb", "full").candidates));
check("乱输不会匹配", match("zzzqqq", "short").kind === "none");
check("地名带后缀也能匹配：河北省", match("河北省", "full").kind === "exact");
check("简称 jì/jí 声调不同但去调后同为 ji，会给出候选（冀 / 吉）", (() => {
  const m = match("jì", "short");
  return m.kind === "multi" && m.candidates.includes("CN-HE") && m.candidates.includes("CN-JL");
})(), JSON.stringify(match("jì", "short").candidates));
check("简称直接打汉字「冀」则唯一", match("冀", "short").kind === "exact" && match("冀", "short").candidates[0] === "CN-HE");
check("繁体可折叠：廣東省", match("廣東省", "full").candidates.join() === "CN-GD");
check("英文名可匹配：Hebei", match("hebei", "full").kind === "exact");

check("judgeText：前缀输入算对（石家 → 石家庄）", T.game.judgeText(hebei, "capital", "zh-Hans", "石家").status === "correct");
check("judgeText：单字答省会算对（石）", T.game.judgeText(hebei, "capital", "zh-Hans", "石").status === "correct");
check("judgeText：单个字母前缀也算对，无歧义就直接判对（f → 福建）",
  T.game.judgeText(byId["CN-FJ"], "full", "zh-Hans", "f").status === "correct");
check("智能输入：打一个字母就唯一（f → 福建）",
  match("f", "full").kind === "unique" && match("f", "full").candidates[0] === "CN-FJ");
check("judgeText：不是任何写法前缀的输入算错（h 对石家庄）",
  T.game.judgeText(hebei, "capital", "zh-Hans", "h").status === "wrong");
check("judgeText：四川 川/蜀 都算对", ["川", "蜀", "chuan", "shu"].every(v => T.game.judgeText(byId["CN-SC"], "short", "zh-Hans", v).status === "correct"));
check("judgeText：错误答案判错", T.game.judgeText(hebei, "full", "zh-Hans", "山西省").status === "wrong");
check("judgeText：空输入算跳过", T.game.judgeText(hebei, "full", "zh-Hans", "").status === "skipped");
check("位置：相邻省在宽松模式下算接近", T.game.judgeLocation(hebei, { regionId: "CN-SX" }, { lenient: true, adjacency: adj }).status === "close");
check("位置：严格模式下相邻省算错", T.game.judgeLocation(hebei, { regionId: "CN-SX" }, { lenient: false, adjacency: adj }).status === "wrong");

// ── 玩法矩阵正交完备性 ───────────────────────────────────────
section("玩法矩阵正交完备性");
check("已知 × 作答 共 12 种组合", T.game.MATRIX.length === 12, String(T.game.MATRIX.length));
const badMatrix = [];
for (const { known, asked } of T.game.MATRIX) {
  const s = T.game.createSession({ country, known, asked, style: "text", adjacency: adj, locale: "zh-Hans" });
  if (!s.total) badMatrix.push(`${known}->${asked}`);
}
check("12 种组合都能出题", badMatrix.length === 0, badMatrix.join(","));
const styleBad = [];
for (const style of ["text", "choice3", "choice4", "choice5"]) {
  for (const { known, asked } of T.game.MATRIX) {
    const s = T.game.createSession({ country, known, asked, style, adjacency: adj, locale: "zh-Hans" });
    const q = s.next();
    if (!q) { styleBad.push(`${style}:${known}->${asked}`); continue; }
    if (asked === "location") {
      if (q.style !== "locate") styleBad.push(`${style}:${known}->location 应强制定位`);
    } else if (style.startsWith("choice")) {
      const n = T.game.CHOICE_COUNT[style];
      if (!q.choices || q.choices.length !== n || new Set(q.choices).size !== n) {
        styleBad.push(`${style}:${known}->${asked} 选项异常`);
      }
    } else if (q.style !== "text") styleBad.push(`${style}:${known}->${asked} 应为填空`);
  }
}
check("12 组合 × 4 作答方式 = 48 种配置都能出题且题型正确", styleBad.length === 0, styleBad.slice(0, 6).join(","));

const s1 = T.game.createSession({ country, known: "random", asked: "random", style: "choice4", adjacency: adj, locale: "zh-Hans" });
let randomBad = 0;
for (let i = 0; i < 200; i++) {
  const q = s1.next();
  if (!q) break;
  if (q.known === q.asked) randomBad++;
  if (q.asked === "capital" && q.region.capitalTerm === "none") randomBad++;
}
check("随机模式不会问自己、也不会问不存在的维度", randomBad === 0, `异常 ${randomBad}`);

const s2 = T.game.createSession({ country, known: "location", asked: "capital", style: "choice5", adjacency: adj, locale: "zh-Hans" });
check("看位置猜省会：直辖市与港澳台被排除", s2.pool.every(r => r.capitalTerm !== "none"));
const s3 = T.game.createSession({ country, known: "short", asked: "full", style: "text", adjacency: adj, locale: "zh-Hans" });
const q3 = s3.next();
check("纯文字组合（简称→全称）也包含位置以外的三处信息", q3 && q3.asked === "full" && q3.known === "short");

// 计分：难度越低权重越低
const scoreOf = (style) => {
  const s = T.game.createSession({ country, known: "location", asked: "capital", style, adjacency: adj, locale: "zh-Hans" });
  const q = s.next();
  const r = s.submit(q.style === "locate" ? { kind: "locate", regionId: q.region.id } : { kind: "choice", value: T.game.displayFor(q.region, "capital", "zh-Hans") });
  return r.gained;
};
check("越难的作答方式得分越高：三选一 < 四选一 < 五选一 < 填空",
  scoreOf("choice3") < scoreOf("choice4") && scoreOf("choice4") < scoreOf("choice5") && scoreOf("choice5") < scoreOf("text"),
  `${scoreOf("choice3")} / ${scoreOf("choice4")} / ${scoreOf("choice5")} / ${scoreOf("text")}`);

// ── 出题顺序的四种模式 ───────────────────────────────────────
section("四种模式（随机 / 邻接 / 极速 / 全答对）");
const centers = {};
map.regions.forEach(r => { centers[r.id] = r.center; });
const walk = T.game.adjacencyWalk(country.regions, adj, centers);
check("邻接漫游覆盖每一省且不重复", walk.length === 34 && new Set(walk).size === 34);
const adjSteps = walk.slice(1).filter((id, i) => (adj[walk[i]] || []).includes(id)).length;
check("邻接漫游里大部分步都是真的接壤", adjSteps >= Math.floor((walk.length - 1) * 0.6),
  `相邻 ${adjSteps}/${walk.length - 1}`);
check("邻接漫游对孤立岛屿也能兜住（台湾/海南在路径里）",
  walk.includes("CN-TW") && walk.includes("CN-HI"));

function simPerfect(wrongFirst) {
  const s = T.game.createSession({ country, known: "location", asked: "full", style: "text", adjacency: adj, centers, locale: "zh-Hans", order: "perfect" });
  let n = 0;
  while (n < 500) {
    const q = s.next();
    if (!q) break;
    n++;
    const wrong = n <= wrongFirst;
    s.submit({ kind: "text", value: wrong ? "一定答错" : T.game.displayFor(q.region, "full", "zh-Hans") });
  }
  return { s, n };
}
const pf = simPerfect(3);
check("全答对为止：答错的题会排回队尾，最终全部答对才结束",
  pf.s.finished && pf.s.solvedCount === pf.s.total, `题量 ${pf.n}，已答对 ${pf.s.solvedCount}/${pf.s.total}`);
check("全答对为止：因为错题回队，题量大于省份数", pf.n > pf.s.total, `${pf.n} > ${pf.s.total}`);

const se = T.game.createSession({ country, known: "location", asked: "full", style: "text", adjacency: adj, centers, locale: "zh-Hans", order: "endless" });
let endlessCount = 0;
while (endlessCount < 120) {
  const q = se.next();
  if (!q) break;
  endlessCount++;
  se.submit({ kind: "skip" });
}
check("极速模式的队列不会耗尽（可以一直出题）", endlessCount === 120 && !se.finished, `出了 ${endlessCount} 题`);

const sr = T.game.createSession({ country, known: "location", asked: "full", style: "text", adjacency: adj, centers, locale: "zh-Hans", order: "random" });
check("随机一轮：题量等于范围内省份数且初始进度为 0", sr.total === 34 && sr.progressRatio() === 0);
for (let i = 0; i < 34; i++) { const q = sr.next(); if (q) sr.submit({ kind: "skip" }); }
const tail = sr.next();
check("随机一轮：答完 34 题后就结束", tail === null && sr.finished);

// 范围：大区 × 类型 自由组合
const pickScope = (groups, types) => country.regions.filter(r => groups.includes(r.group) && types.includes(r.type));
check("范围：华北 + 全部类型 = 5 个", pickScope(["north"], ["province", "autonomous", "municipality", "sar"]).length === 5);
check("范围：华北 + 只含省 = 2 个", pickScope(["north"], ["province"]).length === 2);
check("范围：全部大区 + 只含省 = 23 个", pickScope(T.groups, ["province"]).length === 23);
check("范围：全部大区 + 省和自治区 = 28 个", pickScope(T.groups, ["province", "autonomous"]).length === 28);

// ── 文案 ─────────────────────────────────────────────────────
section("界面文案");
const zh = T.locales["zh-Hans"], en = T.locales.en;
const strip = o => Object.keys(o).filter(k => !k.startsWith("_")).sort();
const onlyZh = strip(zh).filter(k => !strip(en).includes(k));
const onlyEn = strip(en).filter(k => !strip(zh).includes(k));
check("中英文案 key 完全对齐", onlyZh.length === 0 && onlyEn.length === 0, `仅中文 ${onlyZh.join(",")} | 仅英文 ${onlyEn.join(",")}`);
check("文案没有空值", strip(zh).every(k => (zh[k] || "").trim() && (en[k] || "").trim()));

const usedKeys = new Set();
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const m of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) usedKeys.add(m[1]);
for (const f of ["js/app.js", "js/game.js", "js/map.js"]) {
  const code = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of code.matchAll(/\bt\(\s*"([a-z][\w.]*)"\s*[,)]/g)) usedKeys.add(m[1]);
  for (const m of code.matchAll(/T\.i18n\.t\(\s*"([a-z][\w.]*)"\s*[,)]/g)) usedKeys.add(m[1]);
}
// 动态拼接的 key 显式枚举
"full short capital location".split(" ").forEach(d => usedKeys.add("dim." + d));
"text choice3 choice4 choice5 locate".split(" ").forEach(s => usedKeys.add("style." + s));
"plateau basin plain desert hills range river lake".split(" ").forEach(k => usedKeys.add("legend." + k));
"capital seat none".split(" ").forEach(k => usedKeys.add("term." + k));
"province autonomous municipality sar".split(" ").forEach(k => usedKeys.add("type." + k));
"north northeast east central south southwest northwest".split(" ").forEach(g => usedKeys.add("group." + g));
"score correct total accuracy bestCombo title time timeFmt secFmt".split(" ").forEach(k => usedKeys.add("summary." + k));
["random", "adjacency", "timed", "perfect"].forEach(m => { usedKeys.add("mode." + m); usedKeys.add("mode." + m + ".desc"); });

const missingI18n = [...usedKeys].filter(k => !zh[k]);
check("代码里用到的文案 key 都有翻译", missingI18n.length === 0, missingI18n.join(","));

// ── 汇总 ─────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
