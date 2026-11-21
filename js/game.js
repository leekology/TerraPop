// TerraPop · 竞猜引擎
// ---------------------------------------------------------------
// 通用模型：已知 1 个维度（known），猜其余维度的子集（ask）。
//   full     全称
//   short    简称（可能多个）
//   capital  省会 / 首府
//   location 位置（只能靠点击地图作答）
//
// 出题 / 判定 / 计分都只依赖 TERRAPOP.countries.<id>.regions 的统一字段，
// 因此新增国家不需要改动本文件（见 docs/i18n.md）。
// ---------------------------------------------------------------

(function (global) {
  "use strict";
  var T = (global.TERRAPOP = global.TERRAPOP || {});
  var U = T.util;

  var MODES = {
    "location-to-name":  { known: "location", ask: ["full", "short", "capital"] },
    "name-to-location":  { known: "full",     ask: ["location", "short"] },
    "capital-to-location": { known: "capital", ask: ["location", "short"] },
    "short-to-location": { known: "short",    ask: ["location", "capital"] },
    "all":               { known: null,       ask: ["full", "short", "capital", "location"] }
  };

  var MODE_ORDER = ["location-to-name", "name-to-location", "capital-to-location", "short-to-location", "all"];

  function modeConfig(mode) { return MODES[mode] || MODES["location-to-name"]; }

  /** 该条数据是否支持这个维度 */
  function supports(region, dim) {
    if (dim === "capital") return region.capitalTerm !== "none" && !!region.capital;
    if (dim === "short") return !!(region.short && region.short.length);
    return true;
  }

  /** 该地区能否作为这个模式的题目（known 维度必须存在） */
  function eligible(region, mode) {
    var cfg = modeConfig(mode);
    if (cfg.known && !supports(region, cfg.known)) return false;
    return askOf(region, mode).length > 0;
  }

  /** 实际要作答的维度（按数据可用性过滤） */
  function askOf(region, mode) {
    var cfg = modeConfig(mode);
    return cfg.ask.filter(function (d) { return supports(region, d); });
  }

  function knownOf(region, mode) {
    var cfg = modeConfig(mode);
    return cfg.known && supports(region, cfg.known) ? cfg.known : null;
  }

  // ── 可接受答案 ───────────────────────────────────────────────

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  function flattenLocaleMap(obj, mapper) {
    var out = [];
    if (!obj) return out;
    Object.keys(obj).forEach(function (l) {
      var v = obj[l];
      if (v === null || v === undefined) return;
      (Array.isArray(v) ? v : [v]).forEach(function (x) {
        if (typeof x !== "string" || !x) return;
        out = out.concat(mapper ? mapper(x) : U.answerForms(x));
      });
    });
    return out;
  }

  function acceptedFull(region) {
    return uniq(
      flattenLocaleMap(region.fullNames)
        .concat(flattenLocaleMap(region.names))
        .concat(flattenLocaleMap(region.aliases))
    );
  }

  function acceptedShort(region) {
    var out = [];
    (region.short || []).forEach(function (s) {
      out = out.concat(U.answerForms(s.char));
      if (s.pinyin) out = out.concat(U.answerForms(s.pinyin));
    });
    // 「内蒙古」这类多字简称，也接受其不含后缀的写法
    return uniq(out);
  }

  function acceptedCapital(region) {
    if (region.capitalTerm === "none" || !region.capital) return [];
    return uniq(
      flattenLocaleMap(region.capital)
        .concat(flattenLocaleMap(region.capitalAliases))
        .concat(region.capitalPinyin ? U.answerForms(region.capitalPinyin) : [])
    );
  }

  function acceptedFor(region, dim) {
    if (dim === "full") return acceptedFull(region);
    if (dim === "short") return acceptedShort(region);
    if (dim === "capital") return acceptedCapital(region);
    return [];
  }

  // ── 展示用文本 ───────────────────────────────────────────────

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

  function termOf(region) {
    if (region.capitalTerm === "seat") return T.i18n.t("term.seat");
    if (region.capitalTerm === "none") return T.i18n.t("term.none");
    return T.i18n.t("term.capital");
  }

  // ── 判定 ─────────────────────────────────────────────────────

  function judgeText(region, dim, value) {
    // 两侧都做"去行政后缀"折叠，所以「石家庄」「石家庄市」都能命中
    var forms = U.answerForms(value);
    if (!forms.length) return { status: "skipped", ratio: 0 };
    var accepted = acceptedFor(region, dim);
    var ok = forms.some(function (f) { return accepted.indexOf(f) !== -1; });
    return { status: ok ? "correct" : "wrong", ratio: ok ? 1 : 0 };
  }

  function judgeLocation(region, payload, opts) {
    var o = opts || {};
    if (!payload || !payload.regionId) return { status: "skipped", ratio: 0 };
    if (payload.regionId === region.id) return { status: "correct", ratio: 1 };

    if (o.lenient !== false) {
      var neighbours = (o.adjacency && o.adjacency[region.id]) || [];
      if (neighbours.indexOf(payload.regionId) !== -1) return { status: "close", ratio: 0.5 };
      var centre = o.centers && o.centers[region.id];
      if (centre && payload.point) {
        var d = T.map.distance(centre, payload.point);
        var radius = (o.radius && o.radius[region.id]) || 26;
        if (d < radius) return { status: "close", ratio: 0.5 };
      }
    }
    return { status: "wrong", ratio: 0 };
  }

  // ── 干扰项（选择题）──────────────────────────────────────────

  function distractorsFor(region, dim, pool, count, rnd) {
    var target = displayFor(region, dim, "zh-Hans");
    var sameGroup = [], others = [];
    pool.forEach(function (r) {
      if (r.id === region.id) return;
      if (!supports(r, dim)) return;
      var label = displayFor(r, dim, "zh-Hans");
      if (!label || label === target) return;
      (r.group === region.group ? sameGroup : others).push(label);
    });
    sameGroup = uniq(sameGroup);
    others = uniq(others).filter(function (l) { return sameGroup.indexOf(l) === -1; });
    var pickedChoices = U.sample(sameGroup, count, rnd);
    if (pickedChoices.length < count) pickedChoices = pickedChoices.concat(U.sample(others, count - pickedChoices.length, rnd));
    return pickedChoices;
  }

  // ── 会话 ─────────────────────────────────────────────────────

  function createSession(config) {
    var cfg = config || {};
    var country = cfg.country;
    var mode = cfg.mode || "location-to-name";
    var locale = cfg.locale || country.defaultLocale;
    var pool = country.regions.filter(function (r) {
      if (cfg.regionIds && cfg.regionIds.indexOf(r.id) === -1) return false;
      return eligible(r, mode);
    });

    var session = {
      country: country,
      mode: mode,
      pool: pool,
      config: cfg,
      index: -1,
      current: null,
      score: 0,
      combo: 0,
      bestCombo: 0,
      correctCount: 0,
      answeredCount: 0,
      history: [],
      finished: false
    };

    session.order = U.shuffle(pool.map(function (r) { return r.id; }), cfg.random);

    session.total = session.order.length;

    session.next = function () {
      session.index += 1;
      if (session.index >= session.order.length) {
        session.finished = true;
        session.current = null;
        return null;
      }
      var id = session.order[session.index];
      var region = pool.filter(function (r) { return r.id === id; })[0];
      var ask = askOf(region, mode);
      var known = knownOf(region, mode);
      var question = {
        index: session.index,
        region: region,
        mode: mode,
        known: known,
        ask: ask,
        term: termOf(region),
        locale: locale,
        choices: {},
        hints: {
          capitalMarker: !!cfg.hintsCapitalMarker,
          outline: !!cfg.hintsOutline,
          firstChar: !!cfg.hintsFirstChar
        },
        answers: {}
      };
      // 选择题干扰项
      if (cfg.inputMode === "choice") {
        ask.forEach(function (dim) {
          if (dim === "location") return;
          var ds = distractorsFor(region, dim, country.regions, 3, cfg.random);
          question.choices[dim] = U.shuffle(ds.concat([displayFor(region, dim, "zh-Hans")]), cfg.random);
        });
      }
      session.current = question;
      return question;
    };

    session.submit = function (answers) {
      var q = session.current;
      if (!q) return null;
      q.answers = answers || {};
      var items = [];
      var per = q.ask.length ? 100 / q.ask.length : 0;

      q.ask.forEach(function (dim) {
        var a = q.answers[dim];
        var verdict;
        if (dim === "location") {
          verdict = judgeLocation(q.region, a, {
            lenient: cfg.judge !== "strict",
            adjacency: cfg.adjacency,
            centers: cfg.centers,
            radius: cfg.radius
          });
        } else {
          verdict = judgeText(q.region, dim, a && a.value);
        }
        items.push({
          dim: dim,
          status: verdict.status,
          ratio: verdict.ratio,
          given: dim === "location"
            ? (a && a.regionId ? (cfg.nameOf ? cfg.nameOf(a.regionId) : a.regionId) : "")
            : ((a && a.value) || ""),
          expected: displayFor(q.region, dim, locale),
          points: Math.round(per * verdict.ratio)
        });
      });

      var gained = items.reduce(function (s, it) { return s + it.points; }, 0);
      var allCorrect = items.every(function (it) { return it.status === "correct"; });

      session.combo = allCorrect ? session.combo + 1 : 0;
      session.bestCombo = Math.max(session.bestCombo, session.combo);
      if (allCorrect) session.correctCount += 1;
      session.answeredCount += 1;

      // 连击加成：第 n 连击 × (1 + min(n-1,5)×0.1)
      var mult = allCorrect ? 1 + Math.min(session.combo - 1, 5) * 0.1 : 1;
      var finalGain = Math.round(gained * mult);
      session.score += finalGain;

      var result = {
        question: q,
        region: q.region,
        items: items,
        gained: finalGain,
        baseGained: gained,
        multiplier: mult,
        allCorrect: allCorrect,
        combo: session.combo,
        score: session.score
      };
      session.history.push(result);
      return result;
    };

    session.remaining = function () { return Math.max(0, session.order.length - session.index - 1); };

    return session;
  }

  T.game = {
    MODES: MODES,
    MODE_ORDER: MODE_ORDER,
    modeConfig: modeConfig,
    askOf: askOf,
    knownOf: knownOf,
    eligible: eligible,
    supports: supports,
    acceptedFor: acceptedFor,
    acceptedFull: acceptedFull,
    acceptedShort: acceptedShort,
    acceptedCapital: acceptedCapital,
    displayFor: displayFor,
    termOf: termOf,
    judgeText: judgeText,
    judgeLocation: judgeLocation,
    distractorsFor: distractorsFor,
    createSession: createSession
  };
})(window);
