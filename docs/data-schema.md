# 数据模型与判定规则

## 1. 国家 / 地区集合（`data/cn.js`）

```js
TERRAPOP.countries.cn = {
  id: "cn",
  names: { "zh-Hans": "中国", en: "China" },
  mapId: "cn",                 // 指向 TERRAPOP.maps.cn
  defaultLocale: "zh-Hans",
  regions: [ /* 见下 */ ]
};
```

### 地区条目

```js
{
  id: "CN-HE",                 // ISO 3166-2:CN
  adcode: 130000,              // 行政区划代码，用于和地图 path 对齐
  type: "province",            // province | autonomous | municipality | sar
  group: "north",              // north|northeast|east|central|south|southwest|northwest
  names:    { "zh-Hans": "河北", "en": "Hebei" },             // 界面上的省名
  fullNames:{ "zh-Hans": "河北省", "en": "Hebei Province" },  // 全称（标准答案）
  pinyin: "Héběi",
  short: [ { char: "冀", pinyin: "jì" } ],                    // 可能多个
  capital: { "zh-Hans": "石家庄", "en": "Shijiazhuang" },      // 直辖市/港澳为 null
  capitalPinyin: "Shíjiāzhuāng",
  capitalTerm: "capital",      // capital(省会) | seat(首府) | none(不设省会)
  capitalNote: { "zh-Hans": null, en: null },
  aliases:        { "zh-Hans": [], en: [] },                  // 全称的其它写法
  capitalAliases: { "zh-Hans": ["石市"], en: [] }             // 省会的别称
}
```

约定：

- `municipality` / `sar` → `capitalTerm: "none"` 且 `capital: null`；`autonomous` → `seat`；其余 → `capital`。
- 涉及 `capital` 的题目会自动剔除没有省会的地区。
- `short` 至少 1 项。

## 2. 百科层（`data/cn.wiki.js`）

**刻意与结构化数据分不同文件**：体量大、可独立增补，也是扩展到其他国家/语言时最先要翻译的部分。

```js
TERRAPOP.wiki.cn = {
  "CN-HE": {
    memo:  { "zh-Hans": "…", "en": "…" },   // 记忆点：简称字源 / 串联口诀
    facts: { "zh-Hans": "…", "en": "…" },   // 一条趣味知识点
    wiki:  { "zh-Hans": "…", "en": "…" }    // 2–4 句百科
  }
};
```

## 3. 拼音表（`data/han-initials.js`）

```js
TERRAPOP.hanPinyin = { "北": "bei", "冀": "ji", … };  // 148 个地名常用字，无声调
```

用途：把汉字推导成拼音与首字母，支撑智能输入。
`TERRAPOP.util.pinyinFlat("石家庄") === "shijiazhuang"`、`initialsOf("石家庄") === "sjz"`。

## 4. 地图数据（`maps/cn.js`）

由 `scripts/build-map.mjs` 从 DataV GeoAtlas 的省级边界生成：

```js
{
  id: "cn",
  names: { … },
  viewBox: [0, 0, 1000, 718],
  projection: { lon0, lat0, k, cosLat },   // x=(lon-lon0)*cosLat*k ; y=(lat0-lat)*k
  regions:  [ { id, adcode, d, label: [x,y], center: [x,y] } ],
  capitals: { "CN-HE": [x, y] },
  inset:    { box: [x,y,w,h], shapes: [ { id, d } ] }   // 南海诸岛 + 九段线
}
```

`projection` 是运行时的唯一投影真源：地形折线、省会标记都用它换算，保证与省界严丝合缝。

## 5. 地貌数据（`data/cn.terrain.js`）

```js
TERRAPOP.terrain.cn = {
  rivers:    [ { id, names, width, points: [[lon,lat], …] } ],
  lakes:     [ { id, names, points: [[lon,lat], …] } ],          // 闭合多边形
  landforms: [ { id, names, kind, center, rx, ry, rot, label } ],// 椭圆近似 + 文字标注
  ranges:    [ { id, names, points: [[lon,lat], …], size, label } ]
};
```

- `kind ∈ plateau | basin | plain | desert | hills`
- 全部是**经纬度**，运行时投影。不追求测绘精度，只追求"一眼认得出"。
- 面状地貌会被裁进陆地轮廓，所以椭圆略大也不会溢到海里。
- 自检脚本会验证每个 `center`、每条山脉/河流/湖泊的顶点都落在中国陆地范围内。

### 标注策略（不许泄露省份）

地图上的文字标注本身就是提示，必须保证它不会把答案说出来：

| 要素 | 标注规则 |
|---|---|
| 面状地貌（landforms） | **只标类型名**：高原 / 盆地 / 平原 / 沙漠 / 丘陵（`legend.*` 文案）。绝不出现「四川盆地」「内蒙古高原」「青藏高原」这种带省份的名字 |
| 山脉 / 河流 / 湖泊 | 保留名字，但**名字里含省名或简称的直接不标**。例如 黑龙江（江与省同名）、雅鲁藏布江（藏）、青海湖（青）、滇池（滇）、秦岭（秦）都不标；长江 / 黄河 / 珠江 / 天山 / 太行山 等照常标注 |

