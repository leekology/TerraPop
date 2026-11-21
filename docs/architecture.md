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
index.html                 页面骨架 + 信息板容器
LICENSE
README.md
css/
  style.css                卡通清新主题、布局、动效
js/
  core.js                  命名空间、工具（归一化、拼音推导、DOM、存储）
  i18n.js                  语言切换与 t() 查表
  locales/
    zh-Hans.js             界面文案（简体中文）
    en.js                  界面文案（英文）
  map.js                   地图渲染（卡通风 + 地貌）、缩放平移、命中判定、高亮、揭示动画
  voice.js                 speak() 朗读 + listen() 语音作答 stub
  game.js                  玩法矩阵、出题、智能输入匹配、判定、计分
  app.js                   界面装配、一问一答流程、自动下一题、设置、百科详情
data/
  cn.js                    34 个省级行政区结构化数据
  cn.wiki.js               双语百科 / 记忆点 / 趣味知识点
  cn.terrain.js            大江大河大湖 + 高原盆地平原沙漠山脉（经纬度）
  han-initials.js          148 个地名常用字的无声调拼音（支撑智能输入）
  han-variants.js          简繁与异体字折叠表
maps/
  cn.js                    生成的省界 path + 投影参数 + 省会坐标 + 南海插图框
scripts/
  build-map.mjs            地图数据生成脚本（开发期使用，不参与运行时）
  selfcheck.mjs            数据 / 规则自检，node scripts/selfcheck.mjs
  data/                    构建输入数据（随仓库提交，保证可离线复现）
  README.md
tests/
  e2e.mjs                  Playwright + Edge headless 端到端验收（需全局 playwright）
.github/workflows/
  pages.yml                自检 + 组装 _site + 部署到 GitHub Pages
  ci.yml                   自检 + 浏览器端到端（chromium）
docs/
  plan.md  design.md  architecture.md  data-schema.md  i18n.md  deploy.md  attribution.md
```

## 部署

- `.github/workflows/pages.yml`：push `main` → 跑 `scripts/selfcheck.mjs` 当闸门 →
  组装 `_site/`（只带 `index.html css js locales data maps`）→ 部署到 GitHub Pages。
- `.github/workflows/ci.yml`：自检 + 端到端（`TP_CHANNEL=bundled` 走自带 Chromium）。
- 页面内所有引用都是相对路径，放在 `https://<user>.github.io/<repo>/` 子路径下直接可用；
  这一点有专门的验证（把组装好的站点放进本地 HTTP 服务的子目录再打开，断言资源全 200、无报错）。
- 无构建步骤、无 CDN 依赖：`file://` 双击打开也能玩。详见 `docs/deploy.md`。

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
  viewBox: [0, 0, 1000, 718],
  // 经纬度 → 图面坐标：
  //   x = (lon - lon0) * cosLat * k
  //   y = (lat0 - lat) * k
  projection: { lon0, lat0, k, cosLat },
  regions:  [ { id, adcode, d, label: [x, y], center: [x, y] } ],
  capitals: { "CN-HE": [x, y] },
  inset:    { box: [x, y, w, h], shapes: [ { id, d } ] }
}
```

### 地图图层顺序（`js/map.js`）

```
陆地底板（含投影）→ 省界填色层 → 白色描边层 → 深色细线层
→ 地貌层（裁进陆地轮廓：高原/盆地/平原/沙漠/山脉/河流/湖泊）
→ 地貌文字标注 → 聚光灯层 → 高亮标记层 → 省会标记层 → 揭示标签层
→ 插图框 / 港澳放大框
```

- 填色层是唯一可点击的图层（带 `data-id`），其余都是 `pointer-events: none`，
  所以高亮、标注、省会点永远抢不走点击。
- 地貌统一由一个 `clipPath`（所有省界拼成的陆地轮廓）裁剪，手绘椭圆画大也不会溢到海里。
- 地貌画在填色层**之上**并压低不透明度，既能看到大区配色，又能看到地形。
- **聚光灯层**：一个覆盖整幅地图的矩形 + 一个 `<mask>`，已知位置时把 mask 里挖出目标省的洞，
  于是"除了目标省以外全被压了一层白纱"，高亮一眼可见（见 `docs/design.md` 第 6 节）。
- 地貌标注的策略（面状地貌只标类型名；含省名/简称的山河湖名不标）由
  `TERRAPOP.map.buildForbiddenWords()` / `leaks()` 统一决定，自检脚本会验证。

### 侧栏版面（`index.html` / `css/style.css`）

```
.tp-panel
  .tp-panel-head        题号 / 计时 / 连击 / 得分 / 正确率
  .tp-progress-bar      进度
  .tp-prev              上一题卡片：flex: 0 1 var(--prev-h)（232px）、内部滚动
                        （第一题显示玩法说明）
  .tp-current           当前题：固定高度 --block-h（312px）、margin-top: auto 钉在底部
    .tp-current-head    已知信息（32px）+ 题面（32px，22px 加粗）
    .tp-hints           提示（26px，没有提示也占位，避免跳动）
    .tp-answer          作答区：固定高度 200px、固定位置
