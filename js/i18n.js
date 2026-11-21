// TerraPop · 语言切换与文案查表
// ---------------------------------------------------------------
// 语言是数据不是分支：locales/*.js 往 TERRAPOP.locales 里挂 key → 字符串。
// 新增语言只需多一个 locales/xx.js 文件，见 docs/i18n.md。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});

  var listeners = [];

  function available() {
    var keys = Object.keys(T.locales);
    var ordered = (T.localeOrder || []).filter(function (k) { return keys.indexOf(k) !== -1; });
    keys.forEach(function (k) { if (ordered.indexOf(k) === -1) ordered.push(k); });
    return ordered;
  }

  var state = {
    current: null,
    fallback: "zh-Hans"
  };

  function has(locale) { return !!(T.locales && T.locales[locale]); }

  /**
   * 查一条文案。
   * @param {string} key
   * @param {object} [vars] 占位符，形如 {n: 3} 对应 "{n}"
   */
  function t(key, vars) {
    var chain = [state.current, state.fallback].filter(Boolean);
    for (var i = 0; i < chain.length; i++) {
      var pack = T.locales[chain[i]];
      if (pack && pack[key] !== undefined) return T.util.format(pack[key], vars);
    }
    return key; // 未翻译时原样返回 key，方便开发时发现遗漏
  }

  function localeLabel(locale) {
    var pack = T.locales[locale];
    return (pack && (pack._label || pack._english)) || locale;
  }

  function setLocale(locale) {
    if (!has(locale)) return state.current;
    if (state.current === locale) return locale;
    state.current = locale;
    if (global.document && document.documentElement) document.documentElement.lang = locale;
    listeners.forEach(function (fn) { try { fn(locale); } catch (e) { console.error(e); } });
    return locale;
  }

  /** 返回"另一种语言"，用于双语百科并排展示。 */
  function otherLocale(locale) {
    var list = available();
    var cur = locale || state.current;
    for (var i = 0; i < list.length; i++) if (list[i] !== cur) return list[i];
    return cur;
  }

  function onChange(fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

  T.i18n = {
    t: t,
    setLocale: setLocale,
    getLocale: function () { return state.current; },
    available: available,
    has: has,
    localeLabel: localeLabel,
    otherLocale: otherLocale,
    onChange: onChange
  };
})(window);
