# 数据模型与判定规则

## 1. 国家 / 地区集合

```js
TERRAPOP.countries.cn = {
  id: "cn",
  names: { "zh-Hans": "中国", "en": "China" },
  mapId: "cn",                 // 指向 TERRAPOP.maps.cn
  defaultLocale: "zh-Hans",
  regions: [ /* 见下 */ ]
};
```

## 2. 地区条目（`data/cn.js` 的 `regions[]`）

```js
{
  id: "CN-HE",                 // ISO 3166-2:CN 代码，港澳台同样有代码
  adcode: 130000,              // 行政区划代码，用于和地图 path 对齐
  type: "province",            // province | autonomous | municipality | sar
  group: "north",              // north|northeast|east|central|south|southwest|northwest
  names:   { "zh-Hans": "河北", "en": "Hebei" },              // 简称式省名（界面用）
  fullNames:{ "zh-Hans": "河北省", "en": "Hebei Province" },   // 全称（题干/判定的标准答案）
  pinyin: "Héběi",
  short: [                                                    // 可能多个简称
    { char: "冀", pinyin: "jì" }
  ],
  capital: { "zh-Hans": "石家庄", "en": "Shijiazhuang" },      // 直辖市/港澳为 null
  capitalPinyin: "Shíjiāzhuāng",
  capitalTerm: "capital",      // capital(省会) | seat(首府) | none(直辖市/特别行政区)
  capitalNote: { "zh-Hans": null, "en": null },               // 特殊说明，如「首府」「直辖市，不设省会」
  aliases:        { "zh-Hans": [], "en": [] },                // 全称的其它可接受写法
  capitalAliases: { "zh-Hans": ["石市"], "en": [] }           // 省会的别称
}
```

约定：
- `type` 与 `capitalTerm` 的对应：`municipality`/`sar` → `capitalTerm: "none"` 且 `capital: null`；`autonomous` → `seat`；`province` → `capital`。
- 直辖市与港澳不需要 `capital`，引擎会自动跳过该维度的出题。
- `short` 至少 1 项。

## 3. 百科层（`data/cn.wiki.js`）

**刻意与结构化数据分文件**，因为它体量大、可独立增补、且扩展到其他国家 / 语言时是最先要翻译的部分。

```js
TERRAPOP.wiki.cn = {
  "CN-HE": {
    memo:  { "zh-Hans": "…", "en": "…" },   // 记忆点：简称字源 / 谐音 / 串联口诀
    facts: { "zh-Hans": "…", "en": "…" },   // 一条趣味知识点
    wiki:  { "zh-Hans": "…", "en": "…" }    // 2–4 句百科
  }
};
```

## 4. 地图数据（`maps/cn.js`）

由 `scripts/build-map.mjs` 从 DataV GeoAtlas 的省级边界数据生成，字段见 `docs/architecture.md`。

投影公式（运行时会用它投影地形折线与省会点，必须严格一致）：

```
x = (lon - projection.lon0) * projection.cosLat * projection.k
y = (projection.lat0 - lat) * projection.k
```

## 5. 地形装饰（`data/cn.terrain.js`）

```js
TERRAPOP.terrain.cn = {
  rivers: [ { id, names:{locale…}, width, points: [[lon, lat], …] } ],
  lakes:  [ { id, names:{locale…}, points: [[lon, lat], …] } ]
};
```

纯经纬度，运行时投影。不做拓扑校验。

## 6. 判定规则（`js/game.js`）

### 6.1 归一化

```js
normalize(str) =
  1. String(str).trim()
  2. 全角 → 半角（标点与字母数字）
  3. 去掉所有空白、连接符、句点
  4. 简繁折叠（查 data/han-variants.js）
  5. 英文：去掉声调符号 + 转小写
```

### 6.2 各维度如何算对

| 维度 | 接受集合 |
|---|---|
| `full` | `fullNames[l]`、`names[l]`、`aliases[l]` 三者归一化后的并集 |
| `short` | `short` 数组里每个 `char` 及其 `pinyin`（带调 / 不带调） |
| `capital` | `capital[l]`、`capitalAliases[l]`、`capitalPinyin` |
| `location` | 点击命中的省 id === 正确 id → 满分；属于相邻省或距质心 < 容差 → 半分「接近」 |

注意：`full` 接受集合里包含 `names[l]`（不带后缀），所以「河北」和「河北省」都对。

### 6.3 位置容差

- 精确命中：浏览器 SVG hit-test 给出的 `data-id` 与正确答案一致。
- 「接近」：预先计算的**邻接表**（由省界共享边得到）包含正确答案 → 判「接近」。
- 兜底：点击坐标与正确省 `center` 的距离小于该省外接圆半径的一定比例 → 「接近」。

### 6.4 计分

- 每题基础分 100，按 `ask` 维度均分。
- 每维正确得分；`location` 判「接近」得该维一半分。
- 连击（连续全对）加乘：第 n 连击 ×(1 + min(n-1, 5) × 0.1)。
- 结算：总分、正确率、用时、连击峰值。
