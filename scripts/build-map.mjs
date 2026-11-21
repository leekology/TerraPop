#!/usr/bin/env node
/**
 * build-map.mjs —— 生成 TerraPop 的中国省级地图资源 maps/cn.js
 *
 * 特点：
 *   - 零依赖（只用 Node 内置模块），`node scripts/build-map.mjs` 直接运行。
 *   - 全部离线：输入数据已随仓库放在 scripts/data/ 下，不联网。
 *   - 产物是普通 <script> 可加载的全局赋值脚本（挂到 window.TERRAPOP.maps.cn）。
 *
 * 输入：
 *   scripts/data/cn-province-boundaries.json  DataV.GeoAtlas 100000_full.json（35 个 feature：34 省级 + 九段线）
 *   scripts/data/cn-capitals.json 34 项 省份 id -> [lon, lat]
 *
 * 输出：
 *   maps/cn.js              运行时资源
 *   .tmp/cn-preview.svg     仅供人工肉眼检查的预览（.tmp/ 已 gitignore）
 *
 * 投影公式（与运行时 js/map.js 保持一致）：
 *   x = (lon - lon0) * cosLat * k
 *   y = (lat0 - lat) * k
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- 配置

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_FULL = path.join(ROOT, 'scripts', 'data', 'cn-province-boundaries.json');
const SRC_CAPITALS = path.join(ROOT, 'scripts', 'data', 'cn-capitals.json');
const OUT_JS = path.join(ROOT, 'maps', 'cn.js');
const OUT_SVG = path.join(ROOT, '.tmp', 'cn-preview.svg');

// 主图取景范围（度）
const MAIN = {
  lon0: 73.2,   // 西边界
  lat0: 53.8,   // 北边界
  lon1: 135.4,  // 东边界
  lat1: 17.2,   // 南边界（此线以南进插图框）
  width: 1000,  // 目标宽度（图上单位）
};

// 大环简化容差（度）；小岛用更小的容差，避免被抹平
const TOL_MAIN = 0.02;
const TOL_SMALL = 0.01;
// 判定「小环」的阈值：包围盒最长边小于该值（度）即视为岛屿
const SMALL_RING_SPAN = 0.6;

// 南海诸岛插图：独立的、放大过的投影窗口
const INSET = {
  lonMin: 105,
  lonMax: 125,
  latMin: 2,
  latMax: 25.5,
  k: 8,         // 插图投影比例（图上单位 / 度）
  margin: 8,    // 插图框距主图右下角的内边距
  tol: 0.01,    // 插图内环的简化容差
};

// 省份 id <-> adcode 对照（严格按需求表）
const ADCODE_TO_ID = {
  110000: 'CN-BJ', 120000: 'CN-TJ', 130000: 'CN-HE', 140000: 'CN-SX',
  150000: 'CN-NM', 210000: 'CN-LN', 220000: 'CN-JL', 230000: 'CN-HL',
  310000: 'CN-SH', 320000: 'CN-JS', 330000: 'CN-ZJ', 340000: 'CN-AH',
  350000: 'CN-FJ', 360000: 'CN-JX', 370000: 'CN-SD', 410000: 'CN-HA',
  420000: 'CN-HB', 430000: 'CN-HN', 440000: 'CN-GD', 450000: 'CN-GX',
  460000: 'CN-HI', 500000: 'CN-CQ', 510000: 'CN-SC', 520000: 'CN-GZ',
  530000: 'CN-YN', 540000: 'CN-XZ', 610000: 'CN-SN', 620000: 'CN-GS',
  630000: 'CN-QH', 640000: 'CN-NX', 650000: 'CN-XJ', 710000: 'CN-TW',
  810000: 'CN-HK', 820000: 'CN-MO',
};

const JD_ADCODE = '100000_JD';

// ---------------------------------------------------------------- 基础工具

const round1 = (v) => Math.round(v * 10) / 10;
/** 数字 -> 字符串：最多 1 位小数，且不留 ".0" */
const num1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** 取出 feature 的每个「多边形外环」（本数据集没有洞）。 */
function exteriorRings(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((poly) => poly[0]);
  throw new Error('unexpected geometry type: ' + g.type);
}

