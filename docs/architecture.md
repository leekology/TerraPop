# 技术架构

## 约束

目标之一是**双击 `index.html` 用 `file://` 打开就能玩**。这条约束决定了几件事：

- ❌ 不能用 ES module `import`（`file://` 下会被 CORS 拦截）
- ❌ 不能 `fetch()` 本地 JSON / SVG
- ✅ 所有脚本用传统 `<script src>` 标签加载，通过 `window.TERRAPOP` 全局命名空间通信
- ✅ 地图以「SVG path 字符串」的形式打包进 JS，而不是外部 `.svg` 文件
  （`<img src>` 能显示但拿不到 path，无法做命中判定 / 高亮 / 动画）

因此：**无构建工具、无框架、无 npm 依赖**，纯 HTML + CSS + 原生 JS。

## 目录结构

```
index.html                 页面骨架 + 地图容器
LICENSE
README.md
css/
  style.css                羊皮纸主题、布局、动效
js/
  core.js                  命名空间、工具函数（归一化、距离、存储、随机）
  i18n.js                  语言切换与 t() 查表
  locales/
    zh-Hans.js             界面文案（简体中文）
    en.js                  界面文案（英文）
  map.js                   地图渲染、缩放平移、命中判定、高亮、省会标记、地形
  voice.js                 speak() 朗读 + listen() 语音作答 stub
  game.js                  出题、判定、计分、状态机
  app.js                   界面装配、屏幕切换、设置面板
data/
  cn.js                    34 个省级行政区结构化数据（核心 + 别名 + 大区）
  cn.wiki.js               双语百科 / 记忆点 / 趣味知识点
  cn.terrain.js            手绘风格江河湖泊折线（经纬度）
  han-variants.js          简繁与别名归一化映射表
maps/
  cn.js                    生成的省界 path 数据 + 投影参数 + 省会坐标 + 南海插图框
scripts/
  build-map.mjs            地图数据生成脚本（开发期使用，不参与运行时）
  selfcheck.mjs            数据 / 规则自检，node scripts/selfcheck.mjs
  README.md
tests/
  e2e.mjs                  Playwright + Edge headless 端到端验收（需全局 playwright）
docs/
  plan.md  design.md  architecture.md  data-schema.md  i18n.md  attribution.md
```

## 运行时数据流

```
maps/cn.js ──┐
data/cn.js ──┼──► core.js 建立 TERRAPOP 命名空间
locales/*  ──┘
                   │
        map.js 用 maps/cn.js 的 projection 参数
        把 terrain 的经纬度投影到图面 → 生成 <svg>
                   │
        game.js 从 data/cn.js 取题源，生成题目对象
                   │
        app.js 把题目交给控件渲染，收集作答，交给 game.js 判定，
               把判定结果 + data/cn.wiki.js 的百科交给揭示卡
                   │
        voice.js 朗读题面 / 揭示卡（Web Speech API）
```

## 关键接口

### `TERRAPOP.maps.cn`（由 `scripts/build-map.mjs` 生成）

```js
{
  id: "cn",
  names: { "zh-Hans": "中国", "en": "China" },
  viewBox: [0, 0, 1000, 716],
  // 经纬度 → 图面坐标：
  //   x = (lon - lon0) * cosLat * k
  //   y = (lat0 - lat) * k
  projection: { lon0, lat0, k, cosLat },
  regions:  [ { id, adcode, d, label: [x, y], center: [x, y] } ],
  capitals: { "CN-HE": [x, y] },
  inset:    { box: [x, y, w, h], shapes: [ { id, d } ] }
}
```

### `TERRAPOP.countries.cn`（`data/cn.js`）

见 `docs/data-schema.md`。

### `TERRAPOP.wiki.cn`（`data/cn.wiki.js`）

```js
{ "CN-HE": { facts: {locale…}, memo: {locale…}, wiki: {locale…} } }
```

### `TERRAPOP.locales[locale]`（`locales/*.js`）

扁平 key → 字符串，支持 `{n}` 占位符插值。

## 扩展点

- **加语言**：新增 `locales/xx.js`，并在 `data/cn.js` / `data/cn.wiki.js` 里补上该语言的字段。`i18n.js` 会自动把新语言列进切换菜单。
- **加国家**：新增 `maps/<code>.js` 与 `data/<code>.js`（+ `<code>.wiki.js`），在 `index.html` 里加 `<script>`，游戏逻辑无需改动——`game.js` 只依赖 `country.regions` 数组里的统一字段。
- **加题型**：`game.js` 里 `known`/`ask` 是数据驱动的，新增维度只要补一个控件和一个判定函数。

详见 `docs/i18n.md`。

## 验证方式

- **数据与规则自检**：`node scripts/selfcheck.mjs`
  在没有浏览器的环境下加载全部运行时脚本，校验：34 条行政区数据完整性、中英字段齐全、
  百科 34 条三字段双语言非空、地图 id 与行政区 id 一一对应、省会坐标齐全、
  省份标签点落在本省轮廓内、地形折线不越界、邻接表正确（河北的 7 个邻居、港澳与广东相邻）、
  答案判定（简繁折叠、多简称、后缀与拼音容错、宽松/严格位置判定）、
  出题不会问不存在的维度、中英文案 key 完全对齐、代码里用到的文案 key 都有翻译。
- **浏览器端到端**：`NODE_PATH="$(npm root -g)" node tests/e2e.mjs`
  用 Playwright + 系统 Edge（`channel: 'msedge'`）headless 打开 `file://…/index.html`，
  走通「首页配置 → 出题 → 用质心点点击地图 → 填空 → 提交 → 揭示双语百科 → 下一题」，
  覆盖答对 / 答错 / 纯点击 / 英文界面 / 设置面板 / 缩放 / 移动端视口，
  并断言运行期无任何 console error 与资源加载失败；截图输出到 `.tmp/shots/`。
