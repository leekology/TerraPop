# scripts/ —— 构建脚本

## build-map.mjs

零依赖的 Node 脚本，生成 TerraPop 用的「中国省级地图」资源 `maps/cn.js`。
不联网、不装包，只用 Node 内置模块（需要 Node ≥ 18，本机 v22 已验证）。

```bash
node scripts/build-map.mjs
```

运行后会：

- 写出 `maps/cn.js`（普通脚本，可用 `<script src="maps/cn.js">` 在 `file://` 下直接加载）；
- 写出 `.tmp/cn-preview.svg`（**仅供人工肉眼检查**，`.tmp/` 已在 `.gitignore` 里）；
- 在终端打印构建报告（见下方「校验」）。

## 输入数据

| 文件 | 说明 |
| --- | --- |
| `.tmp/cn_full.json` | DataV.GeoAtlas `https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json`。FeatureCollection，35 个 feature：34 个省级行政区 + 一个 `properties.adcode === "100000_JD"` 的九段线。几何为 `Polygon`/`MultiPolygon`，坐标是 `[lon, lat]`，未投影。 |
| `.tmp/capitals.json` | 34 项「省份 id → 省会 `[lon, lat]`」，`_comment` 等以 `_` 开头的键会被跳过。 |

这两个文件是**预置输入**，脚本不会去下载它们。真要重新下载时才需要联网，且本机 proxy 变量是坏的，得绕过代理：

```bash
curl --noproxy '*' -o .tmp/cn_full.json https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
```

## 输出格式（`maps/cn.js`）

```js
window.TERRAPOP = window.TERRAPOP || {};
window.TERRAPOP.maps = window.TERRAPOP.maps || {};
window.TERRAPOP.maps.cn = {
  id: "cn",
  names: { "zh-Hans": "中国", en: "China" },
  viewBox: [0, 0, 1000, 718],                    // 主图坐标空间，整数
  projection: { lon0: 73.2, lat0: 53.8, k: 19.626601, cosLat: 0.819152 },
  regions: [
    { id: "CN-HE", adcode: 130000, d: "M12.3 45.6L...Z", label: [x, y], center: [x, y] },
    /* ... 共 34 项 ... */
  ],
  capitals: { "CN-HE": [x, y], /* ... 共 34 项 ... */ },
  inset: {
    box: [860.9, 522, 131.1, 188],
    shapes: [ { id: "CS-jd", d: "M..." }, { id: "CN-HI-i0", d: "M..." } /* ... */ ]
  }
};
```

## 投影公式

主图和插图用的是同一套公式，运行时代码照抄即可：

```js
x = (lon - lon0) * cosLat * k;
y = (lat0  - lat)  * k;
```

其中 `cosLat = cos(35°) ≈ 0.819152`（等距圆柱投影在 35°N 附近的比例修正），
`lon0 / lat0` 取主图左上角，所以主图左上角是 `(0, 0)`、右下角是 `(viewBox[2], viewBox[3])`。

**插图**：`inset.shapes` 里的坐标**已经**换算到主图坐标空间，直接 `<path d>` 画就行，
不需要再套任何 transform；它们都落在 `inset.box` 矩形内（脚本里有断言）。

## 参数含义

脚本顶部是可调常量：

| 常量 | 默认 | 含义 |
| --- | --- | --- |
| `MAIN.lon0 / lat0 / lon1 / lat1` | `73.2 / 53.8 / 135.4 / 17.2` | 主图取景范围（度）。`17.2` 以南的南海诸岛不进主图，改放插图。 |
| `MAIN.width` | `1000` | 主图目标宽度（图上单位）。`k` 由它反推，`viewBox` 高度由 `k` 算出后取整。 |
| `TOL_MAIN` | `0.02` | 大环的 Douglas–Peucker 容差（度）。 |
| `TOL_SMALL` | `0.01` | 小环（岛屿）的容差（度），收紧以免小岛被抹平。 |
| `SMALL_RING_SPAN` | `0.6` | 包围盒最长边小于此值（度）就按「小环」处理。 |
| `INSET.lonMin/lonMax/latMin/latMax` | `105 / 125 / 2 / 25.5` | 插图的经纬窗口。见下方「与需求示例的差异」。 |
| `INSET.k` | `8` | 插图投影比例（图上单位 / 度），决定插图框大小。 |
| `INSET.margin` | `8` | 插图框距主图右下的内边距。 |
| `INSET.tol` | `0.01` | 插图内环的简化容差。 |
| `ADCODE_TO_ID` | 34 项 | adcode → 省份 id 对照表，严格按需求指定，脚本会校验数据里是否齐全。 |

