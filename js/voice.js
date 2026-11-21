// TerraPop · 语音
// ---------------------------------------------------------------
// speak()  —— 已实现：用 Web Speech API 朗读题面 / 答案 / 百科。
// listen() —— stub：语音识别作答。接口先固定下来，未来接上识别即可，
//             调用方只需在回调里走统一的 submitAnswer({source:'voice'})。
// 详见 docs/i18n.md 第 7 节。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});

  var synth = global.speechSynthesis || null;

  var LANG_TAG = {
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-TW",
    "en": "en-US"
  };

  function langTag(locale) { return LANG_TAG[locale] || locale || "en-US"; }

  function available() { return !!synth && typeof global.SpeechSynthesisUtterance === "function"; }

  function pickVoice(locale) {
    if (!synth || !synth.getVoices) return null;
    var tag = langTag(locale).toLowerCase();
    var base = tag.split("-")[0];
    var voices = synth.getVoices() || [];
    var exact = voices.filter(function (v) { return (v.lang || "").toLowerCase() === tag; });
    if (exact.length) return exact[0];
    var loose = voices.filter(function (v) { return (v.lang || "").toLowerCase().indexOf(base) === 0; });
    return loose[0] || null;
  }

  function stop() { if (synth) { try { synth.cancel(); } catch (e) {} } }

  /**
   * 朗读一段文本。
   * @param {string} text
   * @param {string} [locale]
   * @param {{rate?:number}} [opts]
   */
  function speak(text, locale, opts) {
    if (!available() || !text) return false;
    stop();
    var u = new global.SpeechSynthesisUtterance(String(text));
    u.lang = langTag(locale || T.i18n.getLocale());
    var v = pickVoice(locale || T.i18n.getLocale());
    if (v) u.voice = v;
    u.rate = (opts && opts.rate) || 0.95;
    u.pitch = 1;
    synth.speak(u);
    return true;
  }

  // ── 语音作答（stub）───────────────────────────────────────────

  var ListeningStub = {
    supported: false,
    reason: "not-implemented"
  };

  /**
   * 语音识别作答（尚未实现）。
   * 真正的实现应当在 onResult 里回调识别出的文本，
   * 由 app.js 用 submitAnswer({source:'voice', payload:text}) 消费。
   */
  function listen(opts) {
    var o = opts || {};
    setTimeout(function () {
      if (o.onError) o.onError(ListeningStub.reason);
    }, 0);
    return function cancel() {};
  }

  T.voice = {
    available: available,
    speak: speak,
    stop: stop,
    listen: listen,
    listeningSupported: ListeningStub.supported,
    langTag: langTag
  };

  // 部分浏览器需要先"预热"一次 voices 列表
  if (synth && synth.getVoices) {
    try { synth.getVoices(); } catch (e) {}
  }
})(window);
