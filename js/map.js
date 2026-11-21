// TerraPop · 地图渲染与交互（卡通风）
// ---------------------------------------------------------------
// 负责把 maps/cn.js 的省界、data/cn.terrain.js 的山川湖泊地貌画成一张
// 简洁卡通风格的地图，并处理缩放 / 平移 / 命中判定 / 高亮 / 揭示动画。
//
// 画法要点：
//   · 省界拆成三层：填色层（可点击）/ 白色描边层（省与省之间的"缝隙"）/ 深色细线层
//   · 地貌（高原盆地平原沙漠山脉河流湖泊）统一用一个 clipPath 裁在陆地范围内，
//     所以手绘的面状地貌即使画大了一圈也不会溢到海里
//   · 位置命中依靠 SVG 原生命中测试（点击落在哪个 <path> 上）
//   · 「接近」判定用运行时算出的邻接表（见 buildAdjacency）
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;

  // ── 几何工具 ─────────────────────────────────────────────────

  /** 从 SVG path 字符串里抽出所有顶点（只处理 M/L/Z，够用）。 */
  function pathPoints(d, maxPoints) {
    var nums = String(d).match(/-?\d+(?:\.\d+)?/g) || [];
    var pts = [];
    for (var i = 0; i + 1 < nums.length; i += 2) pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
    if (!maxPoints || pts.length <= maxPoints) return pts;
    var step = pts.length / maxPoints;
    var out = [];
    for (var j = 0; j < pts.length; j += step) out.push(pts[Math.floor(j)]);
    return out;
  }

  function bboxOf(points) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p[0] < b[0]) b[0] = p[0];
      if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0];
      if (p[1] > b[3]) b[3] = p[1];
    }
    return b;
  }

  function distance(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 用"采样顶点 + 最近距离"近似求行政区邻接表。
   * 阈值单位是地图坐标；由于省界抽稀，边界会有零点几单位的缝隙。
   */
  function buildAdjacency(mapData, threshold, maxPointsPerRegion) {
    var thr = threshold === undefined ? 1.6 : threshold;
    var cap = maxPointsPerRegion || 160;
    var sets = {};
    mapData.regions.forEach(function (r) { sets[r.id] = pathPoints(r.d, cap); });
    var ids = mapData.regions.map(function (r) { return r.id; });
    var adj = {};
    ids.forEach(function (id) { adj[id] = []; });

    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = sets[ids[i]], b = sets[ids[j]];
        if (!a.length || !b.length) continue;
        var close = false;
        for (var m = 0; m < a.length && !close; m += 2) {
          for (var n = 0; n < b.length; n += 2) {
            var dx = a[m][0] - b[n][0], dy = a[m][1] - b[n][1];
            if (dx * dx + dy * dy < thr * thr) { close = true; break; }
          }
        }
        if (close) { adj[ids[i]].push(ids[j]); adj[ids[j]].push(ids[i]); }
      }
    }
    return adj;
  }

  // ── 地图视图 ─────────────────────────────────────────────────

  function createMapView(host, opts) {
    var options = opts || {};
    var mapData = options.mapData;
    var terrain = options.terrain || null;
    var country = options.country || null;
    var locale = options.locale || "zh-Hans";
    var defaultLocale = (country && country.defaultLocale) || "zh-Hans";
    var onSelect = options.onSelect || function () {};

    var vb = mapData.viewBox;
    var W = vb[2], H = vb[3];
    var proj = mapData.projection;

    var regionById = {};
    mapData.regions.forEach(function (r) { regionById[r.id] = r; });
    var metaById = {};
    ((country && country.regions) || []).forEach(function (m) { metaById[m.id] = m; });

    var state = {
      scale: 1, tx: 0, ty: 0,
      locked: true,
      showCapitals: false,
      showTerrainLabels: true,
      focusId: null
    };

    function project(lonLat) {
      return [
        (lonLat[0] - proj.lon0) * proj.cosLat * proj.k,
        (proj.lat0 - lonLat[1]) * proj.k
      ];
    }

    function locOf(obj) {
      if (!obj) return "";
      return obj[locale] || obj[defaultLocale] || obj[Object.keys(obj)[0]] || "";
    }

    // ── DOM 骨架 ───────────────────────────────────────────────

    U.clear(host);
    var svg = U.svgEl("svg", {
      class: "tp-map-svg",
      viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Territory map"
    });

    var defs = U.svgEl("defs", {});
    svg.appendChild(defs);

    function addFilter(id, builder) {
      var f = U.svgEl("filter", { id: id, x: "-25%", y: "-25%", width: "150%", height: "150%" });
      builder(f);
      defs.appendChild(f);
      return f;
    }

    // 陆地投影：让整块大陆有一点浮起来的厚度
    addFilter("tp-landshadow", function (f) {
      f.appendChild(U.svgEl("feDropShadow", {
        dx: "0", dy: "6", stdDeviation: "7", "flood-color": "#2c5c7a", "flood-opacity": "0.18"
      }));
    });

    // 插图框 / 卡片阴影
    addFilter("tp-cardshadow", function (f) {
      f.appendChild(U.svgEl("feDropShadow", {
        dx: "0", dy: "3", stdDeviation: "4", "flood-color": "#2c5c7a", "flood-opacity": "0.28"
      }));
    });

    // 正确答案的光晕
    addFilter("tp-glow", function (f) {
      f.appendChild(U.svgEl("feGaussianBlur", { stdDeviation: "4", result: "b" }));
      var m = U.svgEl("feMerge", {});
      m.appendChild(U.svgEl("feMergeNode", { in: "b" }));
      m.appendChild(U.svgEl("feMergeNode", { in: "SourceGraphic" }));
      f.appendChild(m);
    });

    function gradient(id, stops, x1, y1, x2, y2) {
      var g = U.svgEl("linearGradient", { id: id, x1: x1 || "0", y1: y1 || "0", x2: x2 || "0", y2: y2 || "1" });
      stops.forEach(function (s) { g.appendChild(U.svgEl("stop", { offset: s[0], "stop-color": s[1] })); });
      defs.appendChild(g);
      return g;
    }

    gradient("tp-sea", [["0", "#cdeafb"], ["0.55", "#b9e0f7"], ["1", "#a6d6f2"]]);
    gradient("tp-land", [["0", "#fdf8ea"], ["1", "#f4ead1"]]);

    // 沙漠：沙点
    var sand = U.svgEl("pattern", { id: "tp-sand", width: "9", height: "9", patternUnits: "userSpaceOnUse" });
    sand.appendChild(U.svgEl("rect", { width: "9", height: "9", fill: "#eccf94" }));
    sand.appendChild(U.svgEl("circle", { cx: "3", cy: "3", r: "1", fill: "#c9a35c" }));
    sand.appendChild(U.svgEl("circle", { cx: "7", cy: "6.5", r: "0.8", fill: "#d3b06a" }));
    defs.appendChild(sand);

    // 高原：等高线
    var hatch = U.svgEl("pattern", { id: "tp-hatch", width: "12", height: "12", patternUnits: "userSpaceOnUse", patternTransform: "rotate(-20)" });
    hatch.appendChild(U.svgEl("rect", { width: "12", height: "12", fill: "#eadfc4" }));
    hatch.appendChild(U.svgEl("path", { d: "M0 9 H12", stroke: "#d8c69d", "stroke-width": "1.6" }));
    defs.appendChild(hatch);

    // 海浪
    var wave = U.svgEl("pattern", { id: "tp-wave", width: "46", height: "34", patternUnits: "userSpaceOnUse" });
    wave.appendChild(U.svgEl("path", {
      d: "M4 22 q7 -7 14 0 t14 0 M30 22 q7 -7 14 0",
      fill: "none", stroke: "#8fc9e8", "stroke-width": "2", "stroke-linecap": "round", opacity: "0.55"
    }));
    defs.appendChild(wave);

    // ── 背景海洋 ───────────────────────────────────────────────
    var bleed = 900;
    svg.appendChild(U.svgEl("rect", {
      x: -bleed, y: -bleed, width: W + bleed * 2, height: H + bleed * 2, fill: "url(#tp-sea)"
    }));
    svg.appendChild(U.svgEl("rect", {
      x: -bleed, y: -bleed, width: W + bleed * 2, height: H + bleed * 2, fill: "url(#tp-wave)"
    }));

    // ── 可缩放平移的图层 ───────────────────────────────────────
    var viewport = U.svgEl("g", { class: "tp-viewport" });
    svg.appendChild(viewport);

    var gLand = U.svgEl("g", { class: "tp-landmass" });          // 整块大陆的投影
    var gLandformClip = U.svgEl("g", { class: "tp-landforms" });
    var gFills = U.svgEl("g", { class: "tp-region-fills" });
    var gCasing = U.svgEl("g", { class: "tp-casing-layer" });
    var gLines = U.svgEl("g", { class: "tp-lines-layer" });
    var gOverlay = U.svgEl("g", { class: "tp-marks" });
    var gCapitals = U.svgEl("g", { class: "tp-capitals" });
    var gLabels = U.svgEl("g", { class: "tp-labels" });
    var gTerrainLabels = U.svgEl("g", { class: "tp-terrain-labels" });

    // 图层顺序：陆地底板 → 省份填色 → 省界 → 地貌 → 地貌标注 → 标记/省会/标签
    // 地貌画在省界之上，才不会被省份填色盖住（野外地图的习惯画法）
    viewport.appendChild(gLand);
    viewport.appendChild(gFills);
    viewport.appendChild(gCasing);
    viewport.appendChild(gLines);
    viewport.appendChild(gLandformClip);
    viewport.appendChild(gTerrainLabels);
    viewport.appendChild(gOverlay);
    viewport.appendChild(gCapitals);
    viewport.appendChild(gLabels);

    // 大陆轮廓（厚白描边 + 投影），用所有省界拼成一张"陆地剪影"
    var allD = mapData.regions.map(function (r) { return r.d; }).join(" ");
    gLand.appendChild(U.svgEl("path", { class: "tp-land-base", d: allD, filter: "url(#tp-landshadow)" }));
    // 同一张轮廓同时用作地貌的裁剪路径，地貌就不会溢到海里
    var clip = U.svgEl("clipPath", { id: "tp-clip-land" });
    clip.appendChild(U.svgEl("path", { d: allD }));
    defs.appendChild(clip);
    gLandformClip.setAttribute("clip-path", "url(#tp-clip-land)");

    // ── 地貌 ───────────────────────────────────────────────────

    function lonLatPath(points, close) {
      var d = points.map(function (p, i) {
        var q = project(p);
        return (i === 0 ? "M" : "L") + q[0].toFixed(1) + " " + q[1].toFixed(1);
      }).join(" ");
      return close ? d + " Z" : d;
    }

    /** 沿折线等距取样，返回 [{p, dir}] */
    function walkPolyline(points, step) {
      var out = [];
      var total = 0, i;
      var seg = [];
      for (i = 0; i < points.length - 1; i++) {
        var len = distance(points[i], points[i + 1]);
        seg.push(len);
        total += len;
      }
      if (total <= 0) return [{ p: points[0], dir: [1, 0] }];
      var n = Math.max(2, Math.round(total / step));
      for (var k = 0; k <= n; k++) {
        var target = (k / n) * total, acc = 0, idx = 0;
        while (idx < seg.length - 1 && acc + seg[idx] < target) { acc += seg[idx]; idx++; }
        var t = seg[idx] ? (target - acc) / seg[idx] : 0;
        var a = points[idx], b = points[idx + 1] || points[idx];
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var l = Math.hypot(dx, dy) || 1;
        out.push({ p: [a[0] + dx * t, a[1] + dy * t], dir: [dx / l, dy / l] });
      }
      return out;
    }

    var LANDFORM_FILL = {
      plateau: "url(#tp-hatch)",
      basin: "#dbe9c8",
      plain: "#e0efc6",
      desert: "url(#tp-sand)",
      hills: "#dbeac6"
    };

    if (terrain) {
      (terrain.landforms || []).forEach(function (lf) {
        var c = project(lf.center);
        var rx = Math.abs(lf.rx) * proj.cosLat * proj.k;
        var ry = Math.abs(lf.ry) * proj.k;
        var kind = lf.kind || "plateau";
        var node = U.svgEl("ellipse", {
          class: "tp-landform tp-landform-" + kind,
          cx: c[0].toFixed(1), cy: c[1].toFixed(1),
          rx: rx.toFixed(1), ry: ry.toFixed(1),
          fill: LANDFORM_FILL[kind] || LANDFORM_FILL.plateau
        });
        if (lf.rot) node.setAttribute("transform", "rotate(" + lf.rot + " " + c[0].toFixed(1) + " " + c[1].toFixed(1) + ")");
        gLandformClip.appendChild(node);
      });

      (terrain.lakes || []).forEach(function (l) {
        gLandformClip.appendChild(U.svgEl("path", { class: "tp-lake-casing", d: lonLatPath(l.points, true) }));
        gLandformClip.appendChild(U.svgEl("path", { class: "tp-lake", d: lonLatPath(l.points, true) }));
      });

      (terrain.rivers || []).forEach(function (r) {
        var d = lonLatPath(r.points, false);
        gLandformClip.appendChild(U.svgEl("path", {
          class: "tp-river-casing", d: d, "stroke-width": (r.width || 4) + 2.6
        }));
        gLandformClip.appendChild(U.svgEl("path", {
          class: "tp-river", d: d, "stroke-width": r.width || 4
        }));
      });

      (terrain.ranges || []).forEach(function (rg) {
        var pts = rg.points.map(project);
        var size = rg.size || 1;
        var stops = walkPolyline(pts, Math.max(5.5, size * 7));
        var g = U.svgEl("g", { class: "tp-range" });
        stops.forEach(function (s, i) {
          var px = -s.dir[1], py = s.dir[0];
          var off = (i % 2 ? 1 : -1) * size * 2.0;
          var x = s.p[0] + px * off, y = s.p[1] + py * off;
          var hw = size * (5.2 + (i % 3) * 0.8);
          var hh = hw * 1.32;
          g.appendChild(U.svgEl("path", {
            d: "M" + (x - hw).toFixed(1) + " " + y.toFixed(1) +
               " L" + x.toFixed(1) + " " + (y - hh).toFixed(1) +
               " L" + (x + hw).toFixed(1) + " " + y.toFixed(1) + " Z"
          }));
        });
        gLandformClip.appendChild(g);
      });
    }

    // ── 省界 ───────────────────────────────────────────────────
    var regionPaths = {};
    mapData.regions.forEach(function (r) {
      var meta = metaById[r.id];
      var group = (meta && meta.group) || "unknown";
      var path = U.svgEl("path", {
        id: "tp-r-" + r.id,
        class: "tp-region tp-g-" + group,
        d: r.d,
        "data-id": r.id,
        tabindex: "0",
        role: "button",
        "aria-label": r.id
      });
      gFills.appendChild(path);
      regionPaths[r.id] = path;
      gCasing.appendChild(U.svgEl("path", { class: "tp-region-casing", d: r.d }));
      gLines.appendChild(U.svgEl("path", { class: "tp-region-line", d: r.d }));
    });

    // ── 地貌文字标注（不裁剪，避免贴边的名字被切掉）────────────

    function terrainLabel(x, y, text, cls) {
      var t = U.svgEl("text", { class: "tp-terrain-label " + (cls || ""), x: x.toFixed(1), y: y.toFixed(1) });
      t.textContent = text;
      gTerrainLabels.appendChild(t);
    }

    function buildTerrainLabels() {
      U.clear(gTerrainLabels);
      if (!terrain || !state.showTerrainLabels) return;
      (terrain.landforms || []).forEach(function (lf) {
        if (lf.label === false) return;
        var c = project(lf.center);
        var name = locOf(lf.names);
        if (!name) return;
        // 椭圆看着够大才写名字，否则太小挤成一团
        var rx = Math.abs(lf.rx) * proj.cosLat * proj.k;
        if (rx < 42) return;
        terrainLabel(c[0], c[1], name, "tp-tl-" + (lf.kind || "plateau"));
      });
      (terrain.ranges || []).forEach(function (rg) {
        if (rg.label === false) return;
        var pts = rg.points.map(project);
        var mid = pts[Math.floor((pts.length - 1) / 2)];
        var name = locOf(rg.names);
        if (name) terrainLabel(mid[0], mid[1] - 11, name, "tp-tl-range");
      });
      (terrain.rivers || []).forEach(function (r) {
        if ((r.width || 0) < 5) return;
        var pts = r.points.map(project);
        var mid = pts[Math.floor((pts.length - 1) / 2)];
        var name = locOf(r.names);
        if (name) terrainLabel(mid[0], mid[1] - 8, name, "tp-tl-water");
      });
      (terrain.lakes || []).forEach(function (l) {
        var pts = l.points.map(project);
        var b = bboxOf(pts);
        if ((b[2] - b[0]) < 14 && (b[3] - b[1]) < 14) return;
        var name = locOf(l.names);
        if (name) terrainLabel((b[0] + b[2]) / 2, b[1] - 5, name, "tp-tl-water");
      });
    }
    buildTerrainLabels();

    // ── 港澳放大框（主图上的港澳太小，点不到）─────────────────
    var magnifier = null;
    function buildMagnifier() {
      var ids = ["CN-HK", "CN-MO"].filter(function (id) { return regionPaths[id]; });
      if (!ids.length) return;
      var pts = [];
      ids.forEach(function (id) { pts = pts.concat(pathPoints(regionById[id].d, 400)); });
      if (!pts.length) return;
      var b = bboxOf(pts);
      var pad = 1.2;
      var w = (b[2] - b[0]) + pad * 2, h = (b[3] - b[1]) + pad * 2;
      var scale = Math.max(90 / w, 64 / h);
      var boxW = w * scale, boxH = h * scale;

      var anchor = mapData.inset && mapData.inset.box
        ? [mapData.inset.box[0], mapData.inset.box[1] - boxH - 30]
        : [W - boxW - 18, H - boxH - 18];
      anchor[0] = Math.max(6, Math.min(anchor[0], W - boxW - 6));
      anchor[1] = Math.max(6, anchor[1]);

      var g = U.svgEl("g", { class: "tp-magnifier", filter: "url(#tp-cardshadow)" });
      g.appendChild(U.svgEl("rect", { class: "tp-inset-frame", x: anchor[0], y: anchor[1], width: boxW, height: boxH, rx: 10 }));

      var inner = U.svgEl("g", {
        transform: "translate(" + anchor[0] + " " + anchor[1] + ") scale(" + scale + ")" +
          " translate(" + (-(b[0] - pad)) + " " + (-(b[1] - pad)) + ")"
      });
      ids.forEach(function (id) {
        inner.appendChild(U.svgEl("use", {
          href: "#tp-r-" + id, "xlink:href": "#tp-r-" + id,
          class: "tp-region-magnified tp-g-" + ((metaById[id] && metaById[id].group) || "unknown"),
          "data-id": id
        }));
      });
      g.appendChild(inner);

      var home = pathPoints(regionById["CN-HK"] ? regionById["CN-HK"].d : regionById[ids[0]].d, 60);
      var hb = bboxOf(home);
      g.appendChild(U.svgEl("line", {
        class: "tp-inset-leader",
        x1: (hb[0] + hb[2]) / 2, y1: (hb[1] + hb[3]) / 2,
        x2: anchor[0], y2: anchor[1] + boxH
      }));
      var title = U.svgEl("text", { class: "tp-inset-title", x: anchor[0] + 8, y: anchor[1] + boxH - 7 });
      g.appendChild(title);
      viewport.appendChild(g);
      magnifier = { group: g, title: title };
      refreshTexts();
    }

    // ── 南海诸岛插图框 ─────────────────────────────────────────
    var scsTitle = null;
    if (mapData.inset && mapData.inset.box && (mapData.inset.shapes || []).length) {
      var box = mapData.inset.box;
      var gi = U.svgEl("g", { class: "tp-inset", filter: "url(#tp-cardshadow)" });
      gi.appendChild(U.svgEl("rect", { class: "tp-inset-frame", x: box[0], y: box[1], width: box[2], height: box[3], rx: 10 }));
      var clipId = "tp-clip-inset";
      var ic = U.svgEl("clipPath", { id: clipId });
      ic.appendChild(U.svgEl("rect", { x: box[0], y: box[1], width: box[2], height: box[3], rx: 10 }));
      defs.appendChild(ic);
      var gshapes = U.svgEl("g", { "clip-path": "url(#" + clipId + ")", "pointer-events": "none" });
      gshapes.appendChild(U.svgEl("rect", {
        x: box[0], y: box[1], width: box[2], height: box[3], fill: "url(#tp-sea)"
      }));
      mapData.inset.shapes.forEach(function (s) {
        gshapes.appendChild(U.svgEl("path", {
          class: s.id === "CS-jd" ? "tp-dash-line" : "tp-region-inset",
          d: s.d
        }));
      });
      gi.appendChild(gshapes);
      scsTitle = U.svgEl("text", { class: "tp-inset-title", x: box[0] + 8, y: box[1] + box[3] - 7 });
      gi.appendChild(scsTitle);
      viewport.appendChild(gi);
    }

    function refreshTexts() {
      if (scsTitle) scsTitle.textContent = T.i18n.t("map.insetSouthChinaSea");
      if (magnifier && magnifier.title) magnifier.title.textContent = T.i18n.t("map.insetHongKongMacao");
    }

    host.appendChild(svg);
    buildMagnifier();

    // ── 交互：缩放 / 平移 ─────────────────────────────────────

    function applyTransform() {
      viewport.setAttribute("transform",
        "translate(" + state.tx + " " + state.ty + ") scale(" + state.scale + ")");
    }

    function clampView() {
      state.scale = U.clamp(state.scale, 1, 7);
      var margin = 140;
      state.tx = U.clamp(state.tx, -(W * (state.scale - 1)) - margin, margin);
      state.ty = U.clamp(state.ty, -(H * (state.scale - 1)) - margin, margin);
    }

    function zoomAt(factor, cx, cy) {
      var ns = U.clamp(state.scale * factor, 1, 7);
      if (ns === state.scale) return;
      var k = ns / state.scale;
      state.tx = cx - k * (cx - state.tx);
      state.ty = cy - k * (cy - state.ty);
      state.scale = ns;
      clampView();
      applyTransform();
    }

    function clientToLocal(clientX, clientY) {
      var rect = svg.getBoundingClientRect();
      var s = Math.min(rect.width / W, rect.height / H) || 1;
      var offX = (rect.width - W * s) / 2;
      var offY = (rect.height - H * s) / 2;
      return [(clientX - rect.left - offX) / s, (clientY - rect.top - offY) / s];
    }

    function regionAt(clientX, clientY) {
      var node = document.elementFromPoint(clientX, clientY);
      while (node && node !== svg) {
        if (node.dataset && node.dataset.id) return node.dataset.id;
        node = node.parentNode;
      }
      return null;
    }

    var pointers = {};
    var pinchStart = null;
    var drag = null;

    svg.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: state.scale };
        drag = null;
      } else {
        drag = { x: e.clientX, y: e.clientY, moved: false };
      }
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
    });

    svg.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);

      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart && pinchStart.dist > 4) {
          var mid = clientToLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
          zoomAt((pinchStart.scale * (dist / pinchStart.dist)) / state.scale, mid[0], mid[1]);
        }
        return;
      }

      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          var rect = svg.getBoundingClientRect();
          var s = Math.min(rect.width / W, rect.height / H) || 1;
          state.tx += dx / s;
          state.ty += dy / s;
          clampView();
          applyTransform();
          drag.x = e.clientX; drag.y = e.clientY;
        }
      }
    });

    function endPointer(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinchStart = null;
      var wasDrag = drag && drag.moved;
      drag = null;
      if (e.type === "pointerup" && !wasDrag && !state.locked) {
        var id = regionAt(e.clientX, e.clientY);
        if (id) onSelect(id, { clientX: e.clientX, clientY: e.clientY });
      }
    }

    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; drag = null; pinchStart = null; });

    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var p = clientToLocal(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.14 : 1 / 1.14, p[0], p[1]);
    }, { passive: false });

    svg.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && state.focusId && !state.locked) {
        e.preventDefault();
        onSelect(state.focusId, {});
      }
    });
    svg.addEventListener("focusin", function (e) {
      if (e.target.dataset && e.target.dataset.id) state.focusId = e.target.dataset.id;
    });

    applyTransform();

    // ── 对外 API ──────────────────────────────────────────────

    return {
      svg: svg,
      viewport: viewport,
      project: project,
      regionPaths: regionPaths,
      regionAt: regionAt,
      distance: distance,

      setLocale: function (l) { locale = l; refreshTexts(); buildTerrainLabels(); },

      setLocked: function (locked) { state.locked = !!locked; },

      setShowCapitals: function (show) {
        state.showCapitals = !!show;
        Array.prototype.forEach.call(gCapitals.childNodes, function (n) {
          n.style.opacity = show ? "1" : "0";
        });
      },

      setTerrainLabels: function (show) {
        state.showTerrainLabels = !!show;
        buildTerrainLabels();
      },

      renderCapitals: function () {
        U.clear(gCapitals);
        var caps = mapData.capitals || {};
        ((country && country.regions) || []).forEach(function (meta) {
          var pt = caps[meta.id];
          if (!pt) return;
          var g = U.svgEl("g", { class: "tp-capital", "data-capital": meta.id });
          g.appendChild(U.svgEl("circle", { cx: pt[0], cy: pt[1], r: 6.2, class: "tp-capital-halo" }));
          g.appendChild(U.svgEl("circle", { cx: pt[0], cy: pt[1], r: 3.4, class: "tp-capital-dot" }));
          g.appendChild(U.svgEl("circle", { cx: pt[0] - 1.1, cy: pt[1] - 1.1, r: 1.1, class: "tp-capital-shine" }));
          g.style.opacity = state.showCapitals ? "1" : "0";
          gCapitals.appendChild(g);
        });
      },

      /** 题面已知位置时高亮某个省 */
      highlight: function (id, kind) {
        U.clear(gOverlay);
        if (!id || !regionPaths[id]) return;
        gOverlay.appendChild(U.svgEl("path", { class: "tp-mark tp-mark-" + (kind || "given"), d: regionById[id].d }));
      },

      /** 揭示：正确省高亮 + 省会脉动 + 省名标签 + 引线 */
      reveal: function (region, status) {
        U.clear(gOverlay);
        U.clear(gLabels);
        if (!region || !regionPaths[region.id]) return;

        gOverlay.appendChild(U.svgEl("path", { class: "tp-mark tp-mark-" + (status || "correct"), d: regionById[region.id].d }));

        var pos = regionById[region.id].label || regionById[region.id].center;
        var cap = (mapData.capitals || {})[region.id];

        if (cap) {
          gLabels.appendChild(U.svgEl("path", {
            class: "tp-leader",
            d: "M" + cap[0] + " " + cap[1] + " L" + (pos[0] + 16) + " " + (pos[1] - 12)
          }));
          gLabels.appendChild(U.svgEl("circle", { class: "tp-capital-pulse", cx: cap[0], cy: cap[1], r: 10 }));
        }

        var g = U.svgEl("g", { class: "tp-region-label" });
        var sub = [locOf(region.fullNames)];
        if (region.short && region.short.length) sub.push(region.short.map(function (s) { return s.char; }).join(" / "));
        if (region.capitalTerm !== "none" && region.capital) sub.push(locOf(region.capital));

        var t1 = U.svgEl("text", { class: "tp-label-main", x: pos[0], y: pos[1] });
        t1.textContent = locOf(region.names);
        var t2 = U.svgEl("text", { class: "tp-label-sub", x: pos[0], y: pos[1] + 16 });
        t2.textContent = sub.join(" · ");
        g.appendChild(t1);
        g.appendChild(t2);
        gLabels.appendChild(g);
      },

      clearMarks: function () { U.clear(gOverlay); U.clear(gLabels); },

      focusRegion: function (id) {
        var r = regionById[id];
        if (!r) return;
        var c = r.label || r.center;
        state.scale = 2.4;
        state.tx = W / 2 - c[0] * state.scale;
        state.ty = H / 2 - c[1] * state.scale;
        clampView();
        applyTransform();
      },

      resetView: function () { state.scale = 1; state.tx = 0; state.ty = 0; applyTransform(); },
      zoomIn: function () { zoomAt(1.25, W / 2, H / 2); },
      zoomOut: function () { zoomAt(1 / 1.25, W / 2, H / 2); }
    };
  }

  T.map = {
    createMapView: createMapView,
    pathPoints: pathPoints,
    bboxOf: bboxOf,
    buildAdjacency: buildAdjacency,
    distance: distance
  };
})(window);