```

`.tp-current` 的子元素高度全部固定，并且被 `margin-top: auto` 钉在侧栏底部，
所以作答区的屏幕坐标在整局里完全不变（上一题卡片内容长短都影响不到它）；
端到端测试会在连续 6 题里断言这个坐标逐像素一致。
短视口（`max-height: 760px / 680px`）会按档位调小 `--block-h` 与 `--prev-h`，保证不溢出。

### `TERRAPOP.countries.cn`（`data/cn.js`）

见 `docs/data-schema.md`。

### `TERRAPOP.wiki.cn`（`data/cn.wiki.js`）

```js
{ "CN-HE": { memo: {locale…}, facts: {locale…}, wiki: {locale…} } }
```

### `TERRAPOP.game`（`js/game.js`）

```js
MATRIX                 // 12 种「已知 → 要猜」组合
matchInput(pool, dim, locale, input) -> { kind, candidates, unique }
judgeText(target, dim, locale, input) -> { status, ratio }
createSession({ country, known, asked, style, regionIds, judge, adjacency, centers, radius, locale })
```

`createSession().submit(answer)` 接受统一形状 `{kind:'text'|'choice'|'locate'|'skip', value?, regionId?}`，
语音作答只要产出同样的对象就能接进来。

### `TERRAPOP.locales[locale]`（`locales/*.js`）

扁平 key → 字符串，支持 `{n}` 占位符插值。

## 扩展点

- **加语言**：新增 `locales/xx.js`，并在 `data/cn.js` / `data/cn.wiki.js` 里补上该语言的字段。`i18n.js` 会自动把新语言列进切换菜单。
- **加国家**：新增 `maps/<code>.js` 与 `data/<code>.js`（+ `<code>.wiki.js`），在 `index.html` 里加 `<script>`，游戏逻辑无需改动——`game.js` 只依赖 `country.regions` 数组里的统一字段。
- **加题型**：`game.js` 里 `known`/`ask` 是数据驱动的，新增维度只要补一个控件和一个判定函数。

详见 `docs/i18n.md`。

## 验证方式

- **数据与规则自检**：`node scripts/selfcheck.mjs`（80 项）
  在没有浏览器的环境下加载全部运行时脚本，校验：34 条行政区数据完整性、中英字段齐全、
  百科三条目双语言非空、拼音表 148 字全覆盖且能推导出 `sjz / hhht / wlmq / nmg …`、
  地图 id 与行政区 id 一一对应、省份标签点落在本省轮廓内、
  **地貌落点**（每个高原/盆地/平原/沙漠的中心、每条山脉与河流湖泊的顶点都在中国陆地内）、
  **地图标注不泄露省份**（面状地貌只用通用类型名；`黑龙江 / 雅鲁藏布江 / 青海湖 / 滇池 / 秦岭`
  这类含省名或简称的名字会被识别出来并跳过）、
  邻接表正确、**智能输入**（`sj→石家庄`、`hn` 歧义给候选、别称只在完整输入时生效、繁简折叠、前缀判定）、
  **玩法矩阵正交完备**（12 组合 × 4 作答方式 = 48 种配置都能出题且题型正确、随机模式不会问自己）、
  计分权重随作答方式难度递增、中英文案 key 完全对齐、代码里用到的文案 key 都有翻译。
- **浏览器端到端**：`NODE_PATH="$(npm root -g)" node tests/e2e.mjs`
  用 Playwright + 系统 Edge（`channel: 'msedge'`）headless 打开 `file://…/index.html`，
  重点验收**位置固定 + 零阻断**：
  - 第一题上方卡片是玩法说明
  - 打拼音首字母后**同一 tick 内就换到下一题**（断言无需等待、无弹窗、无需点「继续」）
  - **连续 6 题的作答区屏幕坐标逐像素一致**；选择题的首个选项坐标也一致
  - 选择题满足「问题在上、选项在下」，两列网格
  - 已知位置时聚光灯与高亮描边都在，地貌完整，图上没有任何泄露省份的标注
  - 上一题卡片含四维信息 + 记忆点 / 趣味知识 / 双语百科三段
  - 定位点选、缩放、英文界面、设置面板、**12 组合 × 3 作答方式 = 36 种配置冒烟**、移动端堆叠
  - 运行期无任何 console error / pageerror / 资源加载失败；截图输出到 `.tmp/shots/`
