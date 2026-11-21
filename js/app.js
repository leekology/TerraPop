// TerraPop · 界面装配与流程（问答分离 · 位置固定 · 零阻断）
// ---------------------------------------------------------------
// 版面从上到下固定为：
//   头部（题号 / 计时 / 连击 / 得分 / 正确率）+ 进度条
//   上一题卡片（固定高度、内部滚动）：上一题的四维信息 + 记忆点 + 双语百科
//     —— 第一题时这里显示玩法说明
//   当前题（固定位置）：已知信息 → 题面 → 作答区（固定高度的控件区）
//
// 所以答完一题不会有任何"揭示态"：上一题的信息直接落到上方卡片，
// 下方同一个位置立刻换成下一题。鼠标和视线都不用移动。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;
  var t = function (k, v) { return T.i18n.t(k, v); };
  var DIMS = ["full", "short", "capital", "location"];

  // 上一题的地图画面多留一会儿：下一题如果也要看图，就少留一点
  var MAP_BEAT_IDLE = 1900;
  var MAP_BEAT_NEEDED = 900;

  // ── 设置 ─────────────────────────────────────────────────────

  var DEFAULTS = {
    locale: "zh-Hans",
    known: "location",
    asked: "full",
    style: "text",
    scope: "all",
    judge: "lenient",
    timer: "off",
    sound: true,
    motion: true,
    wikiMode: "bilingual",
    smartInput: true,
    hintFirstChar: false,
    hintCapital: false,
    hintGroup: false,
    showTerrainLabels: true,
    showLegend: true,
    voiceAuto: false
  };

  var settings = Object.assign({}, DEFAULTS, U.loadSettings());
  function persist() { U.saveSettings(settings); }

  var state = {
    country: null,
    mapData: null,
    mapView: null,
    session: null,
    question: null,
    phase: "idle",          // idle | ask | locked
    pending: "",
    pendingRegion: null,
    adjacency: null,
    centers: null,
    radius: null,
    lastResult: null,
    timerHandle: null,
    globalDeadline: 0,
    mapGen: 0,
    beatPending: false,
    startedAt: 0,
    timerLeft: 0
  };

  var el = {};

  // ── 小工具 ───────────────────────────────────────────────────

  function localePick(obj, locale) {
    if (!obj) return "";
    return obj[locale] || obj[state.country.defaultLocale] || obj[Object.keys(obj)[0]] || "";
  }

  function wikiOf(id) {
    var w = T.wiki[state.country.id];
    return (w && w[id]) || null;
  }

  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    el.toast.classList.add("tp-toast-show");
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(function () {
      el.toast.classList.remove("tp-toast-show");
      setTimeout(function () { el.toast.hidden = true; }, 240);
    }, ms || 1800);
  }

  function boardValue(region, dim) {
    if (dim === "short") return T.game.shortDisplay(region, settings.locale);
    return T.game.displayFor(region, dim, settings.locale);
  }

  /** 把毫秒格式化成「2 分 13 秒」/「13 秒」 */
  function formatDuration(ms) {
    var total = Math.max(0, Math.round((ms || 0) / 1000));
    var m = Math.floor(total / 60), s = total % 60;
    return m > 0 ? t("summary.timeFmt", { m: m, s: s }) : t("summary.secFmt", { s: s });
  }

  // ── 音效 ─────────────────────────────────────────────────────

  var audioCtx = null;
  function ctx() {
    if (!settings.sound) return null;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }

  function tone(freq, delay, dur, type, vol) {
    var ac = ctx();
    if (!ac) return;
    var now = ac.currentTime + (delay || 0);
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol || 0.09, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.16));
    o.connect(g); g.connect(ac.destination);
    o.start(now); o.stop(now + (dur || 0.16) + 0.03);
  }

  function sfx(kind, combo) {
    if (!settings.sound) return;
    if (kind === "correct") {
      var bump = Math.min(combo || 1, 8);
      var base = 523.25 * Math.pow(2, (bump - 1) / 12);
      tone(base, 0, 0.13, "triangle", 0.10);
      tone(base * 1.26, 0.075, 0.15, "triangle", 0.09);
      tone(base * 1.5, 0.15, 0.2, "sine", 0.07);
    } else if (kind === "close") {
      tone(494, 0, 0.1, "triangle", 0.08);
      tone(440, 0.08, 0.14, "triangle", 0.06);
    } else if (kind === "wrong") {
      tone(233, 0, 0.16, "sawtooth", 0.06);
      tone(180, 0.10, 0.22, "sawtooth", 0.055);
    } else if (kind === "pick") {
      tone(880, 0, 0.05, "sine", 0.045);
    } else if (kind === "finish") {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone(f, i * 0.11, 0.2, "triangle", 0.085);
      });
    }
  }

  // ── i18n ─────────────────────────────────────────────────────

  function applyI18n(root) {
    U.$$("[data-i18n]", root || document).forEach(function (n) { n.textContent = t(n.dataset.i18n); });
    U.$$("[data-i18n-title]", root || document).forEach(function (n) {
      var v = t(n.dataset.i18nTitle);
      n.setAttribute("title", v);
      n.setAttribute("aria-label", v);
    });
    document.documentElement.lang = settings.locale;
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

  var SCOPES = [
    { id: "all", key: "scope.all" },
    { id: "provincesOnly", key: "scope.provincesOnly" },
    { id: "noMunicipality", key: "scope.noMunicipality" }
  ].concat(T.groups.map(function (g) { return { id: "group:" + g, key: "group." + g }; }));

  function poolSize() {
    var ids = scopeRegionIds();
    return state.country.regions.filter(function (r) {
      if (ids && ids.indexOf(r.id) === -1) return false;
      return T.game.eligible(r, settings.known, settings.asked);
    }).length;
  }

  function firstOther(dim) {
    return DIMS.filter(function (d) { return d !== dim; })[0];
  }

  // ── chip 组 ──────────────────────────────────────────────────

  function buildChips(host, items, current, onPick) {
    U.clear(host);
    items.forEach(function (it) {
      var label = U.el("label", { class: "tp-chip" + (current === it.value ? " tp-chip-on" : "") });
      var input = U.el("input", { type: "radio", name: host.id, value: it.value });
      input.checked = current === it.value;
      input.addEventListener("change", function () { onPick(it.value); });
      label.appendChild(input);
      label.appendChild(U.el("span", { text: it.label }));
      if (it.sub) label.appendChild(U.el("small", { text: it.sub }));
      host.appendChild(label);
    });
  }

  // ── 首页 ─────────────────────────────────────────────────────

  function buildHome() {
    var dimItems = DIMS.map(function (d) { return { value: d, label: t("dim." + d) }; })
      .concat([{ value: "random", label: t("config.random") }]);

    buildChips(el.knownChips, dimItems, settings.known, function (v) {
      settings.known = v;
      if (v !== "random" && settings.asked === v) settings.asked = firstOther(v);
      persist(); buildHome();
    });
    buildChips(el.askedChips, dimItems, settings.asked, function (v) {
      settings.asked = v;
      if (v !== "random" && settings.known === v) settings.known = firstOther(v);
      if (v === "location") settings.style = "locate";
      else if (settings.style === "locate") settings.style = "text";
      persist(); buildHome();
    });
    buildChips(el.styleChips, [
      { value: "text", label: t("style.text") },
      { value: "choice3", label: t("style.choice3"), sub: t("style.easy") },
      { value: "choice4", label: t("style.choice4"), sub: t("style.normal") },
      { value: "choice5", label: t("style.choice5"), sub: t("style.hard") },
      { value: "locate", label: t("style.locate") }
    ], settings.asked === "location" ? "locate" : settings.style, function (v) {
      settings.style = v;
      if (v === "locate") settings.asked = "location";
      else if (settings.asked === "location") settings.asked = "capital";
      persist(); buildHome();
    });
    buildChips(el.scopeChips, SCOPES.map(function (s) {
      return { value: s.id, label: s.id.indexOf("group:") === 0 ? t("group." + s.id.slice(6)) : t(s.key) };
    }), settings.scope, function (v) { settings.scope = v; persist(); buildHome(); });

    var n = poolSize();
    el.homeRegionCount.textContent = t("home.regionCount", { n: n });
    el.configSummary.textContent = t("config.summary", {
      known: settings.known === "random" ? t("config.random") : t("dim." + settings.known),
      asked: settings.asked === "random" ? t("config.random") : t("dim." + settings.asked),
      style: t("style." + (settings.asked === "location" ? "locate" : settings.style))
    });
    el.configSummary.classList.toggle("tp-config-warn", n === 0);
    el.btnStart.disabled = n === 0;
    if (n === 0) el.configSummary.textContent = t("config.empty");
  }

  // ── 地图 ─────────────────────────────────────────────────────

  function buildLegend() {
    var terrain = T.terrain[state.country.id];
    U.clear(el.mapLegend);
    el.mapLegend.hidden = !settings.showLegend;
    if (!settings.showLegend) return;
    var items = [];
    if (terrain) {
      var kinds = {};
      (terrain.landforms || []).forEach(function (l) { kinds[l.kind || "plateau"] = 1; });
      ["plateau", "basin", "plain", "desert", "hills"].forEach(function (k) {
        if (kinds[k]) items.push({ cls: "tp-lg-" + k, label: t("legend." + k) });
      });
      if ((terrain.ranges || []).length) items.push({ cls: "tp-lg-range", label: t("legend.range") });
      if ((terrain.rivers || []).length) items.push({ cls: "tp-lg-river", label: t("legend.river") });
      if ((terrain.lakes || []).length) items.push({ cls: "tp-lg-lake", label: t("legend.lake") });
    }
    items.forEach(function (it) {
      el.mapLegend.appendChild(U.el("span", { class: "tp-legend-item" }, [
        U.el("i", { class: it.cls }), U.el("span", { text: it.label })
      ]));
    });
  }

  function ensureMap() {
    if (state.mapView) return;
    state.mapData = T.maps[state.country.mapId];
    if (!state.mapData) { toast("map data missing"); return; }

    state.mapView = T.map.createMapView(el.mapHost, {
      mapData: state.mapData,
      terrain: T.terrain[state.country.id] || null,
      country: state.country,
      locale: settings.locale,
      onSelect: onMapPick
    });
    state.mapView.renderCapitals();
    state.mapView.setTerrainLabels(settings.showTerrainLabels);

    state.centers = {};
    state.radius = {};
    state.mapData.regions.forEach(function (r) {
      state.centers[r.id] = r.center;
      var b = T.map.bboxOf(T.map.pathPoints(r.d, 200));
      state.radius[r.id] = Math.max(b[2] - b[0], b[3] - b[1]) * 0.3;
    });
    if (!state.adjacency) state.adjacency = T.map.buildAdjacency(state.mapData, 1.6, 160);
    buildLegend();
  }

  // ── 一局 ─────────────────────────────────────────────────────

  function startGame() {
    ensureMap();
    if (!state.mapData) return;

    state.session = T.game.createSession({
      country: state.country,
      known: settings.known,
      asked: settings.asked,
      style: settings.style,
      regionIds: scopeRegionIds(),
      judge: settings.judge,
      adjacency: state.adjacency,
      centers: state.centers,
      radius: state.radius,
      locale: settings.locale
    });
    if (!state.session.total) { toast(t("config.empty")); return; }

    state.lastResult = null;
    state.beatPending = false;
    state.startedAt = Date.now();
    state.globalDeadline = settings.timer === "global" ? Date.now() + 60000 : 0;

    el.mapLegend.hidden = !settings.showLegend;
    showScreen("play");
    updateHud();
    renderPrevCard(null);           // 第一题：上方卡片显示玩法说明
    nextQuestion();
  }

  function showScreen(name) {
    el.screenHome.hidden = name !== "home";
    el.screenPlay.hidden = name !== "play";
    el.screenSummary.hidden = name !== "summary";
    if (name === "home") el.mapLegend.hidden = true;
  }

  function quitToHome() {
    stopTimer();
    T.voice.stop();
    state.session = null;
    state.phase = "idle";
    state.question = null;
    state.mapGen++;
    if (state.mapView) { state.mapView.setLocked(true); state.mapView.clearMarks(); state.mapView.setShowCapitals(false); }
    showScreen("home");
    buildHome();
  }

  /** 本局是否正在进行（有题目还没答完，且正停在答题屏） */
  function inProgress() {
    var s = state.session;
    return !!(s && !s.finished && !el.screenPlay.hidden);
  }

  /** 左上角 / 面板里的 ⌂ 都走这里：进行中先确认 */
  function requestHome() {
    if (inProgress()) { showConfirm(); return; }
    quitToHome();
  }

  function showConfirm() {
    var s = state.session;
    el.confirmBody.textContent = s.answeredCount
      ? t("confirm.body", { done: s.answeredCount, best: s.bestCombo })
      : t("confirm.bodyFresh");
    pauseTimer();
    showOverlay(el.confirmOverlay);
    setTimeout(function () { try { el.btnConfirmStay.focus(); } catch (e) {} }, 40);
  }

  function dismissConfirm(stay) {
    hideOverlay(el.confirmOverlay);
    if (stay) resumeTimer();
    else quitToHome();
  }

  function updateHud() {
    var s = state.session;
    if (!s) return;
    el.hudScore.textContent = String(s.score);
    el.hudAcc.textContent = s.answeredCount ? Math.round(s.accuracy() * 100) + "%" : "—";
    el.comboBadge.hidden = s.combo < 2;
    el.comboBadge.textContent = t("hud.comboBadge", { n: s.combo });
    el.comboBadge.classList.toggle("tp-combo-hot", s.combo >= 3);
  }

  // ── 出题（下半区）────────────────────────────────────────────

  function nextQuestion() {
    stopTimer();
    var q = state.session.next();
    if (!q) { finish(); return; }

    state.question = q;
    state.phase = "ask";
    state.pending = "";
    state.pendingRegion = null;

    el.qCounter.textContent = t("question.counter", { n: q.index + 1 }) + " / " + state.session.total;
    el.progressFill.style.width = (q.index / state.session.total * 100) + "%";

    renderCurrent(q);
    applyHints(q);

    // 地图：默认先锁住；上一题的答案画面留一小会儿再切到本题
    state.mapView.setLocked(true);
    var beat = state.beatPending ? (q.asked === "location" ? MAP_BEAT_NEEDED : MAP_BEAT_IDLE) : 0;
    state.beatPending = false;
    applyMapState(q, beat);

    if (settings.timer === "perQuestion") startTimer(20000);
    else if (settings.timer === "global") startTimer(0);
    if (settings.voiceAuto) speakQuestion(q);

    var input = el.answerArea.querySelector(".tp-answer-input");
    if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 20);
  }

  function applyMapState(q, delay) {
    var gen = ++state.mapGen;
    var run = function () {
      if (gen !== state.mapGen || state.question !== q) return;
      state.mapView.clearMarks();
      state.mapView.setShowCapitals(settings.hintCapital && q.asked !== "location");
      state.mapView.setLocked(q.asked !== "location");
      if (q.known === "location") state.mapView.highlight(q.region.id, "given");
    };
    if (delay > 0) setTimeout(run, delay);
    else run();
  }

  function renderCurrent(q) {
    // 已知信息
    U.clear(el.knownChip);
    el.knownChip.appendChild(U.el("em", { text: t("dim." + q.known) }));
    el.knownChip.appendChild(U.el("b", {
      text: q.known === "location" ? t("question.knownLocation") : boardValue(q.region, q.known)
    }));
    if (q.known === "capital") el.knownChip.appendChild(U.el("small", { text: T.game.termOf(q.region) }));

    // 题面
    el.askText.textContent = q.asked === "location"
      ? t("question.askLocation")
      : t("question.prompt", { asked: t("dim." + q.asked) });

    renderAnswerArea(q);
  }

  function applyHints(q) {
    U.clear(el.hintBar);
    var hints = [];
    if (settings.hintFirstChar && q.asked !== "location") {
      hints.push(t("question.hintFirst", { v: U.firstChar(boardValue(q.region, q.asked)) }));
    }
    if (settings.hintGroup && q.asked === "location") hints.push("🧭 " + t("group." + q.region.group));
    if (settings.hintCapital && q.asked !== "location" && q.region.capital) {
      hints.push(t("question.hintCapitalMarker", { term: T.game.termOf(q.region) }));
    }
    hints.forEach(function (h) { el.hintBar.appendChild(U.el("span", { class: "tp-hint-pill", text: h })); });
    el.hintBar.classList.toggle("tp-hints-empty", hints.length === 0);
  }

  // ── 作答区（固定高度 / 固定位置）─────────────────────────────

  function renderAnswerArea(q) {
    U.clear(el.answerArea);
    var body = U.el("div", { class: "tp-answer-body" });
    el.answerArea.appendChild(body);

    if (q.asked === "location") {
      var box = U.el("div", { class: "tp-locate-box" });
      box.appendChild(U.el("span", { class: "tp-locate-icon", text: "📍" }));
      box.appendChild(U.el("span", { class: "tp-locate-text", text: t("question.askLocation") }));
      body.appendChild(box);
    } else if (q.style === "text") {
      var row = U.el("div", { class: "tp-input-row" });
      var input = U.el("input", {
        class: "tp-answer-input", type: "text", autocomplete: "off",
        autocapitalize: "off", spellcheck: "false",
        placeholder: settings.smartInput ? t("input.smartPlaceholder") : t("input.placeholder")
      });
      input.addEventListener("input", onInput);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();      // 别冒泡出去
          commitText();
        }
      });
      var ok = U.el("button", { class: "tp-btn tp-btn-primary tp-btn-sm", text: t("action.submit") });
      ok.addEventListener("click", commitText);
      row.appendChild(input);
      row.appendChild(ok);
      body.appendChild(row);
      body.appendChild(U.el("div", { class: "tp-suggest", id: "suggest" }));
      body.appendChild(U.el("small", { class: "tp-smart-hint", text: settings.smartInput ? t("input.smartHint") : "" }));
    } else {
      var grid = U.el("div", { class: "tp-choices" });
      q.choices.forEach(function (label, i) {
        var b = U.el("button", { class: "tp-choice", type: "button" }, [
          U.el("span", { class: "tp-choice-key", text: String(i + 1) }),
          U.el("span", { class: "tp-choice-text", text: label })
        ]);
        b.addEventListener("click", function () { commit({ kind: "choice", value: label }); });
        grid.appendChild(b);
      });
      body.appendChild(grid);
    }

    var skip = U.el("button", { class: "tp-btn tp-btn-ghost tp-btn-sm tp-answer-skip", text: t("action.skip") });
    skip.addEventListener("click", function () { commit({ kind: "skip" }); });
    el.answerArea.appendChild(skip);
  }

  // ── 智能输入 ─────────────────────────────────────────────────

  function onInput(e) {
    var q = state.question;
    if (!q || state.phase !== "ask") return;
    state.pending = e.target.value;
    var box = el.answerArea.querySelector("#suggest");
    if (!box) return;
    U.clear(box);

    if (!state.pending.trim()) { e.target.classList.remove("tp-input-bad"); return; }
    if (!settings.smartInput) return;

    var m = T.game.matchInput(state.session.pool, q.asked, settings.locale, state.pending);
    if (m.unique) {
      e.target.classList.remove("tp-input-bad");
      commitText();
      return;
    }
    if (m.kind === "multi") {
      e.target.classList.remove("tp-input-bad");
      m.candidates.slice(0, 6).forEach(function (id) {
        var r = state.session.regionById[id];
        var b = U.el("button", { class: "tp-suggest-item", type: "button", text: boardValue(r, q.asked) });
        b.addEventListener("click", function () { commit({ kind: "choice", value: boardValue(r, q.asked) }); });
        box.appendChild(b);
      });
      box.appendChild(U.el("span", { class: "tp-suggest-hint", text: t("input.ambiguous", { n: m.candidates.length }) }));
    } else {
      e.target.classList.add("tp-input-bad");
    }
  }

  function commitText() {
    var input = el.answerArea.querySelector(".tp-answer-input");
    commit({ kind: "text", value: input ? input.value : "" });
  }

  function onMapPick(regionId) {
    if (state.phase !== "ask") return;
    var q = state.question;
    if (!q || q.asked !== "location") return;
    state.pendingRegion = regionId;
    sfx("pick");
    commit({ kind: "locate", regionId: regionId });
  }

  // ── 提交：上一题进卡片，下半区立刻换题 ───────────────────────

  function commit(answer) {
    if (state.phase !== "ask") return;
    var q = state.question;
    if (settings.timer === "global") checkGlobalTimeout();

    state.phase = "locked";
    stopTimer();
    state.mapView.setLocked(true);

    var result = state.session.submit(answer);
    state.lastResult = result;

    if (result.correct) sfx("correct", result.combo);
    else if (result.close) sfx("close");
    else sfx("wrong");

    // 地图上把聚光灯打到正确答案——这就是"上一题"留下的画面
    state.mapView.reveal(result.region, result.correct ? "correct" : result.close ? "close" : "wrong");

    renderPrevCard(result);
    updateHud();
    el.progressFill.style.width = ((q.index + 1) / state.session.total * 100) + "%";

    state.beatPending = true;
    nextQuestion();      // 零阻断：下一题立刻占上同一个位置
  }

  // ── 上一题卡片 ───────────────────────────────────────────────

  function renderPrevCard(result) {
    U.clear(el.prevCard);
    if (!result) {
      el.prevCard.classList.remove("tp-prev-answer");
      el.prevCard.appendChild(U.el("h3", { class: "tp-prev-title", text: t("prev.explainTitle") }));
      el.prevCard.appendChild(U.el("p", { class: "tp-prev-body", text: t("prev.explainBody") }));
      return;
    }

    var region = result.region;
    var cls = result.correct ? "correct" : result.close ? "close" : "wrong";
    el.prevCard.classList.add("tp-prev-answer");
    el.prevCard.classList.remove("tp-prev-" + "correct", "tp-prev-close", "tp-prev-wrong");
    el.prevCard.classList.add("tp-prev-" + cls);

    var head = U.el("div", { class: "tp-prev-head" });
    head.appendChild(U.el("span", { class: "tp-verdict tp-verdict-" + cls, text: t("feedback." + cls) }));
    head.appendChild(U.el("b", { class: "tp-prev-name", text: localePick(region.fullNames, settings.locale) }));
    head.appendChild(U.el("span", {
      class: "tp-prev-your",
      text: t("prev.yourAnswer") + "：" + (result.given || t("prev.unknown"))
    }));
    el.prevCard.appendChild(head);

    var info = U.el("div", { class: "tp-prev-info" });
    DIMS.forEach(function (dim) {
      var cell = U.el("span", {
        class: "tp-prev-cell" + (dim === result.question.asked ? " tp-prev-cell-asked" : "")
      });
      cell.appendChild(U.el("em", { text: t("dim." + dim) }));
      cell.appendChild(U.el("b", { text: boardValue(region, dim) }));
      if (dim === "capital" && region.capitalTerm !== "none") {
        cell.appendChild(U.el("small", { text: T.game.termOf(region) }));
      }
      info.appendChild(cell);
    });
    el.prevCard.appendChild(info);

    var v = wikiOf(region.id);
    if (v) el.prevCard.appendChild(buildWikiBlock(v));
    else el.prevCard.appendChild(U.el("p", { class: "tp-wiki-missing", text: t("reveal.wikiMissing") }));
  }

  function buildWikiBlock(v) {
    var wrap = U.el("div", { class: "tp-wiki" });
    function section(title, obj, cls) {
      if (!obj) return;
      var cur = settings.locale;
      var other = T.i18n.otherLocale(cur);
      var locales = settings.wikiMode === "bilingual" ? [cur, other]
        : settings.wikiMode === "other" ? [other] : [cur];
      var out = [];
      locales.forEach(function (l) { if (obj[l] && out.indexOf(l) === -1) out.push(l); });
      if (!out.length) return;
      var block = U.el("div", { class: "tp-wiki-section " + (cls || "") });
      block.appendChild(U.el("h4", { text: title }));
      out.forEach(function (l) {
        var line = U.el("p", { class: "tp-wiki-line", lang: l });
        line.appendChild(U.el("span", { class: "tp-wiki-lang", text: T.i18n.localeLabel(l) }));
        line.appendChild(U.el("span", { class: "tp-wiki-text", text: obj[l] }));
        block.appendChild(line);
      });
      wrap.appendChild(block);
    }
    section("🧠 " + t("reveal.memo"), v.memo, "tp-wiki-memo");
    section("📌 " + t("reveal.facts"), v.facts, "tp-wiki-facts");
    section("📖 " + t("reveal.wiki"), v.wiki, "tp-wiki-block");
    return wrap;
  }

  // ── 计时 ─────────────────────────────────────────────────────

  function startTimer(ms) {
    stopTimer();
    el.qTimer.hidden = false;
    if (ms > 0) {
      state.timerLeft = ms;
      tickTimer(state.timerLeft);
      state.timerHandle = setInterval(function () {
        state.timerLeft -= 100;
        tickTimer(state.timerLeft);
        if (state.timerLeft <= 0) { stopTimer(); if (state.phase === "ask") commit({ kind: "skip" }); }
      }, 100);
    } else {
      state.timerHandle = setInterval(function () {
        var l = state.globalDeadline - Date.now();
        if (l <= 0) { stopTimer(); el.qTimer.textContent = t("time.up"); finish(); return; }
        el.qTimer.textContent = Math.ceil(l / 1000) + "s";
      }, 200);
    }
  }

  /** 暂停计时（打开确认框时用）：保留剩余时间 */
  function pauseTimer() { stopTimer(); }

  /** 继续答题时恢复计时；全局倒计时是绝对时点，会照常走完 */
  function resumeTimer() {
    if (state.phase !== "ask") return;
    if (settings.timer === "perQuestion") startTimer(Math.max(3000, state.timerLeft || 20000));
    else if (settings.timer === "global") startTimer(0);
  }

  function tickTimer(left) {
    el.qTimer.textContent = Math.max(0, Math.ceil(left / 1000)) + "s";
    el.qTimer.classList.toggle("tp-timer-low", left <= 6000);
  }

  function stopTimer() {
    if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
    el.qTimer.hidden = true;
  }

  function checkGlobalTimeout() {
    if (state.globalDeadline && Date.now() >= state.globalDeadline) toast(t("time.up"));
  }

  // ── 结算 ─────────────────────────────────────────────────────

  function finish() {
    stopTimer();
    showScreen("summary");
    var s = state.session;
    var elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
    var cells = [
      ["summary.score", s.score],
      ["summary.correct", s.correctCount],
      ["summary.total", s.answeredCount],
      ["summary.accuracy", (s.answeredCount ? Math.round(s.accuracy() * 100) : 0) + "%"],
      ["summary.bestCombo", s.bestCombo],
      ["summary.time", formatDuration(elapsed)]
    ];
    U.clear(el.summaryBody);
    cells.forEach(function (c) {
      el.summaryBody.appendChild(U.el("div", { class: "tp-summary-cell" }, [
        U.el("em", { text: t(c[0]) }), U.el("b", { text: String(c[1]) })
      ]));
    });
    sfx("finish");
  }

  // ── 语音 ─────────────────────────────────────────────────────

  function speakQuestion(q) {
    var parts = [];
    if (q.known === "location") parts.push(t("question.knownLocation"));
    else parts.push(t("dim." + q.known) + ": " + boardValue(q.region, q.known));
    parts.push(q.asked === "location"
      ? t("question.askLocation")
      : t("question.prompt", { asked: t("dim." + q.asked) }));
    T.voice.speak(parts.join("。"), settings.locale);
  }

  // ── 设置面板 ─────────────────────────────────────────────────

  function buildSettings() {
    U.clear(el.settingsBody);

    function group(titleKey, options, current, onPick) {
      var g = U.el("div", { class: "tp-set-group" });
      g.appendChild(U.el("h3", { text: t(titleKey) }));
      var row = U.el("div", { class: "tp-chips" });
      options.forEach(function (o) {
        var label = U.el("label", { class: "tp-chip" + (current === o.value ? " tp-chip-on" : "") });
        var input = U.el("input", { type: "radio", name: "set-" + titleKey, value: o.value });
        input.checked = current === o.value;
        input.addEventListener("change", function () { onPick(o.value); });
        label.appendChild(input);
        label.appendChild(U.el("span", { text: o.label }));
        row.appendChild(label);
      });
      g.appendChild(row);
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

    el.settingsBody.appendChild(group("settings.styleDefault", [
      { value: "text", label: t("style.text") },
      { value: "choice3", label: t("style.choice3") },
      { value: "choice4", label: t("style.choice4") },
      { value: "choice5", label: t("style.choice5") }
    ], settings.style === "locate" ? "text" : settings.style, function (v) {
      settings.style = v; persist(); buildSettings(); buildHome();
    }));

    el.settingsBody.appendChild(group("settings.judge", [
      { value: "lenient", label: t("settings.judge.lenient") },
      { value: "strict", label: t("settings.judge.strict") }
    ], settings.judge, function (v) { settings.judge = v; persist(); buildSettings(); }));

    el.settingsBody.appendChild(group("settings.timer", [
      { value: "off", label: t("settings.timer.off") },
      { value: "global", label: t("settings.timer.global") },
      { value: "perQuestion", label: t("settings.timer.perQuestion") }
    ], settings.timer, function (v) { settings.timer = v; persist(); buildSettings(); }));

    var toggles = U.el("div", { class: "tp-set-group" });
    toggles.appendChild(U.el("h3", { text: t("settings.helpers") }));
    toggles.appendChild(toggle("settings.smartInput", settings.smartInput, function (v) { settings.smartInput = v; persist(); }));
    toggles.appendChild(toggle("settings.hintFirst", settings.hintFirstChar, function (v) { settings.hintFirstChar = v; persist(); }));
    toggles.appendChild(toggle("settings.hintCapital", settings.hintCapital, function (v) {
      settings.hintCapital = v; persist();
      if (state.mapView) state.mapView.setShowCapitals(v);
    }));
    toggles.appendChild(toggle("settings.hintGroup", settings.hintGroup, function (v) { settings.hintGroup = v; persist(); }));
    toggles.appendChild(toggle("settings.terrain", settings.showTerrainLabels, function (v) {
      settings.showTerrainLabels = v; persist();
      if (state.mapView) state.mapView.setTerrainLabels(v);
    }));
    toggles.appendChild(toggle("settings.legend", settings.showLegend, function (v) {
      settings.showLegend = v; persist(); buildLegend();
    }));
    toggles.appendChild(toggle("settings.sound", settings.sound, function (v) { settings.sound = v; persist(); if (v) sfx("pick"); }));
    toggles.appendChild(toggle("settings.motion", settings.motion, function (v) {
      settings.motion = v; persist(); document.documentElement.classList.toggle("tp-reduce-motion", !v);
    }));
    toggles.appendChild(toggle("settings.voice.on", settings.voiceAuto, function (v) { settings.voiceAuto = v; persist(); }));
    el.settingsBody.appendChild(toggles);

    el.settingsBody.appendChild(group("settings.wikiMode", [
      { value: "bilingual", label: t("settings.wikiMode.bilingual") },
      { value: "follow", label: t("settings.wikiMode.follow") },
      { value: "other", label: t("settings.wikiMode.other") }
    ], settings.wikiMode, function (v) { settings.wikiMode = v; persist(); buildSettings(); }));

    var langs = U.el("div", { class: "tp-set-group" });
    langs.appendChild(U.el("h3", { text: t("settings.language") }));
    var lrow = U.el("div", { class: "tp-chips" });
    T.i18n.available().forEach(function (l) {
      var label = U.el("label", { class: "tp-chip" + (settings.locale === l ? " tp-chip-on" : "") });
      var input = U.el("input", { type: "radio", name: "set-lang", value: l });
      input.checked = settings.locale === l;
      input.addEventListener("change", function () { setLocale(l); });
      label.appendChild(input);
      label.appendChild(U.el("span", { text: T.i18n.localeLabel(l) }));
      lrow.appendChild(label);
    });
    langs.appendChild(lrow);
    el.settingsBody.appendChild(langs);
  }

  function setLocale(l) {
    settings.locale = l;
    persist();
    T.i18n.setLocale(l);
  }

  function refreshForLocale() {
    applyI18n();
    buildLangSelect();
    buildHome();
    buildSettings();
    buildLegend();
    if (state.mapView) state.mapView.setLocale(settings.locale);
    if (state.question && state.phase === "ask") {
      renderCurrent(state.question);
      applyHints(state.question);
    }
    if (state.session) renderPrevCard(state.lastResult);
  }

  function buildLangSelect() {
    U.clear(el.langSelect);
    T.i18n.available().forEach(function (l) {
      var o = document.createElement("option");
      o.value = l; o.textContent = T.i18n.localeLabel(l);
      if (l === settings.locale) o.selected = true;
      el.langSelect.appendChild(o);
    });
  }

  // ── 启动 ─────────────────────────────────────────────────────

  function cacheEls() {
    ["screenHome", "screenPlay", "screenSummary", "mapHost", "mapLegend",
      "qCounter", "qTimer", "comboBadge", "progressFill", "hudScore", "hudAcc",
      "prevCard", "knownChip", "askText", "hintBar", "answerArea",
      "btnZoomIn", "btnZoomOut", "btnZoomReset", "btnStart", "btnBrand",
      "knownChips", "askedChips", "styleChips", "scopeChips", "configSummary",
      "homeRegionCount", "langSelect", "btnSettings", "btnSettingsClose", "settingsOverlay",
      "settingsBody", "btnRestart", "btnHome", "btnQuit", "toast", "summaryBody",
      "confirmOverlay", "confirmBody", "btnConfirmStay", "btnConfirmLeave"
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function bind() {
    el.langSelect.addEventListener("change", function () { setLocale(el.langSelect.value); });
    el.btnSettings.addEventListener("click", function () { buildSettings(); showOverlay(el.settingsOverlay); });
    el.btnSettingsClose.addEventListener("click", function () { hideOverlay(el.settingsOverlay); });
    el.btnStart.addEventListener("click", startGame);
    el.btnBrand.addEventListener("click", requestHome);
    el.btnQuit.addEventListener("click", requestHome);
    el.btnConfirmStay.addEventListener("click", function () { dismissConfirm(true); });
    el.btnConfirmLeave.addEventListener("click", function () { dismissConfirm(false); });
    el.btnZoomIn.addEventListener("click", function () { state.mapView && state.mapView.zoomIn(); });
    el.btnZoomOut.addEventListener("click", function () { state.mapView && state.mapView.zoomOut(); });
    el.btnZoomReset.addEventListener("click", function () { state.mapView && state.mapView.resetView(); });
    el.btnRestart.addEventListener("click", startGame);
    el.btnHome.addEventListener("click", function () { showScreen("home"); buildHome(); });

    document.addEventListener("keydown", function (e) {
      var overlayOpen = !el.settingsOverlay.hidden || !el.confirmOverlay.hidden;
      if (overlayOpen) {
        if (e.key === "Escape") {
          if (!el.confirmOverlay.hidden) { dismissConfirm(true); return; }
          hideOverlay(el.settingsOverlay);
        }
        return;
      }
      if (el.screenPlay.hidden || state.phase !== "ask") return;
      var q = state.question;
      if (q && q.choices && /^[1-5]$/.test(e.key)) {
        var idx = parseInt(e.key, 10) - 1;
        if (q.choices[idx]) { e.preventDefault(); commit({ kind: "choice", value: q.choices[idx] }); }
      }
    });
  }

  function showOverlay(node) {
    node.hidden = false;
    requestAnimationFrame(function () { node.classList.add("tp-overlay-show"); });
  }
  function hideOverlay(node) {
    node.classList.remove("tp-overlay-show");
    setTimeout(function () { node.hidden = true; }, 160);
  }

  function init() {
    state.country = T.countries.cn;
    if (!state.country) { document.body.innerHTML = "<p>data/cn.js missing</p>"; return; }

    cacheEls();
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
    showScreen("home");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
