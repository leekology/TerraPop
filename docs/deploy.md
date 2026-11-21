# 部署与持续集成

## 一、GitHub Pages（自动）

仓库里带了一个开箱可用的工作流：`.github/workflows/pages.yml`。
推到 `main` 就会自动校验 + 部署，也可以在 Actions 页面手动触发（`workflow_dispatch`）。

```
push main / 手动触发
   │
   ├─ job build   校验并组装站点
   │   1. node scripts/selfcheck.mjs        ← 发布闸门
   │   2. 组装 _site/（只带运行时文件）
   │   3. actions/upload-pages-artifact@v3
   │
   └─ job deploy  needs: build
       actions/deploy-pages@v5  →  https://<user>.github.io/<repo>/
```

### 首次启用

1. 仓库 **Settings → Pages → Build and deployment**，Source 选 **GitHub Actions**。
2. 推到 `main`（或在 Actions 里手动跑一次 `Deploy to GitHub Pages`）。
3. 部署完成后，Actions 的 run 页面会给出 `page_url`。

### 为什么发布前只闸 selfcheck

`scripts/selfcheck.mjs` 不依赖浏览器、确定性高，能挡住真正会"发布出去就是坏页面"的问题：
数据缺失、行政区与地图 `id` 不一致、地貌越界、标注泄露省份、判定规则被改坏、
中英文案 key 不对齐、代码里引用了不存在的文案……

浏览器端到端（`tests/e2e.mjs`）涉及真实浏览器与时序，偶发不稳定不该卡住发版，
所以它跑在 `.github/workflows/ci.yml` 里当信号，并把截图作为 artifact 传上来。

### 只发布运行时需要的文件

```
_site/
├── index.html
├── css/  js/  locales/  data/  maps/
├── LICENSE  README.md
└── .nojekyll
```

`docs/ scripts/ tests/ .github/` 不进站点。`.nojekyll` 是为了万一以后改用分支发布时，
Jekyll 不会去处理站点内容。

**子路径无需额外配置**：`index.html` 里所有引用都是相对路径（`css/style.css`、`js/core.js`…），
放在 `https://<user>.github.io/<repo>/` 这种子路径下能直接跑。
这一点有专门的验证：把组装好的站点丢进本地 HTTP 服务的子目录再打开，
断言 16 个子资源全部 200、无 console 报错、能正常开局作答。

### 手动部署（不用 Actions）

任何静态托管都可以，把下面这些文件原样上传即可：

```bash
git clone <this-repo> && cd TerraPop
# 需要上传的就是： index.html css js locales data maps
python3 -m http.server   # 本地预览
```

因为没有任何构建步骤，`file://` 直接双击打开也照样能玩。

## 二、CI（自检 + 端到端）

`.github/workflows/ci.yml`：push 到任意分支、开 PR、手动触发时运行。

- `node scripts/selfcheck.mjs`
- `npm install --no-save --no-package-lock playwright` + `npx playwright install --with-deps chromium`
- `TP_CHANNEL=bundled node tests/e2e.mjs`

浏览器目录用 `actions/cache` 缓存，第二次之后就不用重新下载 Chromium 了。

`tests/e2e.mjs` 的浏览器通道可以通过环境变量切换：

| `TP_CHANNEL` | 行为 |
|---|---|
| 不设（默认） | 用系统 Edge（`channel: 'msedge'`），本地开发用 |
| `bundled` | 用 Playwright 自带的 Chromium，CI 里用 |
| 其它值 | 直接当作 `channel` 传给 Playwright（如 `chrome`） |

本地跑：

```bash
node scripts/selfcheck.mjs
NODE_PATH="$(npm root -g)" node tests/e2e.mjs          # 系统 Edge
TP_CHANNEL=bundled npx playwright install chromium && TP_CHANNEL=bundled node tests/e2e.mjs
```

## 三、本项目不依赖任何 CDN

页面不加载任何外部字体、图标、脚本或地图瓦片——地图是内联 SVG，图标是内联 SVG / CSS 画出来的，
音效是 WebAudio 现场合成。所以：

- 部署到任何静态托管都不会因为墙外资源而变慢或挂掉；
- 断网也能玩；
- 不存在第三方 CDN 的可用性风险。
