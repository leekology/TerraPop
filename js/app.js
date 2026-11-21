// TerraPop · 界面装配与流程（一问一答 · 快速模式）
// ---------------------------------------------------------------
// 每道题只问一个维度，其余信息直接画在「信息板」上，不弹窗。
// 答完就地揭示 + 记住连击，然后自动进入下一题（可关）。
// 百科全文仍然保留，但改成可选的详情弹窗，不打断节奏。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;
  var t = function (k, v) { return T.i18n.t(k, v); };

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
    autoAdvance: true,
    autoDelay: 1600,
    wikiMode: "bilingual",
    hintFirstChar: false,
    hintCapital: false,
    hintGroup: false,
    showTerrainLabels: true,
    showLegend: true,
    smartInput: true,
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
    phase: "idle",            // idle | ask | reveal
    pending: "",
    pendingRegion: null,
    adjacency: null,
    centers: null,
    radius: null,
    lastResult: null,
    timerHandle: null,
    globalDeadline: 0,
    autoHandle: null,
    autoRaf: null,
    revealAt: 0
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

  function regionById(id) {
    return state.session && state.session.regionById[id];
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

  // ── 音效（WebAudio 合成，零素材）────────────────────────────

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
      // 连击越高，尾音越高，正反馈拉满
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

  // ── 通用 chip 组 ─────────────────────────────────────────────

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

  function dimLabel(dim) {
    return t("dim." + dim) + (dim === "location" ? "" : "");
  }

  // ── 首页 ─────────────────────────────────────────────────────

  function buildHome() {
    var dimItems = ["full", "short", "capital", "location"].map(function (d) {
      return { value: d, label: t("dim." + d) };
    }).concat([{ value: "random", label: t("config.random") }]);

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

  function firstOther(dim) {
    return ["full", "short", "capital", "location"].filter(function (d) { return d !== dim; })[0];
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
        if (kinds[k]) items.push({ k: k, cls: "tp-lg-" + k, label: t("legend." + k) });
      });
      if ((terrain.ranges || []).length) items.push({ k: "range", cls: "tp-lg-range", label: t("legend.range") });
      if ((terrain.rivers || []).length) items.push({ k: "river", cls: "tp-lg-river", label: t("legend.river") });
      if ((terrain.lakes || []).length) items.push({ k: "lake", cls: "tp-lg-lake", label: t("legend.lake") });
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

  // ── 开始一局 ─────────────────────────────────────────────────

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

    el.scoreBar.hidden = false;
    el.mapLegend.hidden = !settings.showLegend;
    state.globalDeadline = settings.timer === "global" ? Date.now() + 60000 : 0;

    showScreen("play");
    updateHud();
    nextQuestion();
  }

  function showScreen(name) {
    el.screenHome.hidden = name !== "home";
    el.screenPlay.hidden = name !== "play";
    el.screenSummary.hidden = name !== "summary";
    if (name !== "play") el.scoreBar.hidden = true;
    if (name === "home") { el.mapLegend.hidden = true; }
  }

  function quitToHome() {
    stopAll();
    T.voice.stop();
    state.session = null;
    state.phase = "idle";
    hideOverlay(el.wikiOverlay);
    if (state.mapView) { state.mapView.setLocked(true); state.mapView.clearMarks(); state.mapView.setShowCapitals(false); }
    showScreen("home");
    buildHome();
  }

  function updateHud() {
    var s = state.session;
    if (!s) return;
    el.hudCombo.textContent = String(s.combo);
    el.comboChip.classList.toggle("tp-stat-hot", s.combo >= 3);
    el.hudScore.textContent = String(s.score);
    el.hudAcc.textContent = s.answeredCount ? Math.round(s.accuracy() * 100) + "%" : "—";
    el.comboBadge.hidden = s.combo < 2;
    el.comboBadge.textContent = t("hud.comboBadge", { n: s.combo });
  }

  // ── 出题 ─────────────────────────────────────────────────────

  function nextQuestion() {
    stopAll();
    var q = state.session.next();
    if (!q) { finish(); return; }

    state.question = q;
    state.phase = "ask";
    state.pending = "";
    state.pendingRegion = null;
    state.lastResult = null;

    el.revealInline.hidden = true;
    el.revealMemo.textContent = "";
    el.autoFill.style.width = "0%";
    el.askCard.hidden = false;

    el.qCounter.textContent = t("question.counter", { n: q.index + 1 }) + " / " + state.session.total;
    el.qProgress.textContent = "";
    el.progressFill.style.width = (q.index / state.session.total * 100) + "%";

    // 题面
    el.askText.textContent = t("question.prompt", {
      known: q.known === "location" ? t("dim.location") : t("dim." + q.known),
      asked: t("dim." + q.asked)
    });

    state.mapView.clearMarks();
    state.mapView.setShowCapitals(settings.hintCapital && q.asked !== "location");
    state.mapView.setLocked(q.asked !== "location");
    if (q.known === "location") state.mapView.highlight(q.region.id, "given");

    renderBoard();
    applyHints();

    if (settings.timer === "perQuestion") startTimer(20000);
    else if (settings.timer === "global") startTimer(0);

    if (settings.voiceAuto) speakQuestion(q);

    var input = el.infoBoard.querySelector(".tp-answer-input");
    if (input) setTimeout(function () { try { input.focus(); } catch (e) {} }, 20);
  }

  // ── 信息板 ───────────────────────────────────────────────────

  function boardValue(region, dim) {
    if (dim === "short") return T.game.shortDisplay(region, settings.locale);
    return T.game.displayFor(region, dim, settings.locale);
  }

  function renderBoard(result) {
    var q = state.question;
    var region = q.region;
    U.clear(el.infoBoard);

    ["full", "short", "capital", "location"].forEach(function (dim) {
      var row = U.el("div", { class: "tp-row", dataset: { dim: dim } });
      var isKnown = q.known === dim;
      var isAsked = q.asked === dim;
      var shown = !!result || isKnown;

      if (isKnown) row.classList.add("tp-row-known");
      if (isAsked) row.classList.add("tp-row-asked");

      row.appendChild(U.el("span", { class: "tp-row-key", text: t("dim." + dim) }));

      var val = U.el("span", { class: "tp-row-val" });

      if (isKnown) {
        if (dim === "location") {
          val.appendChild(U.el("em", { class: "tp-pill tp-pill-given", text: t("question.knownLocation") }));
        } else {
          val.appendChild(U.el("b", { text: boardValue(region, dim) }));
          if (dim === "capital") val.appendChild(U.el("small", { text: T.game.termOf(region) }));
        }
      } else if (isAsked && !result) {
        renderAskControl(region, dim, val);
      } else if (result) {
        var ok = result.status === "correct";
        var close = result.status === "close";
        val.appendChild(U.el("i", {
          class: "tp-mark-icon " + (ok ? "tp-ok" : close ? "tp-close-icon" : "tp-bad"),
          text: ok ? "✓" : close ? "≈" : "✗"
        }));
        val.appendChild(U.el("b", { text: boardValue(region, dim) }));
        if (isAsked && result.given && !ok) {
          val.appendChild(U.el("s", { class: "tp-given-wrong", text: result.given }));
        }
        if (dim === "capital" && region.capitalTerm !== "none") {
          val.appendChild(U.el("small", { text: T.game.termOf(region) }));
        }
      } else {
        val.appendChild(U.el("span", { class: "tp-hidden", text: t("board.hidden") }));
      }

      row.appendChild(val);
      if (shown && result && isAsked) row.classList.add("tp-row-" + result.status);
      el.infoBoard.appendChild(row);
    });
  }

  function renderAskControl(region, dim, host) {
    var q = state.question;
    if (dim === "location") {
      host.appendChild(U.el("em", { class: "tp-pill tp-pill-ask", text: t("question.askLocation") }));
      return;
    }

    if (q.style === "text") {
      var wrap = U.el("div", { class: "tp-answer-inputwrap" });
      var input = U.el("input", {
        class: "tp-answer-input", type: "text", autocomplete: "off",
        autocapitalize: "off", spellcheck: "false",
        placeholder: settings.smartInput ? t("input.smartPlaceholder") : t("input.placeholder")
      });
      input.addEventListener("input", onInput);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();   // 别再冒泡给"下一题"的全局快捷键
          commitText(true);
        }
      });
      var ok = U.el("button", { class: "tp-btn tp-btn-primary tp-btn-sm", text: t("action.submit") });
      ok.addEventListener("click", function () { commitText(true); });
      var skip = U.el("button", { class: "tp-btn tp-btn-ghost tp-btn-sm", text: t("action.skip") });
      skip.addEventListener("click", function () { commit({ kind: "skip" }); });
      wrap.appendChild(input);
      wrap.appendChild(ok);
      wrap.appendChild(skip);
      host.appendChild(wrap);
      host.appendChild(U.el("div", { class: "tp-suggest", id: "suggest" }));
      host.appendChild(U.el("small", { class: "tp-smart-hint", text: settings.smartInput ? t("input.smartHint") : "" }));
      return;
    }

    // 选择题
    var grid = U.el("div", { class: "tp-choices tp-choices-" + q.choices.length });
    q.choices.forEach(function (label, i) {
      var b = U.el("button", { class: "tp-choice", type: "button" }, [
        U.el("span", { class: "tp-choice-key", text: String(i + 1) }),
        U.el("span", { class: "tp-choice-text", text: label })
      ]);
      b.addEventListener("click", function () { commit({ kind: "choice", value: label }); });
      grid.appendChild(b);
    });
    var wrap2 = U.el("div", { class: "tp-choice-wrap" });
    wrap2.appendChild(grid);
    var skip2 = U.el("button", { class: "tp-btn tp-btn-ghost tp-btn-sm tp-skip-inline", text: t("action.skip") });
    skip2.addEventListener("click", function () { commit({ kind: "skip" }); });
    wrap2.appendChild(skip2);
    host.appendChild(wrap2);
  }

  // 让题目卡里的提示条也占位置
  function applyHints() {
    var q = state.question;
    var hints = [];
    if (settings.hintFirstChar) {
      var v = boardValue(q.region, q.asked);
      if (q.asked !== "location") hints.push(t("question.hintFirst", { v: U.firstChar(v) }));
    }
    if (settings.hintGroup && q.asked === "location") hints.push("🧭 " + t("group." + q.region.group));
    if (settings.hintCapital && q.asked !== "location" && q.region.capital) {
      hints.push(t("question.hintCapitalMarker", { term: T.game.termOf(q.region) }));
    }
    el.askCard.dataset.hints = hints.join("|");
    var existing = el.askCard.querySelector(".tp-hint-row");
    if (existing) existing.remove();
    if (!hints.length) return;
    var row = U.el("div", { class: "tp-hint-row" });
    hints.forEach(function (h) { row.appendChild(U.el("span", { class: "tp-hint-pill", text: h })); });
    el.askCard.appendChild(row);
  }

  // ── 智能输入 ─────────────────────────────────────────────────

  function onInput(e) {
    var q = state.question;
    state.pending = e.target.value;
    var box = el.infoBoard.querySelector("#suggest");
    if (!box) return;
    U.clear(box);

    if (!state.pending.trim()) { e.target.classList.remove("tp-input-bad"); return; }

    if (!settings.smartInput) return;

    var m = T.game.matchInput(state.session.pool, q.asked, settings.locale, state.pending);
    if (m.unique) {
      e.target.classList.remove("tp-input-bad");
      commitText(false);
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

  function commitText(fromButton) {
    var value = el.infoBoard.querySelector(".tp-answer-input");
    value = value ? value.value : "";
    if (!value.trim() && !fromButton) return;
    commit({ kind: "text", value: value });
  }

  // ── 位置点选 ─────────────────────────────────────────────────

  function onMapPick(regionId) {
    if (state.phase !== "ask") return;
    var q = state.question;
    if (!q || q.asked !== "location") return;
    state.pendingRegion = regionId;
    sfx("pick");
    commit({ kind: "locate", regionId: regionId });
  }

  // ── 提交 ─────────────────────────────────────────────────────

  function commit(answer) {
    if (state.phase !== "ask") return;
    var q = state.question;
    if (settings.timer === "global") checkGlobalTimeout();

    state.phase = "reveal";
    stopTimer();
    state.mapView.setLocked(true);

    var result = state.session.submit(answer);
    state.lastResult = result;

    if (result.correct) sfx("correct", result.combo);
    else if (result.close) sfx("close");
    else sfx("wrong");

    if (q.asked === "location") {
      // 点错时把点到的位置也标出来，方便对照
      if (!result.correct) {
        state.mapView.highlight(result.region.id, "given");
        state.mapView.reveal(result.region, result.correct ? "correct" : "wrong");
      } else {
        state.mapView.reveal(result.region, "correct");
      }
    } else {
      state.mapView.reveal(result.region, result.correct ? "correct" : result.close ? "close" : "wrong");
    }

    renderBoard(result);
    updateHud();
    showRevealInline(result);
    el.progressFill.style.width = ((q.index + 1) / state.session.total * 100) + "%";

    if (settings.autoAdvance) startAutoAdvance();
    state.revealAt = (global.performance || Date).now();
  }

  function showRevealInline(result) {
    var region = result.region;
    var v = wikiOf(region.id);
    var memo = v ? localePick(v.memo, settings.locale) : "";
    el.revealMemo.textContent = memo || "";
    el.revealMemo.hidden = !memo;
    el.revealInline.hidden = false;
    el.revealInline.classList.toggle("tp-reveal-ok", result.correct);
    el.revealInline.classList.toggle("tp-reveal-bad", !result.correct && !result.close);
    el.btnDetail.hidden = false;
    el.btnNext.textContent = state.session.remaining() > 0 ? t("action.next") : t("action.seeResult");
  }

  // ── 自动下一题 ───────────────────────────────────────────────

  function startAutoAdvance() {
    stopAutoAdvance();
    var total = settings.autoDelay;
    var started = performance.now();
    state.autoRaf = requestAnimationFrame(function step(now) {
      if (state.phase !== "reveal") return;
      var p = Math.min(1, (now - started) / total);
      el.autoFill.style.width = (p * 100) + "%";
      if (p >= 1) { state.autoRaf = null; nextQuestion(); return; }
      state.autoRaf = requestAnimationFrame(step);
    });
  }

  function stopAutoAdvance() {
    if (state.autoRaf) { cancelAnimationFrame(state.autoRaf); state.autoRaf = null; }
    el.autoFill.style.width = "0%";
  }

  function advanceNow() {
    if (state.phase !== "reveal") return;
    stopAutoAdvance();
    nextQuestion();
  }

  // ── 计时 ─────────────────────────────────────────────────────

  function startTimer(ms) {
    stopTimer();
    el.qTimer.hidden = false;
    if (ms > 0) {
      var left = ms;
      tickTimer(left);
      state.timerHandle = setInterval(function () {
        left -= 100;
        tickTimer(left);
        if (left <= 0) { stopTimer(); if (state.phase === "ask") commit({ kind: "skip" }); }
      }, 100);
    } else {
      state.timerHandle = setInterval(function () {
        var l = state.globalDeadline - Date.now();
        if (l <= 0) { stopTimer(); el.qTimer.textContent = t("time.up"); finish(); return; }
        el.qTimer.textContent = Math.ceil(l / 1000) + "s";
      }, 200);
    }
  }

  function tickTimer(left) {
    el.qTimer.textContent = Math.max(0, Math.ceil(left / 1000)) + "s";
    el.qTimer.classList.toggle("tp-timer-low", left <= 6000);
  }

  function stopTimer() {
    if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
    el.qTimer.hidden = true;
  }

  function stopAll() { stopTimer(); stopAutoAdvance(); }

  function checkGlobalTimeout() {
    if (state.globalDeadline && Date.now() >= state.globalDeadline) toast(t("time.up"));
  }

  // ── 结算 ─────────────────────────────────────────────────────

  function finish() {
    stopAll();
    showScreen("summary");
    var s = state.session;
    var cells = [
      ["summary.score", s.score],
      ["summary.correct", s.correctCount],
      ["summary.total", s.answeredCount],
      ["summary.accuracy", (s.answeredCount ? Math.round(s.accuracy() * 100) : 0) + "%"],
      ["summary.bestCombo", s.bestCombo]
    ];
    U.clear(el.summaryBody);
    cells.forEach(function (c) {
      el.summaryBody.appendChild(U.el("div", { class: "tp-summary-cell" }, [
        U.el("em", { text: t(c[0]) }), U.el("b", { text: String(c[1]) })
      ]));
    });
    sfx("finish");
    if (state.mapView) state.mapView.clearMarks();
  }

  // ── 百科详情 ─────────────────────────────────────────────────

  function openWiki() {
    var result = state.lastResult;
    if (!result) return;
    stopAutoAdvance();
    var region = result.region;
    var v = wikiOf(region.id);

    el.wikiBadge.className = "tp-verdict tp-verdict-" + (result.correct ? "correct" : result.close ? "close" : "wrong");
    el.wikiBadge.textContent = result.correct ? t("feedback.correct") : result.close ? t("feedback.close") : t("feedback.wrong");
    el.wikiTitle.textContent = localePick(region.fullNames, settings.locale);

    U.clear(el.wikiBody);
    var info = U.el("div", { class: "tp-reveal-info" });
    ["full", "short", "capital", "location"].forEach(function (dim) {
      var card = U.el("div", { class: "tp-info-card" + (dim === state.question.asked ? " tp-info-asked" : "") });
      card.appendChild(U.el("em", { text: t("dim." + dim) }));
      card.appendChild(U.el("b", { text: boardValue(region, dim) }));
      if (dim === "capital" && region.capitalTerm !== "none") {
        card.appendChild(U.el("span", { class: "tp-info-sub", text: T.game.termOf(region) }));
      }
      if (dim === "short") {
        card.appendChild(U.el("span", { class: "tp-info-sub", text: (region.short || []).map(function (s) { return s.pinyin; }).join(" / ") }));
      }
      if (dim === "capital" && region.capitalTerm === "none") {
        card.appendChild(U.el("span", { class: "tp-info-sub", text: localePick(region.capitalNote, settings.locale) }));
      }
      info.appendChild(card);
    });
    info.appendChild(U.el("div", { class: "tp-info-card tp-info-meta" }, [
      U.el("em", { text: t("type." + region.type) }), U.el("b", { text: t("group." + region.group) })
    ]));
    el.wikiBody.appendChild(info);

    if (v) el.wikiBody.appendChild(buildWikiBlock(v));
    else el.wikiBody.appendChild(U.el("p", { class: "tp-wiki-missing", text: t("reveal.wikiMissing") }));

    showOverlay(el.wikiOverlay);
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
      block.appendChild(U.el("h3", { text: title }));
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

  // ── 覆盖层 ───────────────────────────────────────────────────

  function showOverlay(node) {
    node.hidden = false;
    requestAnimationFrame(function () { node.classList.add("tp-overlay-show"); });
  }
  function hideOverlay(node) {
    node.classList.remove("tp-overlay-show");
    setTimeout(function () { node.hidden = true; }, 160);
  }

  // ── 语音 ─────────────────────────────────────────────────────

  function speakQuestion(q) {
    var parts = [];
    parts.push(t("question.prompt", {
      known: q.known === "location" ? t("dim.location") : t("dim." + q.known),
      asked: t("dim." + q.asked)
    }));
    if (q.known !== "location") parts.push(boardValue(q.region, q.known));
    T.voice.speak(parts.join("。"), settings.locale);
  }

  function speakReveal() {
    var r = state.lastResult;
    if (!r) return;
    var region = r.region;
    var parts = [localePick(region.fullNames, settings.locale)];
    parts.push(t("dim.short") + ": " + (region.short || []).map(function (s) { return s.char; }).join("、"));
    if (region.capitalTerm !== "none" && region.capital) {
      parts.push(T.game.termOf(region) + ": " + localePick(region.capital, settings.locale));
    }
    var v = wikiOf(region.id);
    if (v && v.memo) {
      var langs = settings.wikiMode === "bilingual"
        ? [settings.locale, T.i18n.otherLocale(settings.locale)]
        : settings.wikiMode === "other" ? [T.i18n.otherLocale(settings.locale)] : [settings.locale];
      langs.forEach(function (l) { if (v.memo[l]) parts.push(v.memo[l]); });
    }
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

    el.settingsBody.appendChild(group("settings.autoDelay", [
      { value: "1000", label: t("settings.delay.fast") },
      { value: "1600", label: t("settings.delay.normal") },
      { value: "2600", label: t("settings.delay.slow") }
    ], String(settings.autoDelay), function (v) { settings.autoDelay = parseInt(v, 10); persist(); buildSettings(); }));

    var toggles = U.el("div", { class: "tp-set-group" });
    toggles.appendChild(U.el("h3", { text: t("settings.helpers") }));
    toggles.appendChild(toggle("settings.smartInput", settings.smartInput, function (v) { settings.smartInput = v; persist(); }));
    toggles.appendChild(toggle("settings.autoAdvance", settings.autoAdvance, function (v) { settings.autoAdvance = v; persist(); }));
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
    if (state.phase === "ask" && state.question) {
      renderBoard();
      applyHints();
      el.askText.textContent = t("question.prompt", {
        known: state.question.known === "location" ? t("dim.location") : t("dim." + state.question.known),
        asked: t("dim." + state.question.asked)
      });
    } else if (state.phase === "reveal" && state.lastResult) {
      renderBoard(state.lastResult);
      showRevealInline(state.lastResult);
    }
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
      "qCounter", "qProgress", "qTimer", "comboBadge", "progressFill",
      "askCard", "askText", "infoBoard", "revealInline", "revealMemo", "autoFill",
      "btnDetail", "btnNext", "btnZoomIn", "btnZoomOut", "btnZoomReset", "btnStart",
      "knownChips", "askedChips", "styleChips", "scopeChips", "configSummary",
      "homeRegionCount", "langSelect", "btnSettings", "btnSettingsClose", "settingsOverlay",
      "settingsBody", "wikiOverlay", "wikiBody", "wikiBadge", "wikiTitle", "btnWikiClose",
      "btnWikiSpeak", "btnRestart", "btnHome", "btnQuit", "scoreBar", "hudCombo", "hudAcc",
      "hudScore", "comboChip", "toast", "summaryBody"
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function bind() {
    el.langSelect.addEventListener("change", function () { setLocale(el.langSelect.value); });
    el.btnSettings.addEventListener("click", function () {
      buildSettings(); showOverlay(el.settingsOverlay);
    });
    el.btnSettingsClose.addEventListener("click", function () { hideOverlay(el.settingsOverlay); });
    el.btnWikiClose.addEventListener("click", function () { hideOverlay(el.wikiOverlay); });
    el.btnWikiSpeak.addEventListener("click", speakReveal);
    el.btnStart.addEventListener("click", startGame);
    el.btnQuit.addEventListener("click", quitToHome);
    el.btnNext.addEventListener("click", advanceNow);
    el.btnDetail.addEventListener("click", openWiki);
    el.btnZoomIn.addEventListener("click", function () { state.mapView && state.mapView.zoomIn(); });
    el.btnZoomOut.addEventListener("click", function () { state.mapView && state.mapView.zoomOut(); });
    el.btnZoomReset.addEventListener("click", function () { state.mapView && state.mapView.resetView(); });
    el.btnRestart.addEventListener("click", startGame);
    el.btnHome.addEventListener("click", function () { showScreen("home"); buildHome(); });

    document.addEventListener("keydown", function (e) {
      if (!el.settingsOverlay.hidden || !el.wikiOverlay.hidden) {
        if (e.key === "Escape") { hideOverlay(el.settingsOverlay); hideOverlay(el.wikiOverlay); }
        return;
      }
      if (el.screenPlay.hidden) return;

      if (state.phase === "reveal") {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          // 刚用回车/空格提交完的那一下不要立刻被当成"下一题"
          var now = (global.performance || Date).now();
          if (state.revealAt && now - state.revealAt < 350) return;
          advanceNow();
        }
        return;
      }
      if (state.phase !== "ask") return;
      var q = state.question;
      if (q && q.choices && /^[1-5]$/.test(e.key)) {
        var idx = parseInt(e.key, 10) - 1;
        if (q.choices[idx]) { e.preventDefault(); commit({ kind: "choice", value: q.choices[idx] }); }
      }
    });
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
