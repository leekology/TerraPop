// TerraPop · 界面装配与流程（问答分离 · 位置固定 · 零阻断）
// ---------------------------------------------------------------
// 版面从上到下固定为：
//   头部（题号 / 计时 / 连击 / 得分 / 正确率）+ 进度条
//   上一题卡片（固定高度、内部滚动）：上一题的四维信息 + 记忆点 + 双语百科
//     —— 第一题时这里显示玩法说明
//   当前题（固定位置）：已知信息 → 题面 → 作答区（固定高度的控件区）
//
// 四种模式只影响「出题顺序 / 结束条件」，不影响版面：
//   random    随机一轮：范围内的省份随机排一轮，答完即结束
//   adjacency 邻接漫游：按地图接壤一路挨着出题
//   timed     1 分钟极速：60 秒内答得越多越好，时间到就结算
//   perfect   全答对为止：答错的题排到队尾，全部答对才结束
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;
  var t = function (k, v) { return T.i18n.t(k, v); };
  var DIMS = ["full", "short", "capital", "location"];
  var TYPES = ["province", "autonomous", "municipality", "sar"];
  var PLAY_MODES = ["random", "adjacency", "timed", "perfect"];

  var TIMED_MS = 60000;

  // 上一题的地图画面多留一会儿：下一题如果也要看图，就少留一点
  var MAP_BEAT_IDLE = 1900;
  var MAP_BEAT_NEEDED = 900;

  // ── 设置 ─────────────────────────────────────────────────────

  var DEFAULTS = {
    locale: "zh-Hans",
    playMode: "random",
    known: "location",
    asked: "full",
    style: "text",
    scopeGroups: null,          // null → 全部大区（见 pickScope）
    scopeTypes: null,
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
  settings.scopeGroups = Array.isArray(settings.scopeGroups) ? settings.scopeGroups.slice() : T.groups.slice();
  settings.scopeTypes = Array.isArray(settings.scopeTypes) ? settings.scopeTypes.slice() : TYPES.slice();
  if (PLAY_MODES.indexOf(settings.playMode) === -1) settings.playMode = "random";
  function persist() { U.saveSettings(settings); }

  var state = {
    country: null,
    mapData: null,
    mapView: null,
    session: null,
    question: null,
    phase: "idle",          // idle | ask | locked
    pending: "",
    suggestions: [],
    suggestIndex: -1,
    adjacency: null,
    centers: null,
    radius: null,
    lastResult: null,
    timerHandle: null,
    globalDeadline: 0,
    timedMode: false,
    mapGen: 0,
    mapFocusedId: null,
    beatPending: false,
    startedAt: 0,
    timerLeft: 0,
    holdHintShown: false
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
    if (dim === "short") return T.game.shortText(region);
    return T.game.displayFor(region, dim, settings.locale);
  }

  /** 简称的带调拼音，如 冀→jì、川/蜀→chuān / shǔ */
  function shortPinyin(region) {
    return (region.short || []).map(function (s) { return s.pinyin; }).filter(Boolean).join(" / ");
  }

  /**
   * 汉字内容显式标上 lang="zh-Hans"。
   * 界面语言是英文时 <html lang> 会变成 en，这时候汉字就得靠自己声明语言，
   * 浏览器才会挑中文字体而不是日文字形。
   */
  function markLang(node, text) {
    if (U.hasHan(text)) node.setAttribute("lang", "zh-Hans");
    return node;
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

  // ── 范围：大区 × 类型 自由组合 ───────────────────────────────

  function scopeRegionIds() {
    var g = settings.scopeGroups, ty = settings.scopeTypes;
    if (g.length === T.groups.length && ty.length === TYPES.length) return null;   // 全选
    return state.country.regions.filter(function (r) {
      return g.indexOf(r.group) !== -1 && ty.indexOf(r.type) !== -1;
    }).map(function (r) { return r.id; });
  }

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

  // ── 紧凑（手机）模式 ─────────────────────────────────────────
  var COMPACT_MQ = "(max-width: 860px), (max-height: 560px)";
  function isCompact() {
    return !!(global.matchMedia && global.matchMedia(COMPACT_MQ).matches);
  }

  /**
   * 手机上的实际可视高度要跟着输入法走：软键盘弹起时 visualViewport 会变矮，
   * 把 --vvh 写进 CSS，地图（flex:1）就会自己缩，答题区不会被键盘盖住。
   */
  // ── 首次进入的三步引导（只在紧凑屏出现）────────────────────
  var ONBOARD_KEY = "terrapop.onboarded.v1";
  var ONBOARD_STEPS = ["1", "2", "3"];
  var onboardStep = 0;

  function onboardSeen() {
    try { return global.localStorage && global.localStorage.getItem(ONBOARD_KEY) === "1"; }
    catch (e) { return false; }
  }
  function markOnboarded() {
    try { if (global.localStorage) global.localStorage.setItem(ONBOARD_KEY, "1"); } catch (e) {}
  }
  function renderOnboard() {
    var step = ONBOARD_STEPS[onboardStep];
    U.clear(el.onboardBody);
    el.onboardBody.appendChild(U.el("div", { class: "tp-onboard-icon", text: t("onboard.step" + step + ".icon") }));
    el.onboardBody.appendChild(U.el("h2", { id: "onboardTitle", text: t("onboard.step" + step + ".title") }));
    el.onboardBody.appendChild(U.el("p", { text: t("onboard.step" + step + ".body") }));

    U.clear(el.onboardDots);
    ONBOARD_STEPS.forEach(function (_, i) {
      el.onboardDots.appendChild(U.el("i", { class: i === onboardStep ? "on" : "" }));
    });
    el.btnOnboardNext.textContent = onboardStep === ONBOARD_STEPS.length - 1
      ? t("onboard.start") : t("onboard.next");
    el.btnOnboardSkip.textContent = t("onboard.skip");
  }
  function showOnboard() {
    onboardStep = 0;
    renderOnboard();
    showOverlay(el.onboard);
  }
  function closeOnboard() {
    markOnboarded();
    hideOverlay(el.onboard);
  }

  function trackViewportHeight() {
    var vv = global.visualViewport;
    if (!vv) return;
    var apply = function () {
      document.documentElement.style.setProperty("--vvh", Math.round(vv.height) + "px");
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
  }

  // ── chip 组 ──────────────────────────────────────────────────

  /** 单选 chip（radio 语义） */
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

  /** 多选 chip（checkbox 语义） */
  function buildToggleChips(host, items, selected, onToggle) {
    U.clear(host);
    items.forEach(function (it) {
      var on = selected.indexOf(it.value) !== -1;
      var label = U.el("label", {
        class: "tp-chip tp-chip-toggle" + (on ? " tp-chip-on" : ""),
        role: "checkbox", "aria-checked": on ? "true" : "false"
      });
      var input = U.el("input", { type: "checkbox", value: it.value });
      input.checked = on;
      input.addEventListener("change", function () { onToggle(it.value); });
      label.appendChild(input);
      label.appendChild(U.el("span", { text: it.label }));
      host.appendChild(label);
    });
  }

  function toggleInArray(arr, value) {
    var i = arr.indexOf(value);
    if (i === -1) arr.push(value); else arr.splice(i, 1);
    return arr;
  }

  // ── 首页 ─────────────────────────────────────────────────────

  function buildHome() {
    // 模式
    buildChips(el.modeChips, PLAY_MODES.map(function (m) {
      return { value: m, label: t("mode." + m) };
    }), settings.playMode, function (v) { settings.playMode = v; persist(); buildHome(); });
    el.modeDesc.textContent = t("mode." + settings.playMode + ".desc");

    // 已知 / 要猜 / 作答方式
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
      { value: "choice3", label: t("style.choice3") },
      { value: "choice4", label: t("style.choice4") },
      { value: "choice5", label: t("style.choice5") },
      { value: "locate", label: t("style.locate") }
    ], settings.asked === "location" ? "locate" : settings.style, function (v) {
      settings.style = v;
      if (v === "locate") settings.asked = "location";
      else if (settings.asked === "location") settings.asked = "capital";
      persist(); buildHome();
    });

    // 范围：大区多选 × 类型多选
    buildToggleChips(el.scopeGroupChips, T.groups.map(function (g) {
      return { value: g, label: t("group." + g) };
    }), settings.scopeGroups, function (v) {
      settings.scopeGroups = toggleInArray(settings.scopeGroups.slice(), v);
      persist(); buildHome();
    });
    buildToggleChips(el.scopeTypeChips, TYPES.map(function (ty) {
      return { value: ty, label: t("type." + ty) };
    }), settings.scopeTypes, function (v) {
      settings.scopeTypes = toggleInArray(settings.scopeTypes.slice(), v);
      persist(); buildHome();
    });

    U.clear(el.scopePresets);
    [
      { id: "all", label: t("scope.presetAll"), groups: T.groups.slice(), types: TYPES.slice() },
      { id: "province", label: t("scope.presetProvince"), groups: T.groups.slice(), types: ["province"] },
      { id: "noMuni", label: t("scope.presetNoMunicipality"), groups: T.groups.slice(), types: ["province", "autonomous"] }
    ].forEach(function (p) {
      var b = U.el("button", { type: "button", class: "tp-btn tp-btn-ghost tp-btn-sm", text: p.label });
      b.addEventListener("click", function () {
        settings.scopeGroups = p.groups.slice();
        settings.scopeTypes = p.types.slice();
        persist(); buildHome();
      });
      el.scopePresets.appendChild(b);
    });
    var allG = U.el("button", { type: "button", class: "tp-btn tp-btn-ghost tp-btn-sm", text: t("scope.selectAllGroups") });
    allG.addEventListener("click", function () { settings.scopeGroups = T.groups.slice(); persist(); buildHome(); });
    var noG = U.el("button", { type: "button", class: "tp-btn tp-btn-ghost tp-btn-sm", text: t("scope.clearGroups") });
    noG.addEventListener("click", function () { settings.scopeGroups = []; persist(); buildHome(); });
    el.scopePresets.appendChild(allG);
    el.scopePresets.appendChild(noG);

    // 覆盖数量
    var n = poolSize();
    el.homeRegionCount.textContent = n
      ? t("home.regionCount", { n: n })
      : t("scope.empty");
    el.homeRegionCount.classList.toggle("tp-config-warn", n === 0);

    var showTip = isCompact() && (settings.asked === "location" || settings.asked === "random") && n > 12;
    el.scopeTip.hidden = !showTip;
    if (showTip) {
      U.clear(el.scopeTip);
      el.scopeTip.appendChild(U.el("span", { class: "tp-tip-text", text: t("scope.mobileLocateTip") }));
      var tipRow = U.el("div", { class: "tp-tip-actions" });
      tipRow.appendChild(U.el("span", { class: "tp-tip-label", text: t("scope.oneTap") }));
      T.groups.forEach(function (g) {
        var b = U.el("button", { type: "button", class: "tp-hint-btn", text: t("group." + g) });
        b.addEventListener("click", function () {
          settings.scopeGroups = [g];
          persist();
          buildHome();
        });
        tipRow.appendChild(b);
      });
      el.scopeTip.appendChild(tipRow);
    }

    el.configSummary.textContent = t("config.summary", {
      known: settings.known === "random" ? t("config.random") : t("dim." + settings.known),
      asked: settings.asked === "random" ? t("config.random") : t("dim." + settings.asked),
      style: t("style." + (settings.asked === "location" ? "locate" : settings.style))
    });
    el.btnStart.disabled = n === 0;
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

    var order = settings.playMode === "adjacency" ? "adjacency"
      : settings.playMode === "timed" ? "endless"
        : settings.playMode === "perfect" ? "perfect" : "random";

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
      locale: settings.locale,
      order: order
    });
    if (!state.session.total) { toast(t("scope.empty")); return; }

    state.lastResult = null;
    state.beatPending = false;
    state.startedAt = Date.now();
    state.timedMode = settings.playMode === "timed";
    state.globalDeadline = state.timedMode ? Date.now() + TIMED_MS : 0;

    el.mapLegend.hidden = !settings.showLegend;
    showScreen("play");
    updateHud();
    renderPrevCard(null);           // 第一题：上方卡片显示玩法说明
    nextQuestion();

    // 手机上拖动地图需要先按住；新手引导里已经讲过，所以只在之后再提示一次
    if (isCompact() && !state.holdHintShown && onboardSeen()) {
      state.holdHintShown = true;
      setTimeout(function () { toast(t("map.holdToPan"), 2600); }, 500);
    }
  }

  function showScreen(name) {
    el.screenHome.hidden = name !== "home";
    el.screenPlay.hidden = name !== "play";
    el.screenSummary.hidden = name !== "summary";
    if (name === "home") el.mapLegend.hidden = true;
  }

  /** 本局是否正在进行（有题目还没答完，且正停在答题屏） */
  function inProgress() {
    var s = state.session;
    return !!(s && !s.finished && !el.screenPlay.hidden);
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

  /** 进度条：随机/邻接看题号，全答对看已答对数，极速看剩余时间 */
  function updateProgress() {
    var s = state.session;
    if (!s) return;
    var ratio;
    if (s.mode === "endless") {
      var left = Math.max(0, state.globalDeadline - Date.now());
      ratio = 1 - left / TIMED_MS;
    } else if (s.mode === "perfect") {
      ratio = s.total ? s.solvedCount / s.total : 0;
    } else {
      ratio = s.total ? s.index / s.total : 0;
    }
    el.progressFill.style.width = Math.max(0, Math.min(1, ratio)) * 100 + "%";
  }

  function updateCounter() {
    var s = state.session, q = state.question;
    if (!s || !q) return;
    var n = q.index + 1;
    if (s.mode === "perfect") {
      el.qCounter.textContent = t("progress.perfect", { n: n, solved: s.solvedCount, total: s.total });
    } else if (s.mode === "endless") {
      el.qCounter.textContent = t("progress.question", { n: n });
    } else {
      el.qCounter.textContent = t("progress.question", { n: n }) + " / " + s.total;
    }
  }

  // ── 出题（下半区）────────────────────────────────────────────

  function nextQuestion() {
    stopTimer();
    var q = state.session.next();
    if (!q) { finish(); return; }

    state.question = q;
    state.phase = "ask";
    state.pending = "";
    state.suggestions = [];
    state.suggestIndex = -1;

    updateCounter();
    updateProgress();

    renderCurrent(q);
    applyHints(q);

    // 地图：默认先锁住；上一题的答案画面留一小会儿再切到本题
    state.mapView.setLocked(true);
    var beat = state.beatPending ? (q.asked === "location" ? MAP_BEAT_NEEDED : MAP_BEAT_IDLE) : 0;
    state.beatPending = false;
    applyMapState(q, beat);

    if (state.timedMode) startTimer(0);
    else if (settings.timer === "perQuestion") startTimer(20000);

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
      if (q.known === "location") {
        state.mapView.highlight(q.region.id, "given");
        // 手机地图小，圈出来的省得放大才看得清
        if (isCompact()) { state.mapView.focusRegion(q.region.id, 2.9); state.mapFocusedId = q.region.id; }
      } else if (state.mapFocusedId && isCompact()) {
        state.mapView.resetView();
        state.mapFocusedId = null;
      }
    };
    if (delay > 0) setTimeout(run, delay);
    else run();
  }

  function renderCurrent(q) {
    U.clear(el.knownChip);
    el.knownChip.appendChild(U.el("em", { text: t("dim." + q.known) }));
    var knownText = q.known === "location" ? t("question.knownLocation") : boardValue(q.region, q.known);
    el.knownChip.appendChild(markLang(U.el("b", { text: knownText }), knownText));
    if (q.known === "capital") el.knownChip.appendChild(U.el("small", { text: T.game.termOf(q.region) }));

    // 题面：固定句式用小字，要答的那一项用大字，一眼就知道在问什么
    U.clear(el.askText);
    if (q.asked === "location") {
      el.askText.appendChild(U.el("span", { class: "tp-ask-strong", text: t("question.askLocation") }));
    } else {
      el.askText.appendChild(U.el("span", { class: "tp-ask-fixed", text: t("question.promptPrefix") }));
      el.askText.appendChild(U.el("span", { class: "tp-ask-strong", text: t("dim." + q.asked) }));
    }

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
      input.addEventListener("keydown", onInputKey);
      var ok = U.el("button", { class: "tp-btn tp-btn-primary tp-btn-sm", text: t("action.submit") });
      ok.addEventListener("click", submitFromInput);
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
          markLang(U.el("span", { class: "tp-choice-text", text: label }), label)
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
    state.suggestIndex = -1;
    state.suggestions = [];

    var box = el.answerArea.querySelector("#suggest");
    if (!box) return;
    U.clear(box);

    if (!state.pending.trim()) { e.target.classList.remove("tp-input-bad"); return; }
    if (!settings.smartInput) return;

    var m = T.game.matchInput(state.session.pool, q.asked, settings.locale, state.pending);

    // 只有「唯一命中，而且命中的就是正确答案」才自动判定。
    // 唯一但是别的省 → 不提交，等你按回车，方便改。
    if (m.unique && m.candidates[0] === q.region.id) {
      e.target.classList.remove("tp-input-bad");
      commitText();
      return;
    }

    if (m.kind === "multi") {
      e.target.classList.remove("tp-input-bad");
      state.suggestions = m.candidates.slice(0, 6).map(function (id) {
        return { id: id, value: boardValue(state.session.regionById[id], q.asked) };
      });
      state.suggestions.forEach(function (s, i) {
        var b = U.el("button", { class: "tp-suggest-item", type: "button", text: s.value });
        b.dataset.index = String(i);
        b.addEventListener("click", function () { pickSuggestion(i); });
        box.appendChild(b);
      });
      box.appendChild(U.el("span", { class: "tp-suggest-hint", text: t("input.keyHint") }));
    } else {
      e.target.classList.add("tp-input-bad");
    }
  }

  function onInputKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submitFromInput();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!state.suggestions.length) return;
      e.preventDefault();
      moveSuggestion(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Escape") {
      if (state.suggestions.length) {
        e.preventDefault();
        state.suggestIndex = -1;
        highlightSuggestion();
      }
    }
  }

  function moveSuggestion(delta) {
    var n = state.suggestions.length;
    if (!n) return;
    var i = state.suggestIndex;
    i = i < 0 ? (delta > 0 ? 0 : n - 1) : ((i + delta + n) % n);
    state.suggestIndex = i;
    highlightSuggestion();
  }

  function highlightSuggestion() {
    var items = el.answerArea.querySelectorAll(".tp-suggest-item");
    Array.prototype.forEach.call(items, function (node, k) {
      node.classList.toggle("tp-suggest-item-active", k === state.suggestIndex);
    });
    if (state.suggestIndex >= 0 && items[state.suggestIndex]) {
      items[state.suggestIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function pickSuggestion(i) {
    var s = state.suggestions[i];
    if (!s) return;
    commit({ kind: "choice", value: s.value });
  }

  /** 回车 / 「确定」按钮：有高亮候选就提交候选，否则提交输入框里的文字 */
  function submitFromInput() {
    if (state.suggestIndex >= 0 && state.suggestions[state.suggestIndex]) {
      pickSuggestion(state.suggestIndex);
      return;
    }
    commitText();
  }

  function commitText() {
    var input = el.answerArea.querySelector(".tp-answer-input");
    commit({ kind: "text", value: input ? input.value : "" });
  }

  function onMapPick(regionId) {
    if (state.phase !== "ask") return;
    var q = state.question;
    if (!q || q.asked !== "location") return;
    sfx("pick");
    commit({ kind: "locate", regionId: regionId });
  }

  // ── 提交：上一题进卡片，下半区立刻换题 ───────────────────────

  function commit(answer) {
    if (state.phase !== "ask") return;
    var q = state.question;

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
    updateProgress();

    state.beatPending = true;
    nextQuestion();      // 零阻断：下一题立刻占上同一个位置
  }

  // ── 上一题卡片 ───────────────────────────────────────────────

  /** 手机上只留一行：判对判错 + 省份 + 「详情 ›」 */
  function buildPrevStrip(result, cls) {
    var strip = U.el("div", { class: "tp-strip" });
    if (!result) {
      strip.appendChild(U.el("b", { text: t("prev.explainTitle") }));
    } else {
      strip.appendChild(U.el("i", {
        class: "tp-mark-icon " + (cls === "correct" ? "tp-ok" : cls === "close" ? "tp-close-icon" : "tp-bad"),
        text: cls === "correct" ? "✓" : cls === "close" ? "≈" : "✗"
      }));
      var name = localePick(result.region.fullNames, settings.locale);
      strip.appendChild(markLang(U.el("b", { text: name }), name));
      if (result.requeued) {
        strip.appendChild(U.el("i", { class: "tp-strip-flag", text: "↻ " + t("prev.requeuedShort") }));
      }
    }
    strip.appendChild(U.el("span", { class: "tp-strip-more", text: t("prev.tapForMore") }));
    return strip;
  }

  function renderPrevCard(result) {
    var content = U.el("div", { class: "tp-prev-content" });
    el.prevCard.className = "tp-prev";
    U.clear(el.prevCard);
    U.clear(el.infoSheetBody);

    if (!result) {
      content.appendChild(U.el("h3", { class: "tp-prev-title", text: t("prev.explainTitle") }));
      content.appendChild(U.el("p", { class: "tp-prev-body", text: t("prev.explainBody") }));
      el.infoSheetTitle.textContent = t("prev.explainTitle");
      placePrevCard(content, buildPrevStrip(null));
      return;
    }

    var region = result.region;
    var cls = result.correct ? "correct" : result.close ? "close" : "wrong";
    el.prevCard.classList.add("tp-prev-answer", "tp-prev-" + cls);

    var head = U.el("div", { class: "tp-prev-head" });
    head.appendChild(U.el("span", { class: "tp-verdict tp-verdict-" + cls, text: t("feedback." + cls) }));
    var fullName = localePick(region.fullNames, settings.locale);
    head.appendChild(markLang(U.el("b", { class: "tp-prev-name", text: fullName }), fullName));
    head.appendChild(U.el("span", {
      class: "tp-prev-your",
      text: t("prev.yourAnswer") + "：" + (result.given || t("prev.unknown"))
    }));
    content.appendChild(head);

    if (result.requeued) {
      content.appendChild(U.el("p", { class: "tp-prev-requeue", text: t("prev.requeued") }));
    }

    var info = U.el("div", { class: "tp-prev-info" });
    DIMS.forEach(function (dim) {
      var cell = U.el("span", {
        class: "tp-prev-cell" + (dim === result.question.asked ? " tp-prev-cell-asked" : "")
      });
      cell.appendChild(U.el("em", { text: t("dim." + dim) }));

      var value = boardValue(region, dim);
      cell.appendChild(markLang(U.el("b", { text: value }), value));

      // 简称补上带声调的拼音，方便把字形和读音绑定起来
      if (dim === "short") {
        var py = shortPinyin(region);
        if (py) cell.appendChild(U.el("small", { class: "tp-prev-pinyin", text: py, lang: "zh-Latn" }));
      }
      if (dim === "capital" && region.capitalTerm !== "none") {
        cell.appendChild(U.el("small", { text: T.game.termOf(region) }));
      }
      info.appendChild(cell);
    });
    content.appendChild(info);

    var v = wikiOf(region.id);
    if (v) content.appendChild(buildWikiBlock(v));
    else content.appendChild(U.el("p", { class: "tp-wiki-missing", text: t("reveal.wikiMissing") }));

    el.infoSheetTitle.textContent = fullName;
    placePrevCard(content, buildPrevStrip(result, cls));
  }

  /** 宽屏：内容直接铺在侧栏里；紧凑屏：侧栏只放一行摘要，全套塞进详情弹层 */
  function placePrevCard(content, strip) {
    if (isCompact()) {
      el.prevCard.classList.add("tp-prev-strip");
      el.prevCard.appendChild(strip);
      el.infoSheetBody.appendChild(content);
    } else {
      el.prevCard.appendChild(content);
    }
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
        if (l <= 0) {
          stopTimer();
          el.qTimer.textContent = t("time.up");
          updateProgress();
          finish();
          return;
        }
        el.qTimer.textContent = Math.ceil(l / 1000) + "s";
        if (state.session && state.session.mode === "endless") updateProgress();
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

  /** 暂停计时（打开确认框时用）：保留剩余时间 */
  function pauseTimer() { stopTimer(); }

  /** 继续答题时恢复计时；全局倒计时是绝对时点，会照常走完 */
  function resumeTimer() {
    if (state.phase !== "ask") return;
    if (state.timedMode) startTimer(0);
    else if (settings.timer === "perQuestion") startTimer(Math.max(3000, state.timerLeft || 20000));
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

  /** 把毫秒格式化成「2 分 13 秒」/「13 秒」 */
  function formatDuration(ms) {
    var total = Math.max(0, Math.round((ms || 0) / 1000));
    var m = Math.floor(total / 60), s = total % 60;
    return m > 0 ? t("summary.timeFmt", { m: m, s: s }) : t("summary.secFmt", { s: s });
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
      { value: "perQuestion", label: t("settings.timer.perQuestion") }
    ], settings.timer === "global" ? "off" : settings.timer, function (v) {
      settings.timer = v; persist(); buildSettings();
    }));

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
    if (state.session) { renderPrevCard(state.lastResult); updateCounter(); }
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
      "modeChips", "modeDesc", "knownChips", "askedChips", "styleChips",
      "scopeGroupChips", "scopeTypeChips", "scopePresets", "configSummary",
      "homeRegionCount", "langSelect", "btnSettings", "btnSettingsClose", "settingsOverlay",
      "settingsBody", "btnRestart", "btnHome", "btnQuit", "toast", "summaryBody",
      "confirmOverlay", "confirmBody", "btnConfirmStay", "btnConfirmLeave",
      "scopeTip", "infoSheet", "infoSheetTitle", "infoSheetBody", "btnInfoSheetClose",
      "onboard", "onboardBody", "onboardDots", "btnOnboardNext", "btnOnboardSkip"
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
    el.btnInfoSheetClose.addEventListener("click", function () { hideOverlay(el.infoSheet); });
    el.prevCard.addEventListener("click", function () {
      if (!isCompact()) return;
      if (!el.infoSheetBody.firstChild) return;
      showOverlay(el.infoSheet);
    });
    el.btnOnboardNext.addEventListener("click", function () {
      if (onboardStep < ONBOARD_STEPS.length - 1) { onboardStep += 1; renderOnboard(); return; }
      closeOnboard();
    });
    el.btnOnboardSkip.addEventListener("click", closeOnboard);
    el.prevCard.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.prevCard.click(); }
    });
    el.btnZoomIn.addEventListener("click", function () { state.mapView && state.mapView.zoomIn(); });
    el.btnZoomOut.addEventListener("click", function () { state.mapView && state.mapView.zoomOut(); });
    el.btnZoomReset.addEventListener("click", function () { state.mapView && state.mapView.resetView(); });
    el.btnRestart.addEventListener("click", startGame);
    el.btnHome.addEventListener("click", function () { showScreen("home"); buildHome(); });

    document.addEventListener("keydown", function (e) {
      var overlayOpen = !el.settingsOverlay.hidden || !el.confirmOverlay.hidden ||
        !el.infoSheet.hidden || !el.onboard.hidden;
      if (overlayOpen) {
        if (e.key === "Escape") {
          if (!el.confirmOverlay.hidden) { dismissConfirm(true); return; }
          if (!el.infoSheet.hidden) { hideOverlay(el.infoSheet); return; }
          if (!el.onboard.hidden) { closeOnboard(); return; }
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

    trackViewportHeight();
    buildLangSelect();
    applyI18n();
    buildHome();
    buildSettings();
    bind();
    showScreen("home");

    // 小屏首次进入：给一个三步引导（怎么玩 / 按住拖动 / 摘要行）
    if (isCompact() && !onboardSeen()) {
      setTimeout(function () { if (isCompact()) showOnboard(); }, 350);
    }

    // 横竖屏切换 / 窗口尺寸变化时，摘要行和内容要重新落位
    var onResize = U.debounce(function () {
      if (state.session) renderPrevCard(state.lastResult);
      buildHome();
    }, 200);
    global.addEventListener("resize", onResize);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
