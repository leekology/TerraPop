// TerraPop · 界面装配与流程
// ---------------------------------------------------------------
// 负责把 game.js 的题目、map.js 的地图、data/*.wiki.js 的百科装配成界面，
// 并管理 首页 → 答题 → 揭示 → 结算 的屏幕切换与设置。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;
  var t = function (k, v) { return T.i18n.t(k, v); };
  var $ = U.$;

  // ── 设置 ─────────────────────────────────────────────────────

  var DEFAULTS = {
    locale: "zh-Hans",
    mode: "location-to-name",
    scope: "all",
    wikiMode: "bilingual",
    inputMode: "text",
    judge: "lenient",
    hintFirstChar: false,
    hintCapital: false,
    hintGroup: false,
    timer: "off",
    sound: true,
    motion: true,
    voiceAuto: false
  };

  var settings = Object.assign({}, DEFAULTS, U.loadSettings());
  T.localeOrder = ["zh-Hans", "en"];

  function persist() { U.saveSettings(settings); }

  // ── 运行时状态 ───────────────────────────────────────────────

  var state = {
    country: null,
    mapData: null,
    mapView: null,
    session: null,
    pending: null,
    locked: false,
    adjacency: null,
    centers: null,
    radius: null,
    nameIndex: {},
    timerHandle: null,
    timerLeft: 0,
    globalDeadline: 0
  };

  var el = {};

  // ── 工具 ─────────────────────────────────────────────────────

  function localePick(obj, locale) {
    if (!obj) return "";
    return obj[locale] || obj[state.country.defaultLocale] || obj[Object.keys(obj)[0]] || "";
  }

  function wikiOf(regionId) {
    var w = T.wiki[state.country.id];
    return (w && w[regionId]) || null;
  }

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    el.toast.classList.add("tp-toast-show");
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(function () {
      el.toast.classList.remove("tp-toast-show");
      setTimeout(function () { el.toast.hidden = true; }, 260);
    }, ms || 2200);
  }

  var audioCtx = null;
  function beep(kind) {
    if (!settings.sound) return;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      var now = audioCtx.currentTime;
      var freq = kind === "correct" ? 660 : kind === "close" ? 520 : kind === "wrong" ? 240 : 440;
      o.type = "triangle";
      o.frequency.setValueAtTime(freq, now);
      if (kind === "correct") o.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.12);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      o.start(now); o.stop(now + 0.24);
    } catch (e) { /* 静默 */ }
  }

  // ── i18n 应用 ────────────────────────────────────────────────

  function applyI18n(root) {
    U.$$("[data-i18n]", root || document).forEach(function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    U.$$("[data-i18n-title]", root || document).forEach(function (node) {
      var v = t(node.dataset.i18nTitle);
      node.setAttribute("title", v);
      node.setAttribute("aria-label", v);
    });
    if (global.document) document.documentElement.lang = settings.locale;
  }

  // ── 范围 ─────────────────────────────────────────────────────

  function scopeRegionIds() {
    var c = state.country;
    switch (settings.scope) {
      case "provincesOnly":
        return c.regions.filter(function (r) { return r.type === "province"; }).map(function (r) { return r.id; });
      case "noMunicipality":
        return c.regions.filter(function (r) { return r.type === "province" || r.type === "autonomous"; })
          .map(function (r) { return r.id; });
      default:
        if (settings.scope.indexOf("group:") === 0) {
          var g = settings.scope.slice(6);
          return c.regions.filter(function (r) { return r.group === g; }).map(function (r) { return r.id; });
        }
        return null;
    }
  }

  function scopedRegions() {
    var ids = scopeRegionIds();
    if (!ids) return state.country.regions;
    return state.country.regions.filter(function (r) { return ids.indexOf(r.id) !== -1; });
  }

  var SCOPES = [
    { id: "all", key: "scope.all" },
    { id: "provincesOnly", key: "scope.provincesOnly" },
    { id: "noMunicipality", key: "scope.noMunicipality" }
  ].concat(T.groups.map(function (g) {
    return { id: "group:" + g, key: "group." + g, wrap: "scope.group" };
  }));

  // ── 首页 ─────────────────────────────────────────────────────

  function buildHome() {
    // 玩法
    U.clear(el.homeModeList);
    T.game.MODE_ORDER.forEach(function (mode) {
      var label = document.createElement("label");
      label.className = "tp-option" + (settings.mode === mode ? " tp-option-active" : "");
      label.dataset.mode = mode;
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "tp-mode";
      input.value = mode;
      input.checked = settings.mode === mode;
      input.addEventListener("change", function () {
        settings.mode = mode; persist(); buildHome();
      });
      var body = document.createElement("span");
      body.className = "tp-option-body";
      body.appendChild(U.el("b", { text: t("mode." + mode) }));
      body.appendChild(U.el("small", { text: t("mode." + mode + ".desc") }));
      label.appendChild(input);
      label.appendChild(body);
      el.homeModeList.appendChild(label);
    });

    // 范围
    U.clear(el.homeScopeList);
    SCOPES.forEach(function (s) {
      var label = document.createElement("label");
      label.className = "tp-chip-option" + (settings.scope === s.id ? " tp-chip-option-active" : "");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "tp-scope";
      input.value = s.id;
      input.checked = settings.scope === s.id;
      input.addEventListener("change", function () {
        settings.scope = s.id; persist(); buildHome();
      });
      label.appendChild(input);
      label.appendChild(U.el("span", { text: s.wrap ? t(s.wrap, { name: t(s.key) }) : t(s.key) }));
      el.homeScopeList.appendChild(label);
    });

    // 覆盖数量
    var n = scopedRegions().filter(function (r) { return T.game.eligible(r, settings.mode); }).length;
    el.homeRegionCount.textContent = t("home.regionCount", { n: n });
  }

  // ── 开始一局 ─────────────────────────────────────────────────

  function ensureMap() {
    if (state.mapView) return;
    state.mapData = T.maps[state.country.mapId];
    if (!state.mapData) { toast("map data missing"); return; }

    state.mapView = T.map.createMapView(el.mapHost, {
      mapData: state.mapData,
      terrain: (T.terrain[state.country.id] || null),
      country: state.country,
      locale: settings.locale,
      onSelect: onMapSelect
    });
    state.mapView.renderCapitals();

    // 省会坐标与容差半径
    state.centers = {};
    state.radius = {};
    state.mapData.regions.forEach(function (r) {
      state.centers[r.id] = r.center;
      var pts = T.map.pathPoints(r.d, 200);
      var b = T.map.bboxOf(pts);
      state.radius[r.id] = Math.max(b[2] - b[0], b[3] - b[1]) * 0.3;
    });

    // 邻接表（用于"接近"判定），只算一次
    if (!state.adjacency) state.adjacency = T.map.buildAdjacency(state.mapData, 1.6, 160);

    el.mapHost.addEventListener("pointerdown", function () { T.voice.stop(); });
  }

  function startGame() {
    ensureMap();
    state.country.regions.forEach(function (r) { state.nameIndex[r.id] = localePick(r.names, "zh-Hans"); });

    state.session = T.game.createSession({
      country: state.country,
      mode: settings.mode,
      regionIds: scopeRegionIds(),
      inputMode: settings.inputMode,
      judge: settings.judge,
      adjacency: state.adjacency,
      centers: state.centers,
      radius: state.radius,
      locale: settings.locale,
      hintsCapitalMarker: settings.hintCapital,
      hintsGroup: settings.hintGroup,
      nameOf: function (id) {
        var r = state.country.regions.filter(function (x) { return x.id === id; })[0];
        return r ? localePick(r.names, settings.locale) : id;
      }
    });

    if (!state.session.total) { toast("no question available"); return; }

    el.scoreBar.hidden = false;
    el.scoreValue.textContent = "0";
    el.comboChip.hidden = true;
    showScreen("play");

    if (settings.timer === "global") {
      state.globalDeadline = Date.now() + 60000;
    } else {
      state.globalDeadline = 0;
    }

    nextQuestion();
  }

  function showScreen(name) {
    el.screenHome.hidden = name !== "home";
    el.screenPlay.hidden = name !== "play";
    el.screenSummary.hidden = name !== "summary";
    if (name !== "play") { el.scoreBar.hidden = name !== "summary"; }
  }

  /** 中途退出：停表、清空标记、回首页 */
  function quitToHome() {
    stopTimer();
    T.voice.stop();
    state.locked = true;
    state.session = null;
    el.revealOverlay.hidden = true;
    el.revealOverlay.classList.remove("tp-overlay-show");
    if (state.mapView) { state.mapView.setLocked(true); state.mapView.clearMarks(); }
    showScreen("home");
    buildHome();
  }

  // ── 出题 ─────────────────────────────────────────────────────

  function nextQuestion() {
    stopTimer();
    var q = state.session.next();
    if (!q) { finish(); return; }

    state.pending = { location: null };
    q.ask.forEach(function (dim) { if (dim !== "location") state.pending[dim] = ""; });
    state.locked = false;

    el.qCounter.textContent = t("question.counter", { n: q.index + 1 });
    el.qProgress.textContent = t("question.progress", { done: q.index, total: state.session.total });

    state.mapView.clearMarks();
    state.mapView.setShowCapitals(settings.hintCapital && q.ask.indexOf("location") === -1);
    var canClick = q.ask.indexOf("location") !== -1;
    state.mapView.setLocked(!canClick);

    // 已知维度
    U.clear(el.knownCard);
    if (q.known && q.known !== "location") {
      el.knownCard.appendChild(U.el("div", {
        class: "tp-known-item",
        html: "<em>" + t("dim." + q.known) + "</em>" +
          "<b>" + U.escapeHtml(T.game.displayFor(q.region, q.known, settings.locale)) + "</b>"
      }));
    } else if (q.known === "location") {
      state.mapView.highlight(q.region.id, "given");
      el.knownCard.appendChild(U.el("div", { class: "tp-known-item tp-known-location", text: t("question.knownLocation") }));
    } else {
      el.knownCard.appendChild(U.el("div", { class: "tp-known-item tp-known-none", text: t("dim.full") + " · " + t("dim.short") + " · " + t("dim.capital") + " · " + t("dim.location") }));
    }

    // 题干
    U.clear(el.questionArea);
    el.questionArea.textContent = q.ask.map(function (dim) {
      if (dim === "location") return t("question.askLocation");
      if (dim === "capital") return t("question.askCapital", { term: q.term });
      return t("question.ask" + (dim === "full" ? "Full" : "Short"));
    }).join("　·　");

    // 提示
    U.clear(el.hintBar);
    var hints = [];
    if (q.hints.firstChar && settings.hintFirstChar) {
      q.ask.forEach(function (dim) {
        if (dim === "location") return;
        var v = T.game.displayFor(q.region, dim, "zh-Hans");
        if (dim === "capital" && q.region.capitalTerm === "none") return;
        hints.push(t("question.hintFirst", { v: U.firstChar(v) }));
      });
    }
    if (settings.hintGroup && q.ask.indexOf("location") !== -1) {
      hints.push("🧭 " + t("group." + q.region.group));
    }
    if (settings.hintCapital && q.ask.indexOf("location") === -1 && q.region.capital) {
      hints.push(t("question.hintCapitalMarker", { term: q.term }));
    }
    hints.forEach(function (h) { el.hintBar.appendChild(U.el("span", { class: "tp-hint-pill", text: h })); });

    buildAnswerArea(q);

    el.btnSubmit.disabled = false;
    el.btnSkip.disabled = false;

    if (settings.voiceAuto) speakQuestion(q);

    if (settings.timer === "perQuestion") startTimer(20000);
    else if (settings.timer === "global") startTimer(0);
  }

  function buildAnswerArea(q) {
    U.clear(el.answerArea);
    q.ask.forEach(function (dim) {
      var row = U.el("div", { class: "tp-answer-row", dataset: { dim: dim } });
      row.appendChild(U.el("label", { class: "tp-answer-label", text: t("dim." + dim) }));

      if (dim === "location") {
        var box = U.el("div", { class: "tp-location-box" });
        var value = U.el("span", { class: "tp-location-value", text: t("question.askLocation") });
        box.appendChild(value);
        box.dataset.value = "";
        row.appendChild(box);
        state.pending._locationNode = box;
      } else {
        var mode = settings.inputMode === "mixed" ? (dim === "short" ? "choice" : "text") : settings.inputMode;
        if (mode === "choice" && q.choices[dim]) {
          var wrap = U.el("div", { class: "tp-choice-wrap" });
          q.choices[dim].forEach(function (choice) {
            var b = U.el("button", { type: "button", class: "tp-choice-btn", text: choice });
            b.addEventListener("click", function () {
              state.pending[dim] = choice;
              U.$$(".tp-choice-btn", wrap).forEach(function (x) { x.classList.remove("tp-choice-btn-active"); });
              b.classList.add("tp-choice-btn-active");
            });
            wrap.appendChild(b);
          });
          row.appendChild(wrap);
        } else {
          var phKey = "input.placeholder." + dim;
          var hint = t(phKey, { term: q.term });
          if (dim === "short" && q.region.short && q.region.short.length > 1) {
            hint = t("input.placeholder.short") + " （" + t("input.multiShortHint") + "）";
          }
          var input = U.el("input", {
            class: "tp-input", type: "text", placeholder: hint,
            autocomplete: "off", autocapitalize: "off", spellcheck: "false"
          });
          if (settings.hintFirstChar) input.placeholder = hint;
          input.addEventListener("input", function () { state.pending[dim] = input.value; });
          input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          });
          row.appendChild(input);
          q._firstInput = q._firstInput || input;
        }
      }
      el.answerArea.appendChild(row);
    });

    if (q._firstInput) setTimeout(function () { try { q._firstInput.focus(); } catch (e) {} }, 30);
  }

  // ── 地图选择 ─────────────────────────────────────────────────

  function onMapSelect(regionId, ev) {
    var q = state.session && state.session.current;
    if (!q || state.locked) return;
    if (q.ask.indexOf("location") === -1) return;

    state.pending.location = { regionId: regionId };
    var node = state.pending._locationNode;
    if (node) {
      var r = state.country.regions.filter(function (x) { return x.id === regionId; })[0];
      node.dataset.value = regionId;
      node.textContent = localePick(r.names, settings.locale);
      node.classList.add("tp-location-set");
    }
    state.mapView.highlight(regionId, "picked");
    beep("tick");
  }

  // ── 提交与揭示 ───────────────────────────────────────────────

  function buildAnswersPayload() {
    var q = state.session.current;
    var payload = {};
    q.ask.forEach(function (dim) {
      if (dim === "location") {
        payload.location = state.pending.location ? { regionId: state.pending.location.regionId } : null;
      } else {
        payload[dim] = { value: state.pending[dim] || "" };
      }
    });
    return payload;
  }

  function onSubmit() { resolve(false); }
  function onSkip() { resolve(true); }

  function resolve(skipped) {
    var q = state.session.current;
    if (!q || state.locked) return;
    if (settings.timer === "global") checkGlobalTimeout();

    var payload = skipped ? {} : buildAnswersPayload();
    if (skipped) {
      q.ask.forEach(function (dim) {
        payload[dim] = dim === "location" ? null : { value: "" };
      });
    }

    state.locked = true;
    state.mapView.setLocked(true);
    stopTimer();

    var result = state.session.submit(payload);

    el.scoreValue.textContent = String(state.session.score);
    if (state.session.combo > 1) {
      el.comboChip.hidden = false;
      el.comboValue.textContent = t("score.comboUnit", { n: state.session.combo });
    } else {
      el.comboChip.hidden = true;
    }

    if (result.allCorrect) beep("correct");
    else if (result.items.some(function (i) { return i.status === "close"; })) beep("close");
    else beep("wrong");

    showReveal(result);
  }

  function verdictOf(result) {
    if (result.allCorrect) return { cls: "correct", text: t("feedback.correct") };
    if (result.items.some(function (i) { return i.status === "close"; })) return { cls: "close", text: t("feedback.close") };
    return { cls: "wrong", text: t("feedback.wrong") };
  }

  var lastResult = null;

  function showReveal(result) {
    lastResult = result;
    var q = result.question;
    var region = result.region;
    var verdict = verdictOf(result);

    el.revealBadge.className = "tp-verdict tp-verdict-" + verdict.cls;
    el.revealBadge.textContent = verdict.text;
    el.revealTitle.textContent = localePick(region.fullNames, settings.locale);
    el.revealTitle.dataset.pinyin = region.pinyin || "";

    // 地图上的揭示动画
    state.mapView.reveal(region, verdict.cls);

    U.clear(el.revealBody);

    // 四维信息卡
    var info = U.el("div", { class: "tp-reveal-info" });
    T.dims.forEach(function (dim) {
      var asked = q.ask.indexOf(dim) !== -1;
      var item = result.items.filter(function (x) { return x.dim === dim; })[0];
      var card = U.el("div", { class: "tp-info-card" + (asked ? " tp-info-asked tp-info-" + (item ? item.status : "") : "") });
      card.appendChild(U.el("em", { text: t("dim." + dim) }));
      card.appendChild(U.el("b", { text: T.game.displayFor(region, dim, settings.locale) }));
      if (asked && item && item.given) {
        card.appendChild(U.el("span", { class: "tp-info-given", text: t("reveal.yourAnswer") + "：" + item.given }));
      }
      if (dim === "capital" && region.capitalTerm !== "none") {
        card.appendChild(U.el("span", { class: "tp-info-sub", text: region.capitalTerm === "seat" ? t("term.seat") : t("term.capital") }));
      }
      if (dim === "capital" && region.capitalTerm === "none") {
        card.appendChild(U.el("span", { class: "tp-info-sub", text: localePick(region.capitalNote, settings.locale) }));
      }
      if (dim === "short" && region.short) {
        card.appendChild(U.el("span", { class: "tp-info-sub", text: region.short.map(function (s) { return s.pinyin; }).join(" / ") }));
      }
      info.appendChild(card);
    });
    // 类型 / 大区
    info.appendChild(U.el("div", { class: "tp-info-card tp-info-meta" }, [
      U.el("em", { text: t("type." + region.type) }),
      U.el("b", { text: t("group." + region.group) })
    ]));
    el.revealBody.appendChild(info);

    // 双语百科
    var wiki = wikiOf(region.id);
    if (wiki) {
      el.revealBody.appendChild(buildWikiBlock(wiki));
    } else {
      el.revealBody.appendChild(U.el("p", { class: "tp-wiki-missing", text: t("reveal.wikiMissing") }));
    }

    el.revealOverlay.hidden = false;
    requestAnimationFrame(function () { el.revealOverlay.classList.add("tp-overlay-show"); });
    setTimeout(function () { try { el.btnRevealNext.focus(); } catch (e) {} }, 60);
  }

  function buildWikiBlock(wiki) {
    var wrap = U.el("div", { class: "tp-wiki" });

    function section(title, obj, cls) {
      if (!obj) return;
      var cur = settings.locale;
      var other = T.i18n.otherLocale(cur);
      var locales = settings.wikiMode === "bilingual" ? [cur, other]
        : settings.wikiMode === "other" ? [other] : [cur];
      locales = locales.filter(function (l, i) { return obj[l] && locales.indexOf(l) === i; });
      if (!locales.length) return;

      var block = U.el("div", { class: "tp-wiki-section " + (cls || "") });
      block.appendChild(U.el("h3", { text: title }));
      locales.forEach(function (l) {
        var line = U.el("p", { class: "tp-wiki-line", lang: l });
        line.appendChild(U.el("span", { class: "tp-wiki-lang", text: T.i18n.localeLabel(l) }));
        line.appendChild(U.el("span", { class: "tp-wiki-text", text: obj[l] }));
        block.appendChild(line);
      });
      wrap.appendChild(block);
    }

    section("🧠 " + t("reveal.memo"), wiki.memo, "tp-wiki-memo");
    section("📌 " + t("reveal.facts"), wiki.facts, "tp-wiki-facts");
    section("📖 " + t("reveal.wiki"), wiki.wiki, "tp-wiki-text-block");
    return wrap;
  }

  // ── 结算 ─────────────────────────────────────────────────────

  function finish() {
    stopTimer();
    showScreen("summary");
    var s = state.session;
    var elapsed = state.globalDeadline ? Math.round((60000 - Math.max(0, state.globalDeadline - Date.now())) / 1000) : null;
    var cells = [
      ["summary.score", s.score],
      ["summary.correct", s.correctCount],
      ["summary.total", s.answeredCount],
      ["summary.accuracy", (s.answeredCount ? Math.round(s.correctCount / s.answeredCount * 100) : 0) + "%"],
      ["summary.bestCombo", s.bestCombo]
    ];
    U.clear(el.summaryBody);
    cells.forEach(function (c) {
      el.summaryBody.appendChild(U.el("div", { class: "tp-summary-cell" }, [
        U.el("em", { text: t(c[0]) }),
        U.el("b", { text: String(c[1]) })
      ]));
    });
    el.scoreBar.hidden = true;
    el.mapView && el.mapView.clearMarks();
  }

  // ── 计时 ─────────────────────────────────────────────────────

  function startTimer(ms) {
    stopTimer();
    el.qTimer.hidden = false;
    if (ms > 0) {
      state.timerLeft = ms;
      tickTimer(ms);
      state.timerHandle = setInterval(function () {
        state.timerLeft -= 100;
        tickTimer(state.timerLeft);
        if (state.timerLeft <= 0) { stopTimer(); resolve(true); }
      }, 100);
    } else {
      state.timerHandle = setInterval(function () {
        var left = state.globalDeadline - Date.now();
        if (left <= 0) { stopTimer(); el.qTimer.textContent = t("time.up"); finish(); return; }
        el.qTimer.textContent = Math.ceil(left / 1000) + "s";
      }, 200);
    }
  }

  function tickTimer(left) {
    el.qTimer.textContent = Math.max(0, Math.ceil(left / 1000)) + "s";
    el.qTimer.classList.toggle("tp-timer-low", left <= 6000);
  }

  function stopTimer() {
    if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
    el.qTimer.hidden = settings.timer === "off";
  }

  function checkGlobalTimeout() {
    if (state.globalDeadline && Date.now() >= state.globalDeadline) {
      toast(t("time.up"));
    }
  }

  // ── 语音 ─────────────────────────────────────────────────────

  function speakQuestion(q) {
    var parts = [];
    if (q.known === "location") parts.push(t("question.knownLocation"));
    else if (q.known) parts.push(t("dim." + q.known) + ": " + T.game.displayFor(q.region, q.known, settings.locale));
    q.ask.forEach(function (dim) {
      if (dim === "location") parts.push(t("question.askLocation"));
      else if (dim === "capital") parts.push(t("question.askCapital", { term: q.term }));
      else parts.push(t("question.ask" + (dim === "full" ? "Full" : "Short")));
    });
    T.voice.speak(parts.join("。"), settings.locale);
  }

  function speakReveal(result) {
    var r = result.region;
    var parts = [];
    parts.push(localePick(r.fullNames, settings.locale));
    parts.push(t("dim.short") + ": " + (r.short || []).map(function (s) { return s.char; }).join("、"));
    if (r.capitalTerm !== "none" && r.capital) {
      parts.push(t("term." + r.capitalTerm) + ": " + localePick(r.capital, settings.locale));
    }
    var w = wikiOf(r.id);
    if (w && w.memo) {
      var langs = settings.wikiMode === "bilingual"
        ? [settings.locale, T.i18n.otherLocale(settings.locale)]
        : settings.wikiMode === "other" ? [T.i18n.otherLocale(settings.locale)] : [settings.locale];
      langs.forEach(function (l) { if (w.memo[l]) parts.push(w.memo[l]); });
    }
    T.voice.speak(parts.join("。"), settings.locale);
  }

  // ── 设置面板 ─────────────────────────────────────────────────

  function buildSettings() {
    var body = el.settingsBody;
    U.clear(body);

    function group(titleKey, options, current, onPick) {
      var g = U.el("div", { class: "tp-set-group" });
      g.appendChild(U.el("h3", { text: t(titleKey) }));
      var wrap = U.el("div", { class: "tp-chip-option-row" });
      options.forEach(function (o) {
        var label = U.el("label", { class: "tp-chip-option" + (current === o.value ? " tp-chip-option-active" : "") });
        var input = U.el("input", { type: "radio", name: "set-" + titleKey, value: o.value });
        input.checked = current === o.value;
        input.addEventListener("change", function () { onPick(o.value); });
        label.appendChild(input);
        label.appendChild(U.el("span", { text: o.label }));
        wrap.appendChild(label);
      });
      g.appendChild(wrap);
      return g;
    }

    function toggle(titleKey, value, onPick) {
      var label = U.el("label", { class: "tp-toggle" });
      var input = U.el("input", { type: "checkbox" });
      input.checked = !!value;
      input.addEventListener("change", function () { onPick(input.checked); });
      label.appendChild(input);
      label.appendChild(U.el("span", { text: t(titleKey) }));
      return label;
    }

    body.appendChild(group("settings.wikiMode", [
      { value: "bilingual", label: t("settings.wikiMode.bilingual") },
      { value: "follow", label: t("settings.wikiMode.follow") },
      { value: "other", label: t("settings.wikiMode.other") }
    ], settings.wikiMode, function (v) { settings.wikiMode = v; persist(); buildSettings(); }));

    body.appendChild(group("settings.inputMode", [
      { value: "text", label: t("settings.inputMode.text") },
      { value: "choice", label: t("settings.inputMode.choice") },
      { value: "mixed", label: t("settings.inputMode.mixed") }
    ], settings.inputMode, function (v) { settings.inputMode = v; persist(); buildSettings(); }));

    body.appendChild(group("settings.judge", [
      { value: "lenient", label: t("settings.judge.lenient") },
      { value: "strict", label: t("settings.judge.strict") }
    ], settings.judge, function (v) { settings.judge = v; persist(); buildSettings(); }));

    body.appendChild(group("settings.timer", [
      { value: "off", label: t("settings.timer.off") },
      { value: "global", label: t("settings.timer.global") },
      { value: "perQuestion", label: t("settings.timer.perQuestion") }
    ], settings.timer, function (v) { settings.timer = v; persist(); buildSettings(); }));

    var toggles = U.el("div", { class: "tp-set-group" });
    toggles.appendChild(U.el("h3", { text: t("settings.helpers") }));
    toggles.appendChild(toggle("settings.hintFirst", settings.hintFirstChar, function (v) { settings.hintFirstChar = v; persist(); }));
    toggles.appendChild(toggle("settings.hintCapital", settings.hintCapital, function (v) { settings.hintCapital = v; persist(); }));
    toggles.appendChild(toggle("settings.hintGroup", settings.hintGroup, function (v) { settings.hintGroup = v; persist(); }));
    toggles.appendChild(toggle("settings.sound", settings.sound, function (v) { settings.sound = v; persist(); }));
    toggles.appendChild(toggle("settings.motion", settings.motion, function (v) {
      settings.motion = v; persist(); document.documentElement.classList.toggle("tp-reduce-motion", !v);
    }));
    toggles.appendChild(toggle("settings.voice.on", settings.voiceAuto, function (v) { settings.voiceAuto = v; persist(); }));
    body.appendChild(toggles);

    var langs = U.el("div", { class: "tp-set-group" });
    langs.appendChild(U.el("h3", { text: t("settings.language") }));
    var lwrap = U.el("div", { class: "tp-chip-option-row" });
    T.i18n.available().forEach(function (l) {
      var label = U.el("label", { class: "tp-chip-option" + (settings.locale === l ? " tp-chip-option-active" : "") });
      var input = U.el("input", { type: "radio", name: "set-lang", value: l });
      input.checked = settings.locale === l;
      input.addEventListener("change", function () { setLocale(l); });
      label.appendChild(input);
      label.appendChild(U.el("span", { text: T.i18n.localeLabel(l) }));
      lwrap.appendChild(label);
    });
    langs.appendChild(lwrap);
    body.appendChild(langs);
  }

  function setLocale(l) {
    settings.locale = l; persist();
    T.i18n.setLocale(l);
  }

  // ── 语言切换的联动刷新 ───────────────────────────────────────

  function refreshForLocale() {
    applyI18n();
    buildLangSelect();
    buildHome();
    buildSettings();
    if (state.mapView) state.mapView.setLocale(settings.locale);
    if (!el.screenPlay.hidden && state.session && state.session.current) {
      el.qCounter.textContent = t("question.counter", { n: state.session.current.index + 1 });
      el.qProgress.textContent = t("question.progress", { done: state.session.current.index, total: state.session.total });
      buildAnswerArea(state.session.current);
    }
  }

  function buildLangSelect() {
    U.clear(el.langSelect);
    T.i18n.available().forEach(function (l) {
      var o = document.createElement("option");
      o.value = l;
      o.textContent = T.i18n.localeLabel(l);
      if (l === settings.locale) o.selected = true;
      el.langSelect.appendChild(o);
    });
  }

  // ── 启动 ─────────────────────────────────────────────────────

  function cacheEls() {
    [
      "screenHome", "screenPlay", "screenSummary", "mapHost", "qCounter", "qProgress", "qTimer",      "knownCard", "questionArea", "hintBar", "answerArea", "btnSubmit", "btnSkip", "btnMic",
      "btnZoomIn", "btnZoomOut", "btnZoomReset", "btnStart", "homeModeList", "homeScopeList",
      "homeRegionCount", "langSelect", "btnSettings", "btnSettingsClose", "settingsOverlay",
      "settingsBody", "revealOverlay", "revealBody", "revealBadge", "revealTitle", "btnRevealNext",
      "btnRevealSpeak", "btnRestart", "btnHome", "scoreBar", "scoreValue", "comboChip", "comboValue",
      "toast", "summaryBody", "btnQuit"
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function bind() {
    el.langSelect.addEventListener("change", function () { setLocale(el.langSelect.value); });
    el.btnSettings.addEventListener("click", function () {
      buildSettings();
      el.settingsOverlay.hidden = false;
      requestAnimationFrame(function () { el.settingsOverlay.classList.add("tp-overlay-show"); });
    });
    el.btnSettingsClose.addEventListener("click", function () {
      el.settingsOverlay.classList.remove("tp-overlay-show");
      setTimeout(function () { el.settingsOverlay.hidden = true; }, 180);
    });
    el.btnStart.addEventListener("click", startGame);
    el.btnQuit.addEventListener("click", quitToHome);
    el.btnSubmit.addEventListener("click", onSubmit);
    el.btnSkip.addEventListener("click", onSkip);
    el.btnZoomIn.addEventListener("click", function () { state.mapView && state.mapView.zoomIn(); });
    el.btnZoomOut.addEventListener("click", function () { state.mapView && state.mapView.zoomOut(); });
    el.btnZoomReset.addEventListener("click", function () { state.mapView && state.mapView.resetView(); });
    el.btnRevealNext.addEventListener("click", function () {
      el.revealOverlay.classList.remove("tp-overlay-show");
      setTimeout(function () { el.revealOverlay.hidden = true; }, 180);
      nextQuestion();
    });
    el.btnRevealSpeak.addEventListener("click", function () { if (lastResult) speakReveal(lastResult); });
    el.btnRestart.addEventListener("click", startGame);
    el.btnHome.addEventListener("click", function () { showScreen("home"); buildHome(); });
    el.btnMic.addEventListener("click", function () {
      T.voice.listen({
        locale: settings.locale,
        onResult: function (text) { onSubmit(); },
        onError: function () { toast(t("voice.notImplemented")); }
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!el.settingsOverlay.hidden) el.btnSettingsClose.click();
      }
    });
  }

  function init() {
    state.country = T.countries.cn;
    if (!state.country) { document.body.innerHTML = "<p>data/cn.js missing</p>"; return; }

    cacheEls();

    // 语言顺序：以文件里的 _label 顺序为准
    T.localeOrder = ["zh-Hans", "en"];
    if (!T.i18n.has(settings.locale)) settings.locale = state.country.defaultLocale;
    T.i18n.setLocale(settings.locale);
    T.i18n.onChange(refreshForLocale);

    document.documentElement.classList.toggle("tp-reduce-motion", !settings.motion);

    buildLangSelect();
    applyI18n();
    buildHome();
    buildSettings();
    bind();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