## 处理流程

1. **取环**：只取每个多边形的外环。本数据集**没有洞（holes）**，所有环都首尾闭合，但有若干连续重复点，脚本会去重。
2. **裁剪到主图**：完全落在纬度 `17.2` 以南的环从所属省份的主图几何中**剔除**，改放插图（实测只有海南省的 129 个南海小岛属于此类；九段线 feature 本来就不进 `regions`）。
3. **简化**：自实现 Douglas–Peucker（显式栈，不引依赖）。闭合环先从环上找离起点最远的点把环劈成两段再分别简化，避免首尾重合导致退化的基准线段。
   简化后若点数不足以构成三角形，则用原环上 3 个均匀点兜底，保证小岛不会「消失」。
4. **投影 + 取整**：投影后四舍五入到 **1 位小数**，`d` 里只有 `M/L/Z`，除坐标分隔的单个空格外没有任何多余空格。
5. **插图**：九段线（`CS-jd`）与南移的海南诸岛（`CN-HI-i0 … CN-HI-i128`）用独立的放大投影塞进右下角的 `inset.box`。

## 校验

脚本跑完会打印并校验：

- `regions` 恰好 34 项、`id` 唯一、`adcode → id` 与对照表完全一致；
- `capitals` 恰好 34 项，`capitals.json` 里每个键（除 `_` 开头的）都成功投影，且与 `regions` 的 id 集合一致；
- 主图/插图的环数与输入一致（证明没有小岛被简化掉）；
- 每个 `d` 的语法（只含 `M/L/Z`、1 位小数、单一空格、以 `Z` 闭合）；
- 插图所有点都落在 `inset.box` 内；
- 文件字节数与坐标点总数。

任一校验失败会以退出码 1 结束。此外还可以：

```bash
node --check maps/cn.js            # 产物语法
xmllint --noout .tmp/cn-preview.svg # 预览 SVG 语法
open .tmp/cn-preview.svg           # 肉眼确认（描边 + 省份 id 文字 + 省会红点 + 插图框）
```

## 注意事项 / 已知取舍

- **填充规则**：每个 region 的 `d` 是若干**互不重叠、方向可能不一致**的简单环拼起来的并集。因为本数据集没有洞、脚本也只保留外环，用浏览器的默认 `fill-rule: nonzero` 就能正确填充，不会出现自交空洞。如果换成含洞的数据源，需要把内环一起输出并保证方向相反。
- **插图经纬窗口与需求示例的差异**：需求建议的窗口是经度 105–125、纬度 2–23，但九段线最北到 **24.59°N**（台湾以东那一段），按 23 会被裁掉。脚本因此把窗口放宽到纬度 **2–25.5**，经度仍取 105–125（实测内容范围是 108.20–122.80°E、3.40–24.59°N）。
- **`viewBox` 高度是算出来的整数**（`(53.8-17.2) * k` 取整 = `718`），不是需求示例里的 716；主图最南端（纬度 17.2）实际在 `y ≈ 718.33`，超出被裁 0.33 个单位，肉眼不可见。
- **`k` 与 `cosLat` 在产物里保留 6 位小数**，用它重新投影的误差远小于 0.001 个单位。
- 简化会让轮廓相对原始数据内缩最多约 `TOL`（实测最大 0.357 个单位 ≈ 0.018°，来自山西省）。
- 省会/`label` 在轴上都是按主图投影算的，含港澳等小行政区在内全部 34 个点都落在本省几何内（已用点在多边形内的测试验证）。
