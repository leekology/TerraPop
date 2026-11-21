// TerraPop · 竞猜引擎（一问一答版）
// ---------------------------------------------------------------
// 模型：每道题给出 1 个已知维度，只问 1 个维度。
//   维度 full / short / capital / location
//   已知 × 作答 → 4×3 = 12 种正交组合（同一维度不能自己问自己）
//   作答方式 style：text | choice3 | choice4 | choice5 | locate
//   当作答维度是 location 时 style 固定为 locate（点击地图）
//
// 因此「玩法矩阵」是完全正交的：任何 known × asked × style 都能配置出来。
// 所有函数只依赖 TERRAPOP.countries.<id>.regions 的统一字段，新增国家无需改本文件。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;

  var DIMS = ["full", "short", "capital", "location"];
  var KNOWN_OPTIONS = ["full", "short", "capital", "location", "random"];
  var ASKED_OPTIONS = ["full", "short", "capital", "location", "random"];
  var STYLES = ["text", "choice3", "choice4", "choice5", "locate"];

  var CHOICE_COUNT = { choice3: 3, choice4: 4, choice5: 5 };
  // 选项越多越好蒙，分数权重越低
  var STYLE_WEIGHT = { text: 1, locate: 1, choice3: 0.7, choice4: 0.8, choice5: 0.9 };

  var BASE_POINTS = 100;

  // ── 维度可用性 ───────────────────────────────────────────────

  function supports(region, dim) {
    if (!dim) return false;
    if (dim === "capital") return region.capitalTerm !== "none" && !!region.capital;
    if (dim === "short") return !!(region.short && region.short.length);
    return true; // full / location 恒可用
  }

  function availableDims(region) {
    return DIMS.filter(function (d) { return supports(region, d); });
  }

  // ── 可接受答案 ───────────────────────────────────────────────

  /**
   * 把一个"原始写法"展开成全部可接受的可输入形式：
   *   归一化原文、去掉行政后缀的版本、无声调拼音、拼音首字母。
   * 例：石家庄 → ["石家庄", "shijiazhuang", "sjz"]
   *     河北省 → ["河北省", "河北", "hebeisheng", "hbs", "hebei", "hb"]
   *
   * opts.pinyin === false 时只保留字面写法：用于"别称"（羊城、盛京、石头城…），
   * 它们的拼音首字母太短，会去抢别的答案，所以只认完全输入的字面形式。
   */
  function expand(raw, opts) {
    if (raw === null || raw === undefined) return [];
    var s = String(raw);
    if (!s) return [];
    var withPinyin = !(opts && opts.pinyin === false);
    var out = [];
    function add(v) { if (v && out.indexOf(v) === -1) out.push(v); }

    U.answerForms(s).forEach(add);

    if (!withPinyin) return out;

    if (U.hasHan(s)) {
      var norm = U.normalize(s);
      var stripped = U.stripSuffix(norm);
      [s, stripped].forEach(function (form) {
        if (!form || !U.hasHan(form)) return;
        add(U.pinyinFlat(form));
        var ini = U.initialsOf(form);
        if (ini && ini !== U.pinyinFlat(form)) add(ini);
      });
    } else {
      // 纯拉丁：多词时补一个单词首字母串（Hebei Province → hp、Hong Kong → hk）
      var words = U.stripDiacritics(s).toLowerCase().match(/[a-z0-9']+/g) || [];
      if (words.length > 1) {
        var ini2 = words.map(function (w) { return w.charAt(0); }).join("");
        if (ini2.length >= 2 && ini2.length <= 8) add(ini2);
      }
    }
    return out;
  }

  var KEY_CACHE = {};
  var KEY_LRU = [];

  /**
   * 构造某个维度上"用户可以输入什么"。
   *   primary：正式名称 / 简称 / 省会 及其拼音、首字母 → 参与前缀匹配（智能输入）
   *   extra  ：别称（羊城、日光城、陇右…）→ 只在完全输入时才认，免得前缀匹配太吵
   */
  function buildKeySets(region, dim, locale) {
    var primary = [], extra = [];
    function addTo(bucket, raw, opts) {
      if (raw === null || raw === undefined) return;
      expand(raw, opts).forEach(function (k) { if (bucket.indexOf(k) === -1) bucket.push(k); });
    }
    function addAll(bucket, v, opts) {
      if (v === null || v === undefined) return;
      (Array.isArray(v) ? v : [v]).forEach(function (x) { addTo(bucket, x, opts); });
    }
    function addLocaleMap(bucket, obj, opts) {
      if (!obj) return;
      Object.keys(obj).forEach(function (l) { addAll(bucket, obj[l], opts); });
    }

    if (dim === "full") {
      addLocaleMap(primary, region.fullNames);
      addLocaleMap(primary, region.names);
      addLocaleMap(extra, region.aliases, { pinyin: false });
    } else if (dim === "short") {
      (region.short || []).forEach(function (s) { addTo(primary, s.char); addTo(primary, s.pinyin); });
    } else if (dim === "capital") {
      addLocaleMap(primary, region.capital);
      addTo(primary, region.capitalPinyin);
      addLocaleMap(extra, region.capitalAliases, { pinyin: false });
    }

    var all = primary.slice();
    extra.forEach(function (k) { if (all.indexOf(k) === -1) all.push(k); });
    return { primary: primary, extra: extra, all: all };
  }

  function keySetsFor(region, dim, locale) {
    var ck = region.id + "|" + dim + "|" + locale;
    if (KEY_CACHE[ck]) return KEY_CACHE[ck];
    var sets = buildKeySets(region, dim, locale);
    KEY_CACHE[ck] = sets;
    KEY_LRU.push(ck);
    if (KEY_LRU.length > 800) delete KEY_CACHE[KEY_LRU.shift()];
    return sets;
  }

  function keysFor(region, dim, locale) { return keySetsFor(region, dim, locale).all; }

  // ── 展示文本 ─────────────────────────────────────────────────

  function localePick(obj, locale, fallback) {
    if (!obj) return "";
    return obj[locale] || (fallback && obj[fallback]) || obj[Object.keys(obj)[0]] || "";
  }

  function displayFor(region, dim, locale) {
    var fb = "zh-Hans";
    switch (dim) {
      case "full": return localePick(region.fullNames, locale, fb);
      case "short": return (region.short || []).map(function (s) { return s.char; }).join(" / ");
      case "capital":
        return region.capitalTerm === "none"
          ? T.i18n.t("term.none")
          : localePick(region.capital, locale, fb);
      case "location": return localePick(region.names, locale, fb);
      default: return "";
    }
  }

  /** 简称在英文界面下补上拼音，便于对照记忆 */
  function shortDisplay(region, locale) {
    var chars = (region.short || []).map(function (s) { return s.char; });
    if (!chars.length) return "";
    var py = (region.short || []).map(function (s) { return s.pinyin; }).filter(Boolean);
    if (locale !== "zh-Hans" && py.length) return chars.join(" / ") + " (" + py.join(" / ") + ")";
    return chars.join(" / ");
  }

  function termOf(region) {
    if (region.capitalTerm === "seat") return T.i18n.t("term.seat");
    if (region.capitalTerm === "none") return T.i18n.t("term.none");
    return T.i18n.t("term.capital");
  }

  // ── 智能输入匹配 ─────────────────────────────────────────────

  /**
   * 按用户已输入的内容，在所有候选地区里找可能答案。
   * 返回 { kind, candidates }：
   *   empty  尚未输入
   *   exact  输入本身就是某个（些）地区的完整答案
   *   unique 只有唯一地区可能 → 可以直接判定
   *   multi  多个地区都可能 → 给出候选列表
   *   none   无匹配
   */
  function matchInput(pool, dim, locale, input) {
    var q = U.normalize(input);
    if (!q) return { kind: "empty", candidates: [], query: "" };
    var exact = [], prefix = [];
    for (var i = 0; i < pool.length; i++) {
      var r = pool[i];
      var sets = keySetsFor(r, dim, locale);
      if (!sets.all.length) continue;
      if (sets.all.indexOf(q) !== -1) { exact.push(r.id); continue; }
      // 前缀匹配只看正式名称与拼音，别称只在完全输入时才认
      for (var j = 0; j < sets.primary.length; j++) {
        if (sets.primary[j].indexOf(q) === 0) { prefix.push(r.id); break; }
      }
    }
    if (exact.length === 1) return { kind: "exact", candidates: exact, query: q, unique: true };
    if (exact.length > 1) return { kind: "multi", candidates: exact, query: q, unique: false, ambiguous: true };
    if (prefix.length === 1) return { kind: "unique", candidates: prefix, query: q, unique: true };
    if (prefix.length > 1) return { kind: "multi", candidates: prefix, query: q, unique: false };
    return { kind: "none", candidates: [], query: q, unique: false };
  }

  /**
   * 判定文本作答 —— 与"智能输入"的匹配规则保持一致：
   *   完全匹配任何可接受写法（含别称）→ 对
   *   是某个"正式写法"的前缀 → 对（所以打一个字母、只要无歧义就能直接判对）
   *   别称只认完全输入
   */
  function judgeText(target, dim, locale, input) {
    var q = U.normalize(input);
    if (!q) return { status: "skipped", ratio: 0, matched: false };
    var sets = keySetsFor(target, dim, locale);
    if (sets.all.indexOf(q) !== -1) return { status: "correct", ratio: 1, matched: true };
    for (var i = 0; i < sets.primary.length; i++) {
      if (sets.primary[i].indexOf(q) === 0) return { status: "correct", ratio: 1, matched: true };
    }
    return { status: "wrong", ratio: 0, matched: false };
  }

  function judgeLocation(target, payload, opts) {
    var o = opts || {};
    if (!payload || !payload.regionId) return { status: "skipped", ratio: 0 };
    if (payload.regionId === target.id) return { status: "correct", ratio: 1 };
    if (o.lenient !== false) {
      var neighbours = (o.adjacency && o.adjacency[target.id]) || [];
      if (neighbours.indexOf(payload.regionId) !== -1) return { status: "close", ratio: 0.5 };
      var centre = o.centers && o.centers[target.id];
      if (centre && payload.point) {
        var d = T.map.distance(centre, payload.point);
        if (d < ((o.radius && o.radius[target.id]) || 26)) return { status: "close", ratio: 0.5 };
      }
    }
    return { status: "wrong", ratio: 0 };
  }

  // ── 出题 ─────────────────────────────────────────────────────

  function pickFrom(arr, rnd) { return arr[Math.floor((rnd || Math.random)() * arr.length)]; }

  /** 解出这道题实际的「已知 / 作答」维度；不可行时返回 null */
  function resolvePair(region, knownCfg, askedCfg, rnd) {
    var dims = availableDims(region);
    if (dims.length < 2) return null;

    var known = knownCfg === "random" ? pickFrom(dims, rnd) : knownCfg;
    if (!supports(region, known)) return null;

    var others = dims.filter(function (d) { return d !== known; });
    var asked = askedCfg === "random" ? pickFrom(others, rnd) : askedCfg;
    if (!asked || asked === known || !supports(region, asked)) return null;

    return { known: known, asked: asked };
  }

  function styleFor(asked, styleCfg) {
    if (asked === "location") return "locate";
    return CHOICE_COUNT[styleCfg] ? styleCfg : "text";
  }

  function eligible(region, knownCfg, askedCfg, rnd) {
    return !!resolvePair(region, knownCfg, askedCfg, rnd || Math.random);
  }

  // ── 干扰项 ───────────────────────────────────────────────────

  /**
   * 生成 N-1 个干扰项。
   * difficulty: easy(优先跨大区，容易排除) / normal / hard(优先同大区，最难)
   */
  function distractors(target, dim, pool, count, difficulty, rnd, locale) {
    var targetLabel = displayFor(target, dim, locale);
    var same = [], other = [], seen = {};
    pool.forEach(function (r) {
      if (r.id === target.id) return;
      if (!supports(r, dim)) return;
      var label = displayFor(r, dim, locale);
      if (!label || label === targetLabel || seen[label]) return;
      seen[label] = 1;
      (r.group === target.group ? same : other).push(label);
    });
    var first = difficulty === "easy" ? other : difficulty === "hard" ? same : null;
    var second = first === same ? other : same;
    var out;
    if (first) out = U.sample(first, count - 1, rnd);
    else out = U.sample(same.concat(other), count - 1, rnd);
    if (out.length < count - 1) {
      var rest = (second || []).filter(function (l) { return out.indexOf(l) === -1; });
      out = out.concat(U.sample(rest, count - 1 - out.length, rnd));
    }
    if (out.length < count - 1) {
      out = out.concat(U.sample(second || [], count - 1 - out.length, rnd));
    }
    return out;
  }

  function difficultyForStyle(style) {
    if (style === "choice3") return "easy";
    if (style === "choice5") return "hard";
    return "normal";
  }

  // ── 出题顺序 ─────────────────────────────────────────────────

  /**
   * 邻接漫游：从随机一个省出发，每次尽量走到未访问过的相邻省；
   * 走不动了（比如台湾、海南，或者范围把邻居排除掉了）就跳到离当前最近的未访问省份。
   */
  function adjacencyWalk(pool, adjacency, centers, rnd) {
    var remaining = pool.map(function (r) { return r.id; });
    var inPool = {};
    remaining.forEach(function (id) { inPool[id] = true; });
    var out = [];
    if (!remaining.length) return out;

    var cur = remaining[Math.floor((rnd || Math.random)() * remaining.length)];
    while (remaining.length) {
      out.push(cur);
      remaining = remaining.filter(function (id) { return id !== cur; });
      if (!remaining.length) break;

      var nb = ((adjacency || {})[cur] || []).filter(function (id) {
        return inPool[id] && remaining.indexOf(id) !== -1;
      });
      if (nb.length) {
        cur = nb[Math.floor((rnd || Math.random)() * nb.length)];
        continue;
      }
      var c0 = (centers && centers[cur]) || [0, 0];
      var best = remaining[0], bd = Infinity;
      remaining.forEach(function (id) {
        var c = (centers && centers[id]) || [0, 0];
        var d = (c[0] - c0[0]) * (c[0] - c0[0]) + (c[1] - c0[1]) * (c[1] - c0[1]);
        if (d < bd) { bd = d; best = id; }
      });
      cur = best;
    }
    return out;
  }

  var ORDER_MODES = ["random", "adjacency", "endless", "perfect"];

  // ── 会话 ─────────────────────────────────────────────────────

  function createSession(cfg) {
    cfg = cfg || {};
    var country = cfg.country;
    var locale = cfg.locale || country.defaultLocale;
    var rnd = cfg.random || Math.random;
    var mode = ORDER_MODES.indexOf(cfg.order) !== -1 ? cfg.order : "random";

    var pool = country.regions.filter(function (r) {
      if (cfg.regionIds && cfg.regionIds.indexOf(r.id) === -1) return false;
      return eligible(r, cfg.known, cfg.asked, rnd);
    });
    var poolIds = pool.map(function (r) { return r.id; });

    var session = {
      country: country,
      config: cfg,
      locale: locale,
      mode: mode,
      pool: pool,
      poolIds: poolIds,
      total: poolIds.length,
      index: -1,              // 第几题（1 起算）
      current: null,
      queue: [],
      solved: {},             // perfect 模式：已经答对过的省份
      solvedCount: 0,
      score: 0,
      combo: 0,
      bestCombo: 0,
      correctCount: 0,
      answeredCount: 0,
      history: [],
      finished: false
    };

    session.regionById = {};
    country.regions.forEach(function (r) { session.regionById[r.id] = r; });

    session.queue = mode === "adjacency"
      ? adjacencyWalk(pool, cfg.adjacency, cfg.centers, rnd)
      : U.shuffle(poolIds, rnd);

    function refillForEndless() {
      var next = U.shuffle(poolIds, rnd);
      // 别让新一轮的第一题和刚答完的重复
      if (next.length > 1 && session.lastId && next[0] === session.lastId) {
        next.push(next.shift());
      }
      return next;
    }

    session.next = function () {
      var guard = 0;
      while (guard++ < 500) {
        if (!session.queue.length) {
          if (mode === "endless") {
            session.queue = refillForEndless();
            if (!session.queue.length) { session.finished = true; session.current = null; return null; }
          } else {
            session.finished = true;
            session.current = null;
            return null;
          }
        }
        var id = session.queue.shift();
        var region = session.regionById[id];
        if (!region) continue;
        var pair = resolvePair(region, cfg.known, cfg.asked, rnd);
        if (!pair) continue;              // 这一省在这个组合下出不了题，跳过

        session.index += 1;
        session.lastId = id;
        var style = styleFor(pair.asked, cfg.style);
        var question = {
          index: session.index,
          region: region,
          known: pair.known,
          asked: pair.asked,
          style: style,
          term: termOf(region),
          choices: null
        };
        if (CHOICE_COUNT[style]) {
          var n = CHOICE_COUNT[style];
          var ds = distractors(region, pair.asked, country.regions, n, difficultyForStyle(style), rnd, locale);
          question.choices = U.shuffle(ds.concat([displayFor(region, pair.asked, locale)]), rnd);
        }
        session.current = question;
        return question;
      }
      session.finished = true;
      session.current = null;
      return null;
    };

    /**
     * 提交作答。
     * @param {{kind:'text'|'choice'|'locate'|'skip', value?:string, regionId?:string, point?:number[]}} answer
     */
    session.submit = function (answer) {
      var q = session.current;
      if (!q) return null;
      var a = answer || { kind: "skip" };
      var region = q.region;

      var verdict;
      if (q.asked === "location") {
        verdict = a.kind === "locate"
          ? judgeLocation(region, { regionId: a.regionId, point: a.point }, {
            lenient: cfg.judge !== "strict",
            adjacency: cfg.adjacency,
            centers: cfg.centers,
            radius: cfg.radius
          })
          : { status: "skipped", ratio: 0 };
      } else if (a.kind === "skip") {
        verdict = { status: "skipped", ratio: 0 };
      } else {
        verdict = judgeText(region, q.asked, locale, a.value);
      }

      var weight = STYLE_WEIGHT[q.style] === undefined ? 1 : STYLE_WEIGHT[q.style];
      var base = Math.round(BASE_POINTS * weight * verdict.ratio);

      var correct = verdict.status === "correct";
      session.combo = correct ? session.combo + 1 : 0;
      session.bestCombo = Math.max(session.bestCombo, session.combo);
      if (correct) session.correctCount += 1;
      session.answeredCount += 1;

      // 全答对为止：答对了记一次通关，答错的题排到队尾再来一遍
      if (correct && !session.solved[region.id]) {
        session.solved[region.id] = true;
        session.solvedCount += 1;
      }
      if (mode === "perfect" && !correct) {
        session.queue.push(region.id);
      }

      var mult = correct ? 1 + Math.min(session.combo - 1, 5) * 0.1 : 1;
      var gained = Math.round(base * mult);
      session.score += gained;

      var givenDisplay;
      if (q.asked === "location") {
        givenDisplay = a.regionId
          ? displayFor(session.regionById[a.regionId] || { names: { "zh-Hans": a.regionId } }, "location", locale)
          : "";
      } else {
        givenDisplay = a.value || "";
      }

      var result = {
        question: q,
        region: region,
        status: verdict.status,
        correct: correct,
        close: verdict.status === "close",
        ratio: verdict.ratio,
        given: givenDisplay,
        expected: displayFor(region, q.asked, locale),
        expectedFull: displayFor(region, "full", locale),
        gained: gained,
        multiplier: mult,
        combo: session.combo,
        score: session.score,
        requeued: mode === "perfect" && !correct
      };
      session.history.push(result);
      return result;
    };

    session.accuracy = function () {
      return session.answeredCount ? session.correctCount / session.answeredCount : 0;
    };
    session.remaining = function () { return session.queue.length; };

    /** 进度比例（0~1）；endless 交给调用方按时间算 */
    session.progressRatio = function () {
      if (mode === "perfect") return session.total ? session.solvedCount / session.total : 0;
      if (mode === "endless") return 0;
      if (!session.total) return 0;
      return Math.max(0, Math.min(1, session.index / session.total));
    };

    return session;
  }

  var MATRIX = (function () {
    var out = [];
    DIMS.forEach(function (known) {
      DIMS.forEach(function (asked) {
        if (known === asked) return;
        out.push({ known: known, asked: asked });
      });
    });
    return out; // 12 种
  })();

  T.game = {
    DIMS: DIMS,
    KNOWN_OPTIONS: KNOWN_OPTIONS,
    ASKED_OPTIONS: ASKED_OPTIONS,
    STYLES: STYLES,
    ORDER_MODES: ORDER_MODES,
    CHOICE_COUNT: CHOICE_COUNT,
    STYLE_WEIGHT: STYLE_WEIGHT,
    BASE_POINTS: BASE_POINTS,
    MATRIX: MATRIX,
    adjacencyWalk: adjacencyWalk,
    supports: supports,
    availableDims: availableDims,
    expand: expand,
    keysFor: keysFor,
    keySetsFor: keySetsFor,
    displayFor: displayFor,
    shortDisplay: shortDisplay,
    termOf: termOf,
    matchInput: matchInput,
    judgeText: judgeText,
    judgeLocation: judgeLocation,
    resolvePair: resolvePair,
    styleFor: styleFor,
    eligible: eligible,
    distractors: distractors,
    difficultyForStyle: difficultyForStyle,
    createSession: createSession
  };
})(window);