实现：`TERRAPOP.map.buildForbiddenWords(country, locale)` 汇总所有省名、全称、简称，
`TERRAPOP.map.leaks(text, forbidden)` 判断一个名字是否命中。地图渲染与自检脚本共用这两个函数。

## 6. 判定与匹配（`js/game.js`）

### 6.1 归一化

```
normalize(str) =
  NFKC（全角→半角）→ 繁简/异体词折叠 → 单字折叠 → 去标点空白 →
  去声调（NFD + 去掉组合记号）→ 小写
```

### 6.2 输入集合（`expand`）

一个"原始写法"展开成若干可输入形式：

| 原始 | 展开结果 |
|---|---|
| 石家庄 | `石家庄`、`shijiazhuang`、`sjz` |
| 河北省 | `河北省`、`河北`、`hebeisheng`、`hbs`、`hebei`、`hb` |
| Hebei Province | `hebeiprovince`、`hebei`、`hp` |

每个维度的输入分两层：

- **primary**：正式名称 / 简称 / 省会 + 拼音 + 首字母 → 参与**前缀匹配**
- **extra**：别称（羊城、石头城、盛京、陇右…）→ **只认完整输入**

这样切分的理由：别称的拼音首字母太短（"盛京"→`sj`），会去抢「sjz 石家庄」；分层后
`sj → 石家庄`，而 `盛京 → 沈阳` 依然成立。

### 6.3 匹配（智能输入）

```js
matchInput(pool, dim, locale, input) -> { kind, candidates, unique }
```

输入先展开成**按优先级排列**的等价形态（`queryVariants`）：

1. **只留汉字**（有汉字时优先）：`"津 (jīn)"` → `"津"`
2. 归一化原文：`"津 (jīn)"` → `"津jin"`
3. 只留拉丁：`"jin"`

然后按顺序尝试「完全匹配」，**用第一个能命中的形态**：
这样 `"津 (jīn)"` 会先按汉字命中天津，不会因为 `jin` 同时也是「晋」的拼音而变成多候选。

| kind | 含义 | 客户端行为 |
|---|---|---|
| `empty` | 还没输入 | 等待 |
| `exact` | 恰好等于某个地区的答案，且只有 1 个 | 自动判定 |
| `unique` | 是唯一一个地区的前缀 | 自动判定 |
| `multi` | 有 2 个以上可能 | 列出候选，↑↓ 选 / 点选提交 |
| `none` | 完全匹配不上 | 提示但允许继续输入 |

`unique === true` 时才自动判定；且客户端还会再判一次「唯一的那个是不是正确答案」，
所以「唯一但答错」不会被自动提交。

### 6.4 判定（`judgeText`）

与匹配规则保持一致：

1. 归一化后的任一**等价形态**完全匹配任一可接受写法（含别称）→ 对
2. **多简称整串写**（`川 / 蜀`、`贵/黔`、`沪 (hù) / 申 (shēn)`）逐段判定，每段都对 → 对
3. 是某个 **primary** 写法的前缀 → 对（所以打一个字母、只要无歧义就能判对）
4. 别称不参与前缀匹配
5. 空输入 → `skipped`

> 这条「显示即答案」的约束是硬要求：`简称` 在所有语言下都只显示汉字，
> 自检脚本会断言「界面显示的简称本身就是可接受答案」。曾因为英文界面把注音塞进选项、
> 显示成 `津 (jīn)`，用户照抄就判错——现在这类写法必须判对。

### 6.5 位置判定（`judgeLocation`）

- 点中正确省 → `correct`（1.0）
- 点在**相邻省**（运行时由省界共享边算出的邻接表）→ `close`（0.5）
- 点击点距正确省质心小于该省外接尺寸的一定比例 → `close`（0.5）
- 否则 `wrong`
- 严格模式下不采信相邻省，只认精确命中与质心距离

### 6.6 计分

```
单题基础分 = 100 × 作答方式权重      # 填空/定位 1.0、五选一 0.9、四选一 0.8、三选一 0.7
本次得分   = round(基础分 × 判定比例 × 连击加成)
连击加成   = 1 + min(连击数 - 1, 5) × 0.1      # 答对才连击，答错清零
```

## 7. 出题（`createSession`）

```js
TERRAPOP.game.createSession({ country, known, asked, style, regionIds, judge, adjacency, centers, radius, locale })
  -> { total, pool, next(), submit(answer), accuracy(), remaining(), … }
```

- `pool` = 范围内、且**存在合法 (known, asked) 组合**的地区。
  例如已知/要猜含 `capital` 时，直辖市与港澳台会被自动排除。
- `known` / `asked` 可以为 `"random"`，在每道题上现抽（但保证两者不同、且都真实存在）。
- `style` 为 `choice3/4/5` 时预生成选项（`choices`）；`asked === "location"` 时强制为 `locate`。
- `submit()` 接受统一形状：
  ```js
  { kind: "text",   value: "sjz" }
  { kind: "choice", value: "石家庄" }
  { kind: "locate", regionId: "CN-HE" }
  { kind: "skip" }
  ```
  语音作答未来只需产出同样的对象即可，引擎无需改动。