/** 去掉连续重复点，并保证首尾闭合。 */
function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  if (out.length < 3) return out;
  const a = out[0];
  const b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}

function bboxOf(ring) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

// ---------------------------------------------------------------- Douglas–Peucker

/** 点到线段 ab 的垂直距离（a===b 时退化为点距）。 */
function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** 对开放折线做 DP（保留首尾），用显式栈避免深递归。 */
function dpPath(points, tol) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e - s < 2) continue;
    let dmax = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(points[i], points[s], points[e]);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * 对闭合环做 DP：先从环上找离起点最远的点把环劈成两段，分别简化再拼回。
 * 保证至少保留能构成三角形的 3 个不同顶点。
 */
function simplifyRing(ring, tol) {
  const src = dedupeRing(ring);
  if (src.length < 3) return [];        // 退化成点/线的环，丢弃
  if (src.length <= 4) return src;      // 三角形/四边形，原样保留

  const pivotIdx = farthestFrom(src, src[0]);
  const half1 = src.slice(0, pivotIdx + 1);
  const half2 = src.slice(pivotIdx);

  const s1 = dpPath(half1, tol);
  const s2 = dpPath(half2, tol);
  let out = s1.concat(s2.slice(1));

  // 至少 3 个不同顶点，否则用原始环上的三个均匀点兜底
  if (out.length - 1 < 3) {
    const n = src.length - 1; // 去掉闭合重复点
    const a = src[0];
    const b = src[Math.floor(n / 3)];
    const c = src[Math.floor((2 * n) / 3)];
    out = [a, b, c, [a[0], a[1]]];
  }
  // 兜底后仍可能因取点重复而退化，再检查一次
  if (out.length - 1 < 3) return src;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

function farthestFrom(arr, origin) {
  let best = 1;
  let bestD = -1;
  for (let i = 1; i < arr.length - 1; i++) {
    const d = Math.hypot(arr[i][0] - origin[0], arr[i][1] - origin[1]);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 投影

// cosLat = cos(35°)
const COSLAT = Math.cos((35 * Math.PI) / 180);

// k 使得主图宽度恰为 MAIN.width
const K = MAIN.width / ((MAIN.lon1 - MAIN.lon0) * COSLAT);
// 主图高度按 k 推算后取整（viewBox 要求整数）
const MAIN_H_EXACT = (MAIN.lat0 - MAIN.lat1) * K;
const MAIN_H = Math.round(MAIN_H_EXACT);

function projectMain(lon, lat) {
  return [(lon - MAIN.lon0) * COSLAT * K, (MAIN.lat0 - lat) * K];
}

// 插图：先算尺寸，再钉到主图右下角
const INSET_SPAN_LON = INSET.lonMax - INSET.lonMin;
const INSET_SPAN_LAT = INSET.latMax - INSET.latMin;
const INSET_W = INSET_SPAN_LON * COSLAT * INSET.k;
const INSET_H = INSET_SPAN_LAT * INSET.k;
const INSET_X0 = MAIN.width - INSET.margin - INSET_W;
const INSET_Y0 = MAIN_H - INSET.margin - INSET_H;
const INSET_BOX = [
  round1(INSET_X0),
  round1(INSET_Y0),
  Math.ceil(INSET_W * 10) / 10,
  Math.ceil(INSET_H * 10) / 10,
];

function projectInset(lon, lat) {
  return [
    INSET_X0 + (lon - INSET.lonMin) * COSLAT * INSET.k,
    INSET_Y0 + (INSET.latMax - lat) * INSET.k,
  ];
}

// ---------------------------------------------------------------- 路径序列化

/** 简化后的经纬度环 -> SVG path（只含 M/L/Z，坐标取 1 位小数，无多余空格）。 */
function ringToPath(ring, project) {
  const pts = ring.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return [num1(x), num1(y)];
  });
  if (pts.length < 3) return '';
  let d = 'M' + pts[0][0] + ' ' + pts[0][1];
  for (let i = 1; i < pts.length; i++) d += 'L' + pts[i][0] + ' ' + pts[i][1];
  return d + 'Z';
}

const countCoords = (d) => {
  const m = d.match(/[ML]/g);
  return m ? m.length : 0;
};

// ---------------------------------------------------------------- 主流程

function main() {
  const full = JSON.parse(fs.readFileSync(SRC_FULL, 'utf8'));
  const capitalsSrc = JSON.parse(fs.readFileSync(SRC_CAPITALS, 'utf8'));

  const stats = {
    rawPoints: 0,
    mainRawPoints: 0,
    mainSimplifiedPoints: 0,
    insetRawPoints: 0,
    insetSimplifiedPoints: 0,
    mainRingsIn: 0,
    mainRingsOut: 0,
    insetRingsIn: 0,
    insetRingsOut: 0,
  };

  const regions = [];
  const insetShapes = [];
  const insetProviderCount = new Map(); // 省份 id -> 已用插图序号

  const byAdcode = new Map();
  for (const f of full.features) {
    byAdcode.set(String(f.properties.adcode), f);
  }

  const missing = [];
  for (const adcode of Object.keys(ADCODE_TO_ID)) {
    if (!byAdcode.has(adcode)) missing.push(adcode);
  }
  if (missing.length) throw new Error('输入数据缺少 adcode: ' + missing.join(', '));

  for (const [adcodeStr, id] of Object.entries(ADCODE_TO_ID)) {
    const feature = byAdcode.get(adcodeStr);
    const adcode = Number(adcodeStr);
    const rings = exteriorRings(feature);

    const mainParts = [];
    let mainPts = 0;

    for (const raw of rings) {
      stats.rawPoints += raw.length;
      const box = bboxOf(raw);
      // 完全落在 17.2 以南的环 -> 移入插图
      if (box.maxLat < MAIN.lat1) {
        stats.insetRawPoints += raw.length;
        stats.insetRingsIn += 1;
        const simplified = simplifyRing(raw, INSET.tol);
        if (simplified.length < 3) continue;
        stats.insetSimplifiedPoints += simplified.length;
        const d = ringToPath(simplified, projectInset);
        if (!d) continue;
        stats.insetRingsOut += 1;
        const n = insetProviderCount.get(id) ?? 0;
        insetProviderCount.set(id, n + 1);
        insetShapes.push({ id: `${id}-i${n}`, d });
        continue;
      }
      const span = Math.max(box.maxLon - box.minLon, box.maxLat - box.minLat);
      const tol = span < SMALL_RING_SPAN ? TOL_SMALL : TOL_MAIN;
      const simplified = simplifyRing(raw, tol);
      stats.mainRingsIn += 1;
      if (simplified.length < 3) continue;
      mainPts += simplified.length;
      const d = ringToPath(simplified, projectMain);
      if (d) {
        stats.mainRingsOut += 1;
        mainParts.push(d);
      }
    }

    stats.mainRawPoints += rings
      .filter((r) => bboxOf(r).maxLat >= MAIN.lat1)
      .reduce((s, r) => s + r.length, 0);
    stats.mainSimplifiedPoints += mainPts;

    if (!mainParts.length) throw new Error(`省份 ${id} 主图几何为空`);
    const d = mainParts.join('');

    // label/center：优先用 properties.center，缺失则取最大环质心
    const c = feature.properties.center;
    const labelSrc = Array.isArray(c) && c.length === 2 ? c : ringCentroid(rings);
    const [lx, ly] = projectMain(labelSrc[0], labelSrc[1]);
    const label = [round1(lx), round1(ly)];

    regions.push({ id, adcode, d, label, center: [label[0], label[1]] });
  }

  // 九段线 -> CS-jd
  const jd = byAdcode.get(JD_ADCODE);
  if (!jd) throw new Error('输入数据缺少九段线 feature (' + JD_ADCODE + ')');
  {
    const parts = [];
    for (const raw of exteriorRings(jd)) {
      stats.insetRawPoints += raw.length;
      stats.insetRingsIn += 1;
      const simplified = simplifyRing(raw, INSET.tol);
      if (simplified.length < 3) continue;
      stats.insetSimplifiedPoints += simplified.length;
      const d = ringToPath(simplified, projectInset);
      if (d) {
        stats.insetRingsOut += 1;
        parts.push(d);
      }
    }
    if (!parts.length) throw new Error('九段线几何为空');
    insetShapes.push({ id: 'CS-jd', d: parts.join('') });
  }

  // capitals
  const capitals = {};
  const capitalMissed = [];
  for (const [id, lonlat] of Object.entries(capitalsSrc)) {
    if (id.startsWith('_')) continue; // 跳过 _comment 之类的元数据键
    if (!Array.isArray(lonlat) || lonlat.length !== 2) {
      capitalMissed.push(id);
      continue;
    }
    const [x, y] = projectMain(lonlat[0], lonlat[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      capitalMissed.push(id);
      continue;
    }
    capitals[id] = [round1(x), round1(y)];
  }

  // ---------------------------------------------------------------- 校验

  const regionIds = regions.map((r) => r.id);
  const uniqueIds = new Set(regionIds);
  const problems = [];

  if (regions.length !== 34) problems.push(`regions 数量为 ${regions.length}，应为 34`);
  if (uniqueIds.size !== 34) problems.push(`region id 有重复（唯一 ${uniqueIds.size}）`);
  const capIds = Object.keys(capitals);
  if (capIds.length !== 34) problems.push(`capitals 数量为 ${capIds.length}，应为 34`);
  if (new Set(capIds).size !== 34) problems.push('capitals 存在重复 key');
  for (const id of Object.keys(ADCODE_TO_ID)) {
    const parsed = ADCODE_TO_ID[id];
    if (!uniqueIds.has(parsed)) problems.push(`缺少 region ${parsed}`);
    if (!capitals[parsed]) problems.push(`缺少 capital ${parsed}`);
  }
  for (const id of capIds) {
    if (!Object.values(ADCODE_TO_ID).includes(id)) problems.push(`capitals 有多余 key ${id}`);
  }
  // 主图里不能残留 17.2 以南的坐标：抽查 d 中的点是图上坐标，无法反推纬度，
  // 因此这里改为直接检查是否有环被错误地放进了主图（收集阶段已保证）。
  const boxX2 = INSET_BOX[0] + INSET_BOX[2];
  const boxY2 = INSET_BOX[1] + INSET_BOX[3];
  for (const s of insetShapes) {
    for (const m of s.d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (x < INSET_BOX[0] - 0.05 || x > boxX2 + 0.05 || y < INSET_BOX[1] - 0.05 || y > boxY2 + 0.05) {
        problems.push(`插图 shape ${s.id} 有点落在 box 外: ${x},${y}`);
        break;
      }
    }
  }
  // 简化不能把任何环弄丢
  if (stats.mainRingsOut !== stats.mainRingsIn) {
    problems.push(`主图环数减少: ${stats.mainRingsIn} -> ${stats.mainRingsOut}`);
  }
  if (stats.insetRingsOut !== stats.insetRingsIn) {
    problems.push(`插图环数减少: ${stats.insetRingsIn} -> ${stats.insetRingsOut}`);
  }
  // 反投影检查：主图 d 里不允许残留纬度 17.2 以南的内容（例如海南省的南海小岛）
  const latOfY = (y) => MAIN.lat0 - y / K;
  for (const r of regions) {
    let minLat = Infinity;
    for (const m of r.d.matchAll(/[ML](-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
      minLat = Math.min(minLat, latOfY(Number(m[2])));
    }
    if (minLat < MAIN.lat1 - 0.05) {
      problems.push(`${r.id} 主图仍残留 17.2°N 以南内容: minLat=${minLat.toFixed(3)}`);
    }
  }
  // d 只允许 M/L/Z 与单个空格分隔，且必须闭合
  const pathRe = /^M-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?:L-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)*Z(?:M-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?:L-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)*Z)*$/;
  const allPaths = [...regions.map((r) => ({ id: r.id, d: r.d })), ...insetShapes];
  for (const { id, d } of allPaths) {
    if (!pathRe.test(d)) problems.push(`path 语法异常: ${id}`);
  }

  // ---------------------------------------------------------------- 序列化输出

  const totalCoordPoints =
    regions.reduce((s, r) => s + countCoords(r.d), 0) +
    insetShapes.reduce((s, x) => s + countCoords(x.d), 0) +
    capIds.length;

  const lines = [];
  lines.push('// 由 scripts/build-map.mjs 生成，请勿手工编辑。');
  lines.push('// 数据来源：DataV.GeoAtlas https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
  lines.push('// 投影：x = (lon - lon0) * cosLat * k ; y = (lat0 - lat) * k');
  lines.push('window.TERRAPOP = window.TERRAPOP || {};');
  lines.push('window.TERRAPOP.maps = window.TERRAPOP.maps || {};');
  lines.push('window.TERRAPOP.maps.cn = {');
  lines.push('  id: "cn",');
  lines.push('  names: { "zh-Hans": "中国", en: "China" },');
  lines.push(`  viewBox: [0, 0, ${MAIN.width}, ${MAIN_H}],`);
  lines.push(
    '  projection: { lon0: ' + MAIN.lon0 + ', lat0: ' + MAIN.lat0 +
      ', k: ' + round6(K) + ', cosLat: ' + round6(COSLAT) + ' },'
  );
  lines.push('  regions: [');
  for (const r of regions) {
    lines.push(
      `    { id: "${r.id}", adcode: ${r.adcode}, d: "${r.d}", label: [${num1(r.label[0])}, ${num1(r.label[1])}], center: [${num1(r.center[0])}, ${num1(r.center[1])}] },`
    );
  }
  lines.push('  ],');
  const capPairs = capIds.map((id) => `"${id}": [${num1(capitals[id][0])}, ${num1(capitals[id][1])}]`);
  lines.push('  capitals: {');
  for (let i = 0; i < capPairs.length; i++) {
    lines.push('    ' + capPairs[i] + (i === capPairs.length - 1 ? '' : ','));
  }
  lines.push('  },');
  lines.push('  inset: {');
  lines.push('    box: [' + INSET_BOX.map(num1).join(', ') + '],');
  lines.push('    shapes: [');
  for (let i = 0; i < insetShapes.length; i++) {
    const s = insetShapes[i];
    lines.push(`      { id: "${s.id}", d: "${s.d}" }` + (i === insetShapes.length - 1 ? '' : ','));
  }
  lines.push('    ]');
  lines.push('  }');
  lines.push('};');
  lines.push('');

  const js = lines.join('\n');
  fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
  fs.writeFileSync(OUT_JS, js, 'utf8');
  const bytes = Buffer.byteLength(js, 'utf8');

  // ---------------------------------------------------------------- 预览 SVG

  const svg = buildPreviewSvg(regions, insetShapes, capitals, MAIN_H);
  fs.mkdirSync(path.dirname(OUT_SVG), { recursive: true });
  fs.writeFileSync(OUT_SVG, svg, 'utf8');

  // ---------------------------------------------------------------- 报告

  console.log('=== TerraPop 中国地图构建报告 ===');
  console.log(`输入: ${path.relative(ROOT, SRC_FULL)}`);
  console.log(`输出: ${path.relative(ROOT, OUT_JS)}`);
  console.log(`viewBox        : [0, 0, ${MAIN.width}, ${MAIN_H}]`);
  console.log(`projection     : lon0=${MAIN.lon0} lat0=${MAIN.lat0} k=${round6(K)} cosLat=${round6(COSLAT)}`);
  console.log(`inset.box      : [${INSET_BOX.map(num1).join(', ')}]  (窗口 lon ${INSET.lonMin}-${INSET.lonMax}, lat ${INSET.latMin}-${INSET.latMax})`);
  console.log(`regions        : ${regions.length}/34`);
  console.log(`capitals       : ${capIds.length}/34`);
  console.log(`region id 唯一  : ${uniqueIds.size === 34 ? '是' : '否'}`);
  console.log(`inset shapes   : ${insetShapes.length}（九段线 ${insetShapes.some((s) => s.id === 'CS-jd') ? '有' : '无'}）`);
  console.log('--- 简化前后（顶点数，含闭合重复点）---');
  console.log(`主图 : ${stats.mainRawPoints} -> ${stats.mainSimplifiedPoints}`);
  console.log(`插图 : ${stats.insetRawPoints} -> ${stats.insetSimplifiedPoints}`);
  console.log(`总计 : ${stats.rawPoints + stats.insetRawPoints} -> ${stats.mainSimplifiedPoints + stats.insetSimplifiedPoints}`);
  console.log('--- 环数（确保小岛没有被简化掉）---');
  console.log(`主图 : ${stats.mainRingsIn} -> ${stats.mainRingsOut}`);
  console.log(`插图 : ${stats.insetRingsIn} -> ${stats.insetRingsOut}`);
  console.log(`输出坐标点数    : ${totalCoordPoints}`);
  console.log(`文件字节数      : ${bytes} (${(bytes / 1024).toFixed(1)} KiB, 上限 1.5 MiB)`);
  console.log(`预览 SVG        : ${path.relative(ROOT, OUT_SVG)}`);

  if (problems.length) {
    console.error('\n校验失败:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('\n校验通过 ✔');
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

/** 最大环的质心（面积加权）。 */
function ringCentroid(rings) {
  let best = null;
  let bestArea = -1;
  for (const r of rings) {
    const box = bboxOf(r);
    const area = (box.maxLon - box.minLon) * (box.maxLat - box.minLat);
    if (area > bestArea) {
      bestArea = area;
      best = r;
    }
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
    a += f;
    cx += (best[j][0] + best[i][0]) * f;
    cy += (best[j][1] + best[i][1]) * f;
  }
  if (a === 0) return best[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function buildPreviewSvg(regions, insetShapes, capitals, mainH) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${mainH}" width="1000" height="${mainH}" ` +
      `font-family="system-ui, -apple-system, 'PingFang SC', sans-serif">`
  );
  parts.push('<rect width="100%" height="100%" fill="#f7fbff"/>');
  parts.push('<g id="regions" fill="#cfe3f5" stroke="#2b4a63" stroke-width="0.6" fill-rule="nonzero">');
  for (const r of regions) {
    parts.push(`  <path id="${esc(r.id)}" d="${r.d}"/>`);
  }
  parts.push('</g>');
  parts.push('<g id="labels" font-size="11" fill="#123" text-anchor="middle">');
  for (const r of regions) {
    parts.push(
      `  <text x="${r.label[0]}" y="${r.label[1]}" dominant-baseline="middle">${esc(r.id)}</text>`
    );
  }
  parts.push('</g>');
  parts.push('<g id="capitals" fill="#c0392b" stroke="#fff" stroke-width="0.6">');
  for (const [id, p] of Object.entries(capitals)) {
    parts.push(`  <circle id="cap-${esc(id)}" cx="${p[0]}" cy="${p[1]}" r="2.2"/>`);
  }
  parts.push('</g>');
  const box = INSET_BOX;
  parts.push(
    `<g id="inset"><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" ` +
      `fill="#ffffff" fill-opacity="0.9" stroke="#2b4a63" stroke-width="0.8"/>`
  );
  for (const s of insetShapes) {
    const isLine = s.id === 'CS-jd';
    parts.push(
      `  <path id="${esc(s.id)}" d="${s.d}" fill="${isLine ? 'none' : '#cfe3f5'}" ` +
        `stroke="${isLine ? '#c0392b' : '#2b4a63'}" stroke-width="${isLine ? 1.2 : 0.6}"/>`
    );
  }
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}

main();
