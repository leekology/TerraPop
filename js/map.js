// TerraPop · 地图渲染与交互
// ---------------------------------------------------------------
// 负责：把 maps/cn.js 的省界与 data/*.terrain.js 的江河湖泊画成一张
// 手绘羊皮纸风格的地图，并处理缩放 / 平移 / 命中判定 / 高亮 / 揭示动画。
//
// 位置命中依靠 SVG 原生命中测试（点击落在哪个 <path> 上），
// 「接近」判定用运行时算出的邻接表（见 buildAdjacency）。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var SVGNS = "http://www.w3.org/2000/svg";
  var XLINK = "http://www.w3.org/1999/xlink";
  var U = T.util;

  // ── 几何工具 ─────────────────────────────────────────────────

  /** 从 SVG path 字符串里抽出所有顶点（只处理 M/L/Z，够用）。 */
  function pathPoints(d, maxPoints) {
    var nums = String(d).match(/-?\d+(?:\.\d+)?/g) || [];
    var pts = [];
    for (var i = 0; i + 1 < nums.length; i += 2) {
      pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
    }
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

  function distance(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
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

    var vb = mapData.viewBox;                 // [0,0,W,H]
    var W = vb[2], H = vb[3];
    var proj = mapData.projection;

    var regionById = {};
    mapData.regions.forEach(function (r) { regionById[r.id] = r; });

    var state = {
      scale: 1, tx: 0, ty: 0,
      locked: true,          // 未开始作答时不允许点击
      showCapitals: false,
      hoverId: null
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

    // ── 建立 DOM ───────────────────────────────────────────────

    U.clear(host);
    var svg = U.svgEl("svg", {
      class: "tp-map-svg",
      viewBox: "0 0 " + W + " " + H,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Territory map"
    });

    var defs = U.svgEl("defs", { id: "tp-defs" });
    svg.appendChild(defs);

    // 羊皮纸颗粒质感：分形噪声 + 棕色调
    defs.appendChild(U.svgEl("filter", { id: "tp-paper", x: "0", y: "0", width: "100%", height: "100%" }));
    var paperFilter = defs.lastChild;
    paperFilter.appendChild(U.svgEl("feTurbulence", {
      type: "fractalNoise", baseFrequency: "0.9", numOctaves: "4", seed: "7", result: "n"
    }));
    paperFilter.appendChild(U.svgEl("feColorMatrix", {
      in: "n", type: "matrix",
      values: "0 0 0 0 0.86  0 0 0 0 0.79  0 0 0 0 0.63  0 0 0 0.28 0",
      result: "grain"
    }));
    paperFilter.appendChild(U.svgEl("feComposite", { in: "grain", in2: "SourceGraphic", operator: "over" }));

    // 手绘抖动：轻微位移让线条有毛笔/钢笔的手感
    defs.appendChild(U.svgEl("filter", {
      id: "tp-wobble", x: "-4%", y: "-4%", width: "108%", height: "108%"
    }));
    var wob = defs.lastChild;
    wob.appendChild(U.svgEl("feTurbulence", { type: "turbulence", baseFrequency: "0.045", numOctaves: "2", seed: "3", result: "t" }));
    wob.appendChild(U.svgEl("feDisplacementMap", {
      in: "SourceGraphic", in2: "t", scale: "1.6", xChannelSelector: "R", yChannelSelector: "G"
    }));

    // 墨迹阴影（用于插图框与卡图什）
    defs.appendChild(U.svgEl("filter", { id: "tp-shadow", x: "-20%", y: "-20%", width: "140%", height: "140%" }));
    var sh = defs.lastChild;
    sh.appendChild(U.svgEl("feDropShadow", {
      dx: "1.5", dy: "1.5", stdDeviation: "1.6", "flood-color": "#3b2c19", "flood-opacity": "0.35"
    }));

    // 正确答案的金色光晕
    defs.appendChild(U.svgEl("filter", { id: "tp-glow", x: "-15%", y: "-15%", width: "130%", height: "130%" }));
    var gl = defs.lastChild;
    gl.appendChild(U.svgEl("feGaussianBlur", { stdDeviation: "3.4", result: "b" }));
    gl.appendChild(U.svgEl("feMerge", {}));
    var merge = gl.lastChild;
    merge.appendChild(U.svgEl("feMergeNode", { in: "b" }));
    merge.appendChild(U.svgEl("feMergeNode", { in: "SourceGraphic" }));

    // 海洋：淡青色羊皮纸水痕
    var ocean = U.svgEl("linearGradient", { id: "tp-ocean", x1: "0", y1: "0", x2: "0.6", y2: "1" });
    ocean.appendChild(U.svgEl("stop", { offset: "0", "stop-color": "#cbd9d6" }));
    ocean.appendChild(U.svgEl("stop", { offset: "1", "stop-color": "#b9ccc9" }));
    defs.appendChild(ocean);

    // ── 底色 ──────────────────────────────────────────────────
    // 底纹故意画得比 viewBox 大，这样在 xMidYMid meet 留白处也不会露出接缝
    var bleed = 420;
    svg.appendChild(U.svgEl("rect", {
      x: -bleed, y: -bleed, width: W + bleed * 2, height: H + bleed * 2, fill: "url(#tp-ocean)"
    }));
    var paper = U.svgEl("rect", {
      x: -bleed, y: -bleed, width: W + bleed * 2, height: H + bleed * 2,
      fill: "#e8dcbe", filter: "url(#tp-paper)", opacity: "0.95"
    });
    svg.appendChild(paper);

    // ── 可缩放平移的图层 ───────────────────────────────────────
    var viewport = U.svgEl("g", { class: "tp-viewport" });
    svg.appendChild(viewport);

    var gTerrain = U.svgEl("g", { class: "tp-terrain" });
    var gRegions = U.svgEl("g", { class: "tp-regions", filter: "url(#tp-wobble)" });
    var gOverlay = U.svgEl("g", { class: "tp-marks" });
    var gLabels = U.svgEl("g", { class: "tp-labels" });
    var gCapitals = U.svgEl("g", { class: "tp-capitals" });
    viewport.appendChild(gTerrain);
    viewport.appendChild(gRegions);
    viewport.appendChild(gOverlay);
    viewport.appendChild(gCapitals);
    viewport.appendChild(gLabels);

    // ── 地形 ─────────────────────────────────────────────────
    function polyToPath(points, close) {
      var d = points.map(function (p, i) {
        var q = project(p);
        return (i === 0 ? "M" : "L") + q[0].toFixed(1) + " " + q[1].toFixed(1);
      }).join(" ");
      return close ? d + " Z" : d;
    }

    if (terrain) {
      (terrain.rivers || []).forEach(function (r) {
        gTerrain.appendChild(U.svgEl("path", {
          class: "tp-river",
          d: polyToPath(r.points, false),
          "stroke-width": r.width || 2.4
        }));
      });
      (terrain.lakes || []).forEach(function (l) {
        gTerrain.appendChild(U.svgEl("path", { class: "tp-lake", d: polyToPath(l.points, true) }));
      });
      (terrain.mountains || []).forEach(function (m) {
        var c = project(m.at);
        var g = U.svgEl("g", { class: "tp-mountain-cluster" });
        var n = m.count || 3;
        for (var i = 0; i < n; i++) {
          var off = (i - (n - 1) / 2) * (m.size * 7.2);
          var x = c[0] + off;
          var y = c[1] + ((i % 2) ? m.size * 3.2 : 0);
          var s = m.size * (6 + (i % 3));
          g.appendChild(U.svgEl("path", {
            class: "tp-mountain",
            d: "M" + (x - s) + " " + y + " L" + x + " " + (y - s * 1.35) + " L" + (x + s) + " " + y + " Z"
          }));
        }
        gTerrain.appendChild(g);
      });
    }

    // ── 省界 ─────────────────────────────────────────────────
    var regionPaths = {};
    mapData.regions.forEach(function (r) {
      var meta = (country && country.regions || []).filter(function (x) { return x.id === r.id; })[0];
      var colors = U.groupColor(meta ? meta.group : "unknown");
      var path = U.svgEl("path", {
        id: "tp-r-" + r.id,
        class: "tp-region",
        d: r.d,
        "data-id": r.id,
        tabindex: "0",
        role: "button",
        "aria-label": r.id
      });
      path.style.setProperty("--tp-fill", colors.fill);
      path.style.setProperty("--tp-ink", colors.ink);
      gRegions.appendChild(path);
      regionPaths[r.id] = path;

      // 双层描边，做出"墨线重描"的手感
      gRegions.appendChild(U.svgEl("path", {
        class: "tp-region-ink",
        d: r.d,
        fill: "none",
        "pointer-events": "none"
      }));
    });

    // ── 港澳放大镜（主图上的港澳太小，点不到）─────────────────
    var magnifier = null;
    function buildMagnifier() {
      var ids = ["CN-HK", "CN-MO"].filter(function (id) { return regionPaths[id]; });
      if (!ids.length) return;
      var pts = [];
      ids.forEach(function (id) { pts = pts.concat(pathPoints(regionById[id].d, 400)); });
      if (!pts.length) return;
      var b = bboxOf(pts);
      var pad = 0.6;
      var w = (b[2] - b[0]) + pad * 2, h = (b[3] - b[1]) + pad * 2;
      var boxW = Math.max(120, w * 9), boxH = Math.max(86, h * 9);
      var scale = Math.min(boxW / w, boxH / h);
      boxW = w * scale; boxH = h * scale;

      var anchor = mapData.inset && mapData.inset.box
        ? [mapData.inset.box[0], mapData.inset.box[1] - boxH - 34]
        : [W - boxW - 18, H - boxH - 18];
      anchor[0] = Math.max(6, Math.min(anchor[0], W - boxW - 6));
      anchor[1] = Math.max(6, anchor[1]);

      var g = U.svgEl("g", { class: "tp-magnifier", filter: "url(#tp-shadow)" });
      g.appendChild(U.svgEl("rect", {
        class: "tp-inset-frame", x: anchor[0], y: anchor[1], width: boxW, height: boxH, rx: 4
      }));

      var inner = U.svgEl("g", {
        transform: "translate(" + anchor[0] + " " + anchor[1] + ") scale(" + scale + ") translate(" + (-(b[0] - pad)) + " " + (-(b[1] - pad)) + ")"
      });
      ids.forEach(function (id) {
        inner.appendChild(U.svgEl("use", {
          href: "#tp-r-" + id, "xlink:href": "#tp-r-" + id,
          class: "tp-region-magnified", "data-id": id
        }));
      });
      g.appendChild(inner);

      // 引线：从主图真实位置指向放大框
      var from = pathPoints(regionById["CN-HK"] ? regionById["CN-HK"].d : regionById[ids[0]].d, 60);
      var centre = bboxOf(from);
      var cx = (centre[0] + centre[2]) / 2, cy = (centre[1] + centre[3]) / 2;
      g.appendChild(U.svgEl("line", {
        class: "tp-inset-leader",
        x1: cx, y1: cy, x2: anchor[0], y2: anchor[1] + boxH
      }));
      g.appendChild(U.svgEl("text", {
        class: "tp-inset-title", x: anchor[0] + 6, y: anchor[1] + boxH - 6, text: ""
      })).dataset.role = "magnifier-title";
      viewport.appendChild(g);
      magnifier = { group: g, title: g.querySelector('[data-role="magnifier-title"]') };
      refreshTexts();
    }

    // ── 南海诸岛插图框 ────────────────────────────────────────
    var scsTitle = null;
    if (mapData.inset && mapData.inset.box && (mapData.inset.shapes || []).length) {
      var box = mapData.inset.box;
      var gi = U.svgEl("g", { class: "tp-inset", filter: "url(#tp-shadow)" });
      gi.appendChild(U.svgEl("rect", { class: "tp-inset-frame", x: box[0], y: box[1], width: box[2], height: box[3], rx: 4 }));
      var clipId = "tp-clip-inset";
      var clip = U.svgEl("clipPath", { id: clipId });
      clip.appendChild(U.svgEl("rect", { x: box[0], y: box[1], width: box[2], height: box[3], rx: 4 }));
      defs.appendChild(clip);
      var gshapes = U.svgEl("g", { "clip-path": "url(#" + clipId + ")", "pointer-events": "none" });
      mapData.inset.shapes.forEach(function (s) {
        gshapes.appendChild(U.svgEl("path", {
          class: s.id === "CS-jd" ? "tp-dash-line" : "tp-region tp-region-inset",
          d: s.d, "data-id": s.id
        }));
      });
      gi.appendChild(gshapes);
      scsTitle = U.svgEl("text", { class: "tp-inset-title", x: box[0] + 6, y: box[1] + box[3] - 6 });
      gi.appendChild(scsTitle);
      viewport.appendChild(gi);
    }

    callbackDispatch();
    function callbackDispatch() { /* placeholder for future hooks */ }

    function refreshTexts() {
      if (scsTitle) scsTitle.textContent = T.i18n.t("map.insetSouthChinaSea");
      if (magnifier && magnifier.title) magnifier.title.textContent = T.i18n.t("map.insetHongKongMacao");
    }

    // 装饰：罗盘（放在东侧海面上，不压住陆地）
    (function compass() {
      var g = U.svgEl("g", { class: "tp-compass", transform: "translate(" + (W - 78) + " " + 336 + ")" });
      g.appendChild(U.svgEl("circle", { r: 44, class: "tp-compass-ring" }));
      g.appendChild(U.svgEl("circle", { r: 34, class: "tp-compass-ring tp-compass-ring-inner" }));
      ["N", "E", "S", "W"].forEach(function (d, i) {
        var a = (i * 90 - 90) * Math.PI / 180;
        g.appendChild(U.svgEl("text", {
          class: "tp-compass-label",
          x: Math.sin(a) * 41, y: -Math.cos(a) * 41 + 4, text: d,
          "text-anchor": "middle"
        }));
      });
      var star = U.svgEl("path", {
        class: "tp-compass-star",
        d: "M0 -30 L7 0 L0 30 L-7 0 Z M-30 0 L0 -7 L30 0 L0 7 Z"
      });
      g.appendChild(star);
      svg.appendChild(U.svgEl("g", { class: "tp-decor" })).appendChild(g);
    })();

    // 装饰：边框与海怪波浪
    (function frame() {
      var g = U.svgEl("g", { class: "tp-frame", "pointer-events": "none" });
      g.appendChild(U.svgEl("rect", { x: 6, y: 6, width: W - 12, height: H - 12, class: "tp-frame-line" }));
      g.appendChild(U.svgEl("rect", { x: 12, y: 12, width: W - 24, height: H - 24, class: "tp-frame-line tp-frame-line-thin" }));
      svg.appendChild(g);
    })();

    host.appendChild(svg);
    buildMagnifier();

    // ── 交互：缩放 / 平移 ─────────────────────────────────────

    function applyTransform() {
      viewport.setAttribute("transform",
        "translate(" + state.tx + " " + state.ty + ") scale(" + state.scale + ")");
    }

    function clampView() {
      var maxScale = 7;
      state.scale = U.clamp(state.scale, 1, maxScale);
      var margin = 120;
      var minTx = -(W * (state.scale - 1)) - margin;
      var minTy = -(H * (state.scale - 1)) - margin;
      state.tx = U.clamp(state.tx, minTx, margin);
      state.ty = U.clamp(state.ty, minTy, margin);
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
      // viewBox 以 xMidYMid meet 适配
      var sx = rect.width / W, sy = rect.height / H;
      var s = Math.min(sx, sy);
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
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 2) {
        var ids = Object.keys(pointers);
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
          var target = pinchStart.scale * (dist / pinchStart.dist);
          zoomAt(target / state.scale, mid[0], mid[1]);
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
      if (e.key === "Enter" || e.key === " ") {
        var id = state.focusId;
        if (id && !state.locked) { e.preventDefault(); onSelect(id, {}); }
      }
    });
    svg.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.id) { state.focusId = t.dataset.id; }
    });

    applyTransform();

    // ── 对外 API ──────────────────────────────────────────────

    var api = {
      svg: svg,
      viewport: viewport,
      project: project,
      regionPaths: regionPaths,
      regionAt: regionAt,
      distance: distance,

      setLocale: function (l) { locale = l; refreshTexts(); },

      setLocked: function (locked) { state.locked = !!locked; },

      setShowCapitals: function (show) {
        state.showCapitals = !!show;
        Array.prototype.forEach.call(gCapitals.childNodes, function (n) {
          n.style.opacity = show ? "1" : "0";
        });
      },

      /** 画/更新所有的省会标记 */
      renderCapitals: function () {
        U.clear(gCapitals);
        var caps = mapData.capitals || {};
        var list = (country && country.regions) || [];
        list.forEach(function (meta) {
          var pt = caps[meta.id];
          if (!pt) return;
          var g = U.svgEl("g", { class: "tp-capital", "data-capital": meta.id });
          g.appendChild(U.svgEl("circle", { cx: pt[0], cy: pt[1], r: 4.4, class: "tp-capital-halo" }));
          g.appendChild(U.svgEl("circle", { cx: pt[0], cy: pt[1], r: 2.1, class: "tp-capital-dot" }));
          g.style.opacity = state.showCapitals ? "1" : "0";
          gCapitals.appendChild(g);
        });
      },

      /** 题面已知位置：高亮某个省 */
      highlight: function (id, kind) {
        U.clear(gOverlay);
        if (!id || !regionPaths[id]) return;
        var p = regionPaths[id];
        var cls = "tp-mark tp-mark-" + (kind || "given");
        gOverlay.appendChild(U.svgEl("path", { class: cls, d: regionById[id].d }));
      },

      /** 揭示：正确省高亮 + 省会红点脉动 + 标签引线 */
      reveal: function (region, status) {
        U.clear(gOverlay);
        U.clear(gLabels);
        if (!region || !regionPaths[region.id]) return;

        gOverlay.appendChild(U.svgEl("path", { class: "tp-mark tp-mark-" + (status || "correct"), d: regionById[region.id].d }));

        var labelPos = regionById[region.id].label || regionById[region.id].center;
        var text = locOf(region.names);
        var full = locOf(region.fullNames);

        var anchorX = W - 40;
        var anchorY = U.clamp(labelPos[1] - 26, 40, H - 30);

        // 引线：省名标签 ←→ 省会（或省中心）
        var cap = (mapData.capitals || {})[region.id];
        if (cap) {
          gLabels.appendChild(U.svgEl("path", {
            class: "tp-leader",
            d: "M" + cap[0] + " " + cap[1] + " L" + (labelPos[0] + 14) + " " + (labelPos[1] - 10)
          }));
          gLabels.appendChild(U.svgEl("circle", { class: "tp-capital-pulse", cx: cap[0], cy: cap[1], r: 9 }));
          gLabels.appendChild(U.svgEl("circle", { class: "tp-capital-pulse tp-capital-pulse-2", cx: cap[0], cy: cap[1], r: 9 }));
        }

        var g = U.svgEl("g", { class: "tp-region-label" });
        var t1 = U.svgEl("text", { class: "tp-label-main", x: labelPos[0], y: labelPos[1] });
        t1.textContent = text;
        g.appendChild(t1);
        // 小字：全称 + 简称/首府
        var subParts = [full];
        if (region.short && region.short.length) {
          subParts.push(region.short.map(function (s) { return s.char; }).join(" / "));
        }
        if (region.capitalTerm !== "none" && region.capital) {
          subParts.push(locOf(region.capital));
        }
        var t2 = U.svgEl("text", { class: "tp-label-sub", x: labelPos[0], y: labelPos[1] + 15 });
        t2.textContent = subParts.join(" · ");
        g.appendChild(t2);
        gLabels.appendChild(g);
      },

      clearMarks: function () { U.clear(gOverlay); U.clear(gLabels); },

      setLabelsVisible: function (visible) {
        gLabels.style.display = visible ? "" : "none";
      },

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

    return api;
  }

  T.map = {
    createMapView: createMapView,
    pathPoints: pathPoints,
    bboxOf: bboxOf,
    buildAdjacency: buildAdjacency,
    distance: distance
  };
})(window);
