# TerraPop

> 省 / 市 简称 · 省会 · 位置 —— 手绘羊皮纸风中国地图竞猜记忆游戏。

一张中土奇幻风格的手绘中国地图，把「省全称 ↔ 简称 ↔ 省会 ↔ 地理位置」四者的对应关系
变成可玩的记忆游戏。每答一题都揭示**双语百科 + 记忆点**，把猜谜变成记忆加固。

## 特性

- 🗺️ **手绘羊皮纸地图**：34 个省级行政区（含港澳台）、大江大河、主要湖泊、南海诸岛插图框
- 🎯 **四维竞猜引擎**：已知「全称 / 简称 / 省会 / 位置」之一，猜其余
- 🖱️ **位置靠点**：鼠标或触摸点地图，带「接近」容差的宽容判定
- 🃏 **答完即揭示**：地图高亮 + 四维信息翻牌 + **双语百科与记忆点**
- 🌏 **多语言**：中英文界面，双语并排的百科，架构支持继续扩展语言与国家
- 🎙️ **语音**：朗读题面与答案；语音作答已预留接口（stub）
- 📴 **完全离线**：零依赖、无构建、无后端，双击 `index.html` 即可运行

## 快速开始

```bash
git clone <this-repo>
cd TerraPop
open index.html          # macOS；或直接双击 index.html
```

不需要 `npm install`，不需要起服务器。

> 如果你更习惯本地 HTTP 服务：`python3 -m http.server` 后访问 `http://localhost:8000`
> （两种方式都支持，`file://` 直开是本项目的硬性目标）

## 目录结构

```
index.html          页面骨架
css/style.css       羊皮纸主题与动效
js/                 应用逻辑（core / i18n / map / game / app / voice）
locales/            界面文案（zh-Hans / en）
data/               省级核心数据、双语百科、地形装饰
maps/               生成好的省界 path 数据
scripts/            地图生成脚本 + 数据自检（开发期使用）
tests/              浏览器端到端验收（开发期使用）
docs/               计划、设计、架构、数据模型、i18n、授权说明
```

详细说明见 [`docs/`](docs/)：

- [项目计划](docs/plan.md)
- [产品与交互设计](docs/design.md)
- [技术架构](docs/architecture.md)
- [数据模型与判定规则](docs/data-schema.md)
- [多语言与多国家扩展](docs/i18n.md)
- [数据来源与授权](docs/attribution.md)

## 重新生成地图数据

```bash
node scripts/build-map.mjs
```

详见 [`scripts/README.md`](scripts/README.md)。

## 开发 / 自检

```bash
node scripts/selfcheck.mjs                              # 数据完整性与判定规则
NODE_PATH="$(npm root -g)" node tests/e2e.mjs           # 浏览器端到端（需全局 playwright + Edge）
```

两个脚本都只依赖 Node 与已安装的全局 Playwright，**不是运行依赖**，`index.html` 本身依旧零依赖。
端到端跑完会把各步骤截图写到 `.tmp/shots/`。

## 授权

代码 [MIT](LICENSE)。地图边界数据派生自 DataV.GeoAtlas（高德地图数据），
**不在 MIT 范围内**，详见 [docs/attribution.md](docs/attribution.md)。
