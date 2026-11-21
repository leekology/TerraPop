#!/usr/bin/env node
// TerraPop · 数据自检
// ---------------------------------------------------------------
// 用法： node scripts/selfcheck.mjs
// 在没有浏览器的环境下加载全部运行时脚本，校验数据完整性、
// 中英文案对齐、地图与行政区数据一一对应、标签点落在本省几何内等。
// ---------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

// 用最小 window 桩加载浏览器脚本（这些脚本本身不依赖 DOM 才会在顶层执行）
globalThis.window = globalThis;

const FILES = [
  "data/han-variants.js",
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
  const code = fs.readFileSync(path.join(root, f), "utf8");
  try {
    new Function(code)();
  } catch (e) {
    console.error(`✗ 加载失败 ${f}: ${e.message}`);
    process.exit(1);
  }
}

const T = globalThis.TERRAPOP;
T.localeOrder = ["zh-Hans", "en"];
T.i18n.setLocale("zh-Hans");

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) { console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); failures++; }
}
function section(t) { console.log(`\n${t}`); }

const country = T.countries.cn;
const map = T.maps.cn;
const wiki = T.wiki.cn;

// ── 行政区 ───────────────────────────────────────────────────
section("行政区数据");
check("34 个省级行政区", country.regions.length === 34, `实际 ${country.regions.length}`);
const ids = country.regions.map(r => r.id);
check("id 唯一", new Set(ids).size === ids.length);
check("必填字段完整", country.regions.every(r =>
  r.id && r.type && r.group && r.names && r.fullNames && r.short?.length && r.capitalTerm));
check("直辖市 / 特别行政区不设省会", country.regions
  .filter(r => r.type === "municipality" || r.type === "sar")
  .every(r => r.capitalTerm === "none" && r.capital === null));
check("自治区首府标记为 seat", country.regions.filter(r => r.type === "autonomous").every(r => r.capitalTerm === "seat"));
const groups = new Set(country.regions.map(r => r.group));
check("大区取值合法", [...groups].every(g => T.groups.includes(g)), [...groups].join(","));
let missingName = 0;
for (const r of country.regions) {
  for (const l of T.i18n.available()) {
    if (!r.names[l] || !r.fullNames[l]) missingName++;
    if (r.capitalTerm !== "none" && (!r.capital || !r.capital[l])) missingName++;
  }
}
check("中英名称 / 省会齐全", missingName === 0, `缺失 ${missingName}`);

// ── 百科 ─────────────────────────────────────────────────────
section("百科与记忆点");
check("34 条百科齐全", ids.every(id => wiki[id]));
check("memo / facts / wiki 三字段齐全", ids.every(id =>
  wiki[id]?.memo && wiki[id]?.facts && wiki[id]?.wiki));
const wikiLangs = new Set();
for (const id of ids) for (const k of ["memo", "facts", "wiki"]) wikiLangs.add(Object.keys(wiki[id][k]).join("+"));
check("百科每个字段都有 zh-Hans 与 en", [...wikiLangs].every(k => k === "zh-Hans+en"), [...wikiLangs].join(" / "));
check("百科无空串", ids.every(id =>
  ["memo", "facts", "wiki"].every(k => ["zh-Hans", "en"].every(l => (wiki[id][k][l] || "").trim().length > 3))));
const extraWikis = Object.keys(wiki).filter(k => !ids.includes(k));
check("百科没有多余 key", extraWikis.length === 0, extraWikis.join(","));

// ── 地图 ─────────────────────────────────────────────────────
section("地图几何");
check("地图 region 数与行政区一致", map.regions.length === 34);
check("地图 id 与行政区 id 一一对应", JSON.stringify([...map.regions.map(r => r.id)].sort()) === JSON.stringify([...ids].sort()));
check("每个省都有省会坐标", ids.every(id => Array.isArray(map.capitals[id])));
check("南海诸岛插图框存在", !!map.inset?.box?.length && map.inset.shapes.length > 0,
  `box=${JSON.stringify(map.inset?.box)} shapes=${map.inset?.shapes.length}`);
const proj = map.projection;
const W = map.viewBox[2], H = map.viewBox[3];
const px = d => d.toFixed(1);

