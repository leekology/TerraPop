// TerraPop · 核心命名空间与通用工具
// ---------------------------------------------------------------
// 所有脚本通过传统 <script> 标签加载（见 docs/architecture.md 的 file:// 约束），
// 因此这里用 IIFE + window.TERRAPOP 全局命名空间通信。
// ---------------------------------------------------------------

(function (global) {
  "use strict";

  var T = (global.TERRAPOP = global.TERRAPOP || {});
  T.countries = T.countries || {};
  T.wiki = T.wiki || {};
  T.maps = T.maps || {};
  T.terrain = T.terrain || {};
  T.locales = T.locales || {};
  T.localeOrder = T.localeOrder || [];

  // ── 归一化 ───────────────────────────────────────────────────
  // 目标：让「廣州市 / 广州市 /  广州 市 / Guangzhou / Guǎngzhōu」都折叠成同一个串。

  var PUNCT = /[\s\u3000\u00a0·・•‧∙\-–—_~.．。、,，;；:：!！?？'"“”‘’()（）\[\]【】{}<>《》「」『』]/g;

  function foldWords(str) {
    var words = T.hanFoldWords || {};
    var out = str;
    // 长词优先，避免「内蒙古」被单字表拆开
    var keys = Object.keys(words).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < keys.length; i++) {
      if (out.indexOf(keys[i]) !== -1) out = out.split(keys[i]).join(words[keys[i]]);
    }
    return out;
  }

  function foldChars(str) {
    var map = T.hanFold || {};
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      out += map[ch] || ch;
    }
    return out;
  }

  function stripDiacriticsLower(str) {
    // 只有含拉丁字母时才做，避免对纯中文做无谓的 normalize 分解
    if (!/[a-zA-Z\u00c0-\u024f]/.test(str)) return str;
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f\u0301\u0304\u030c]/g, "")
      .replace(/ü/g, "u")
      .toLowerCase();
  }

  function normalize(value) {
    if (value === null || value === undefined) return "";
    var s = String(value);
    if (s.normalize) s = s.normalize("NFKC"); // 全角 → 半角、兼容字符归一
    s = foldWords(s);
    s = foldChars(s);
    s = s.replace(PUNCT, "");
    s = stripDiacriticsLower(s);
    return s;
  }

  var SUFFIXES = [
    "特别行政区", "自治区", "自治州", "直辖市", "特区", "地区", "省", "市",
    "specialadministrativeregion", "autonomousregion", "municipality", "province", "city", "sar", "region"
  ];

  /** 生成"去掉行政后缀"的变体，用于答案宽容匹配（河北 ← 河北省）。 */
  function stripSuffix(normalized) {
    var out = normalized;
    for (var i = 0; i < SUFFIXES.length; i++) {
      var suf = normalize(SUFFIXES[i]);
      // 至少给主干留 2 个字，避免「石市」被削成「石」
      if (suf && out.length - suf.length >= 2 && out.slice(-suf.length) === suf) {
        out = out.slice(0, out.length - suf.length);
        break;
      }
    }
    return out;
  }

  /** 一个字符串的全部可接受写法（原文 + 去后缀）。 */
  function answerForms(value) {
    if (value === null || value === undefined) return [];
    var n = normalize(value);
    if (!n) return [];
    var s = stripSuffix(n);
    return s && s !== n ? [n, s] : [n];
  }

  // ── DOM 小工具 ───────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      });
    }
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ── 随机与数组 ───────────────────────────────────────────────

  function shuffle(arr, rnd) {
    var r = rnd || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sample(arr, n, rnd) { return shuffle(arr, rnd).slice(0, n); }
  function pick(arr, rnd) { return arr[Math.floor((rnd || Math.random)() * arr.length)]; }

  // ── 文本 ─────────────────────────────────────────────────────

  function format(tpl, vars) {
    if (tpl === null || tpl === undefined) return "";
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : "";
    });
  }

  function firstChar(s) {
    // 用 Array.from 正确处理代理对
    var chars = Array.from(String(s || ""));
    return chars.length ? chars[0] : "";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── 颜色（按大区，色盲友好：同时用明度差 + 描边差异）──────────

  var GROUP_COLORS = {
    north:       { fill: "#e8dcc0", ink: "#7a5c3a" },
    northeast:   { fill: "#dfe3cf", ink: "#5f6b47" },
    east:        { fill: "#e4ddd0", ink: "#7d6a52" },
    central:     { fill: "#e9e0c8", ink: "#7c6335" },
    south:       { fill: "#dcdfcb", ink: "#5d6b4e" },
    southwest:   { fill: "#e6dccb", ink: "#7a5f45" },
    northwest:   { fill: "#e3dcc6", ink: "#6f6440" },
    unknown:     { fill: "#e5ddc8", ink: "#77684c" }
  };

  function groupColor(group) { return GROUP_COLORS[group] || GROUP_COLORS.unknown; }

  // ── 持久化 ───────────────────────────────────────────────────

  var STORE_KEY = "terrapop.settings.v1";

  function loadSettings() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveSettings(obj) {
    try {
      if (global.localStorage) global.localStorage.setItem(STORE_KEY, JSON.stringify(obj));
    } catch (e) { /* file:// 或隐私模式下静默失败 */ }
  }

  // ── 导出 ─────────────────────────────────────────────────────

  T.util = {
    normalize: normalize,
    stripSuffix: stripSuffix,
    answerForms: answerForms,
    el: el, svgEl: svgEl, clear: clear, $: $, $$: $$,
    shuffle: shuffle, sample: sample, pick: pick,
    format: format, firstChar: firstChar, escapeHtml: escapeHtml,
    groupColor: groupColor,
    loadSettings: loadSettings, saveSettings: saveSettings,
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    debounce: function (fn, ms) {
      var t = null;
      return function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, args); }, ms);
      };
    }
  };

  T.groups = ["north", "northeast", "east", "central", "south", "southwest", "northwest"];
  T.dims = ["full", "short", "capital", "location"];
})(window);
