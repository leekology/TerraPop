# scripts/data/ —— 地图构建的输入数据

这两个文件是 `scripts/build-map.mjs` 的**输入**，随仓库一起提交，让地图资源可以在完全离线的情况下复现。

| 文件 | 内容 | 来源 |
|---|---|---|
| `cn-province-boundaries.json` | 中国 34 个省级行政区 + 九段线的边界几何（FeatureCollection，35 个 feature，坐标 `[lon, lat]`） | DataV.GeoAtlas `https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json`（转发自高德地图行政区划数据） |
| `cn-capitals.json` | 34 项「省份 id → 省会/首府 `[lon, lat]`」，用于在地图上打城市标记点 | 本项目手工整理 |

## 授权提醒

`cn-province-boundaries.json` **不是本项目原创数据**，其权利归原始提供方，**不在项目的 MIT 授权范围内**。
详见仓库根目录 `LICENSE` 末尾说明与 `docs/attribution.md`。

## 更新方式

```bash
curl --noproxy '*' -o scripts/data/cn-province-boundaries.json \
  https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
node scripts/build-map.mjs
```

（本机环境的 proxy 变量是坏的，所以需要 `--noproxy '*'`。）