// 标签点是否落在本省几何内（射线法，含所有子路径）
function polygonsFromPath(d) {
  const subpaths = String(d).split(/[Mm]/).filter(Boolean);
  return subpaths.map(sp => {
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
      if ((yi > pt[1]) !== (yj > pt[1]) &&
          pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
let labelOutside = [];
for (const r of map.regions) {
  const polys = polygonsFromPath(r.d);
  const lp = r.label || r.center;
  if (!polys.length || !insidePolygons(lp, polys)) labelOutside.push(r.id);
}
check("34 个省份标签点都落在本省轮廓内", labelOutside.length === 0, labelOutside.join(","));

let outsideBox = 0;
for (const r of map.regions) { for (const p of T.map.pathPoints(r.d, 400)) { if (p[0] < -2 || p[0] > W + 2 || p[1] < -2 || p[1] > H + 2) outsideBox++; } }
check("省界没有跑出 viewBox", outsideBox === 0, `越界点 ${outsideBox}`);

// ── 地形投影 ─────────────────────────────────────────────────
section("地形装饰投影");
const terrain = T.terrain.cn;
const project = ([lon, lat]) => [(lon - proj.lon0) * proj.cosLat * proj.k, (proj.lat0 - lat) * proj.k];
const terrainPts = [
  ...terrain.rivers.flatMap(r => r.points),
  ...terrain.lakes.flatMap(l => l.points),
  ...terrain.mountains.map(m => m.at)
].map(project);
const tOut = terrainPts.filter(p => p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H);
check("江河湖泊山脉都落在地图范围内", tOut.length === 0, `越界 ${tOut.length} 个`);

// ── 邻接表 ───────────────────────────────────────────────────
section("位置判定的邻接表");
const adj = T.map.buildAdjacency(map, 1.6, 160);
// 台湾、海南是岛屿，本来就没有陆上邻省 —— 只能靠质心距离兜底判定
const ISLANDS = ["CN-TW", "CN-HI"];
const isolates = ids.filter(id => !adj[id]?.length).filter(id => !ISLANDS.includes(id));
check("除岛屿外每个省都至少有一个相邻省", isolates.length === 0, isolates.join(","));
const known = { "CN-HE": ["CN-BJ", "CN-TJ", "CN-SX", "CN-SD", "CN-HA", "CN-LN", "CN-NM"] };
for (const [id, expect] of Object.entries(known)) {
  const hit = expect.filter(n => adj[id].includes(n));
  check(`${id} 的邻居识别正确`, hit.length >= Math.min(4, expect.length),
    `命中 ${hit.join(",")} / 实际 ${adj[id].length} 个`);
}
check("港澳与广东相邻", adj["CN-HK"]?.includes("CN-GD") && adj["CN-MO"]?.includes("CN-GD"),
  `HK=${adj["CN-HK"]?.join(",")} MO=${adj["CN-MO"]?.join(",")}`);

// ── 判定规则 ─────────────────────────────────────────────────
section("答案判定");
const hebei = country.regions.find(r => r.id === "CN-HE");
check("河北：『河北』『河北省』『Hebei』都能通过",
  ["河北", "河北省", "Hebei", "hebei province", " 河 北省 "].every(v => T.game.judgeText(hebei, "full", v).status === "correct"));
check("河北：省会『石家庄』『Shijiazhuang』『石市』都能通过",
  ["石家庄", "石家庄市", "Shijiazhuang", "Shíjiāzhuāng", "石市"].every(v => T.game.judgeText(hebei, "capital", v).status === "correct"));
check("河北：『冀』『jì』『Ji』都能通过",
  ["冀", "jì", "ji", "Ji"].every(v => T.game.judgeText(hebei, "short", v).status === "correct"));
const sichuan = country.regions.find(r => r.id === "CN-SC");
check("四川：川与蜀都算对",
  ["川", "蜀", "chuan", "shu"].every(v => T.game.judgeText(sichuan, "short", v).status === "correct"));
const hk = country.regions.find(r => r.id === "CN-HK");
check("香港/澳门：capital 维度被判定为不支持", !T.game.supports(hk, "capital") && !T.game.supports(country.regions.find(r => r.id === "CN-MO"), "capital"));
check("繁体输入可折叠：『廣州市』→ 广州",
  T.game.judgeText(country.regions.find(r => r.id === "CN-GD"), "capital", "廣州市").status === "correct");
check("错误答案会被判错", T.game.judgeText(hebei, "full", "山西省").status === "wrong");
check("未作答算跳过", T.game.judgeText(hebei, "full", "").status === "skipped");
check("位置：点中相邻省在宽松模式下算『接近』",
  T.game.judgeLocation(hebei, { regionId: "CN-SX" }, { lenient: true, adjacency: adj }).status === "close");
check("位置：严格模式下相邻省算错",
  T.game.judgeLocation(hebei, { regionId: "CN-SX" }, { lenient: false, adjacency: adj }).status === "wrong");
check("位置：点中自己算对",
  T.game.judgeLocation(hebei, { regionId: "CN-HE" }, { lenient: true, adjacency: adj }).status === "correct");

// ── 出题 ─────────────────────────────────────────────────────
section("出题引擎");
for (const mode of T.game.MODE_ORDER) {
  const s = T.game.createSession({ country, mode, adjacency: adj, locale: "zh-Hans" });
  check(`模式 ${mode} 能出题`, s.total > 0, `${s.total} 题`);
}
const s2 = T.game.createSession({ country, mode: "location-to-name", adjacency: adj, locale: "zh-Hans" });
let badAsk = 0;
for (let i = 0; i < 200; i++) {
  const q = s2.next();
  if (!q) break;
  if (q.ask.includes("capital") && q.region.capitalTerm === "none") badAsk++;
  if (!q.ask.length) badAsk++;
}
check("出题不会问不存在的维度（直辖市/港澳台不问省会）", badAsk === 0, `异常 ${badAsk}`);
const s3 = T.game.createSession({ country, mode: "capital-to-location", adjacency: adj, locale: "zh-Hans" });
check("『看省会找位置』不会包含直辖市与港澳台", s3.pool.every(r => r.capitalTerm !== "none"));
const s4 = T.game.createSession({ country, mode: "location-to-name", inputMode: "choice", adjacency: adj, locale: "zh-Hans" });
const q4 = s4.next();
check("选择题干扰项为 4 个且互不相同",
  q4.choices.full.length === 4 && new Set(q4.choices.full).size === 4, JSON.stringify(q4.choices.full));

// ── 文案 ─────────────────────────────────────────────────────
section("界面文案");
const zh = T.locales["zh-Hans"], en = T.locales.en;
const strip = o => Object.keys(o).filter(k => !k.startsWith("_")).sort();
const zhKeys = strip(zh), enKeys = strip(en);
const onlyZh = zhKeys.filter(k => !enKeys.includes(k));
const onlyEn = enKeys.filter(k => !zhKeys.includes(k));
check("中英文案 key 完全对齐", onlyZh.length === 0 && onlyEn.length === 0,
  `仅中文 ${onlyZh.join(",")} | 仅英文 ${onlyEn.join(",")}`);
check("文案没有空值", zhKeys.every(k => (zh[k] || "").trim() && (en[k] || "").trim()));

// index.html 里用到的 data-i18n / data-i18n-title，以及 js 里 t("...") 的字面量
const usedKeys = new Set();
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const m of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) usedKeys.add(m[1]);
for (const f of ["js/app.js", "js/game.js", "js/map.js"]) {
  const code = fs.readFileSync(path.join(root, f), "utf8");
  // 只取字面量调用 t("key") / t("key", {...}) / T.i18n.t("key")，
  // 拼出来的 key（"dim." + dim）由下面的显式枚举补齐
  for (const m of code.matchAll(/\bt\(\s*"([a-z][\w.]*)"\s*[,)]/g)) usedKeys.add(m[1]);
  for (const m of code.matchAll(/T\.i18n\.t\(\s*"([a-z][\w.]*)"\s*[,)]/g)) usedKeys.add(m[1]);
}
// 动态拼出来的 key（"dim."+dim 等）改成显式枚举再检查
"full short capital location".split(" ").forEach(d => usedKeys.add("dim." + d));
"full short capital".split(" ").forEach(d => usedKeys.add("input.placeholder." + d));
"Full Short Capital".split(" ").forEach(k => usedKeys.add("question.ask" + k));
T.groups.forEach(g => usedKeys.add("group." + g));
"provincesOnly noMunicipality all".split(" ").forEach(k => usedKeys.add("scope." + k));
"province autonomous municipality sar".split(" ").forEach(k => usedKeys.add("type." + k));
"capital seat none".split(" ").forEach(k => usedKeys.add("term." + k));
for (const m of T.game.MODE_ORDER) { usedKeys.add("mode." + m); usedKeys.add("mode." + m + ".desc"); }

const missingI18n = [...usedKeys].filter(k => !zh[k]);
check("代码里用到的文案 key 都有翻译", missingI18n.length === 0, missingI18n.join(","));

// ── 汇总 ─────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
