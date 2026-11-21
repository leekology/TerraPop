// TerraPop · 中国 地形地貌数据（手绘风格，非测绘精度）
// ---------------------------------------------------------------
// 纯经纬度，运行时用 maps/cn.js 的 projection 参数投影到图面，
// 保证与省界坐标系统完全一致。
//   rivers   : 折线（大江大河，width 为线宽示意）
//   lakes    : 闭合多边形（4~12 点，示意湖形）
//   landforms: 椭圆近似（plateau | basin | plain | desert | hills）
//   ranges   : 沿折线摆放的山形符号簇
// 坐标一律为 [经度, 纬度]。
// ---------------------------------------------------------------

window.TERRAPOP = window.TERRAPOP || {};
window.TERRAPOP.terrain = window.TERRAPOP.terrain || {};

window.TERRAPOP.terrain.cn = {
  // ── 1. 河流 ─────────────────────────────────────────────────
  rivers: [
    {
      id: "changjiang",
      names: { "zh-Hans": "长江", en: "Yangtze River" },
      width: 6,
      points: [
        [90.9, 33.5], [92.5, 33.8], [94.5, 33.2], [96.5, 32.8], [97.5, 31.8],
        [98.7, 30.3], [99.3, 28.6], [99.9, 27.0], [100.9, 26.2], [101.8, 26.6],
        [102.8, 27.3], [103.9, 28.3], [104.7, 28.9], [105.8, 29.0], [106.6, 29.7],
        [107.5, 30.2], [108.5, 30.6], [109.5, 30.8], [110.5, 30.9], [111.4, 30.7],
        [112.5, 30.4], [113.5, 30.4], [114.3, 30.6], [115.2, 30.2], [116.0, 29.7],
        [116.7, 30.1], [117.3, 30.8], [118.0, 31.4], [118.9, 32.1], [119.9, 32.2],
        [120.9, 31.9], [121.6, 31.4]
      ]
    },
    {
      id: "huanghe",
      names: { "zh-Hans": "黄河", en: "Yellow River" },
      width: 5.5,
      points: [
        [96.0, 34.9], [97.5, 34.6], [99.5, 34.5], [100.9, 34.1], [102.0, 34.0],
        [102.7, 35.0], [103.5, 35.6], [103.8, 36.1], [104.3, 36.6], [105.3, 37.6],
        [106.4, 38.6], [107.4, 39.5], [108.6, 40.1], [109.8, 40.7], [110.9, 40.5],
        [111.3, 40.2], [110.9, 39.0], [110.5, 37.8], [110.4, 36.0], [110.3, 35.2],
        [110.4, 34.7], [111.4, 34.8], [112.5, 34.9], [113.7, 34.9], [114.4, 34.9],
        [115.2, 35.7], [116.1, 36.4], [117.0, 36.8], [118.2, 37.3], [119.0, 37.8]
      ]
    },
    {
      id: "zhujiang",
      names: { "zh-Hans": "珠江", en: "Pearl River" },
      width: 5,
      points: [
        [102.5, 24.4], [104.0, 24.3], [105.3, 24.7], [106.5, 24.0], [107.4, 23.7],
        [108.4, 23.0], [109.6, 23.2], [110.3, 23.5], [111.3, 23.6], [112.2, 23.3],
        [112.6, 23.1], [113.2, 23.1], [113.5, 22.8], [113.7, 22.4]
      ]
    },
    {
      id: "heilongjiang",
      names: { "zh-Hans": "黑龙江", en: "Amur River" },
      width: 5,
      points: [
        [121.0, 53.2], [123.5, 53.0], [125.7, 52.6], [126.5, 51.5], [127.5, 50.2],
        [128.7, 49.4], [130.0, 48.5], [131.3, 48.0], [132.5, 47.7], [133.6, 48.0],
        [134.7, 48.4]
      ]
    },
    {
      id: "songhuajiang",
      names: { "zh-Hans": "松花江", en: "Songhua River" },
      width: 4.5,
      points: [
        [127.6, 42.1], [126.9, 43.5], [126.6, 44.8], [126.6, 45.8], [128.0, 46.3],
        [129.5, 46.7], [130.8, 47.2], [131.9, 47.6], [132.5, 47.7]
      ]
    },
    {
      id: "huaihe",
      names: { "zh-Hans": "淮河", en: "Huai River" },
      width: 4,
      points: [
        [113.4, 32.4], [114.3, 32.3], [115.5, 32.5], [116.5, 32.7], [117.4, 32.9],
        [118.4, 33.2], [119.0, 33.4], [119.5, 33.5]
      ]
    },
    {
      id: "lancangjiang",
      names: { "zh-Hans": "澜沧江", en: "Lancang (Mekong) River" },
      width: 4.5,
      points: [
        [94.5, 33.5], [96.2, 32.3], [97.3, 31.2], [98.5, 29.5], [99.2, 27.5],
        [100.0, 25.5], [100.8, 23.5], [101.0, 22.0]
      ]
    },
    {
      id: "yaluzangbujiang",
      names: { "zh-Hans": "雅鲁藏布江", en: "Yarlung Tsangpo" },
      width: 4.5,
      points: [
        [82.3, 30.4], [85.0, 29.7], [87.5, 29.3], [89.5, 29.3], [91.2, 29.3],
        [93.5, 29.4], [95.0, 29.3], [95.3, 28.6]
      ]
    },
    {
      id: "tarimhe",
      names: { "zh-Hans": "塔里木河", en: "Tarim River" },
      width: 4,
      points: [
        [80.3, 40.6], [82.0, 40.7], [84.0, 41.0], [86.0, 41.0], [87.5, 40.6],
        [88.3, 40.0]
      ]
    }
  ],

  // ── 2. 湖泊 ─────────────────────────────────────────────────
  lakes: [
    {
      id: "qinghaihu",
      names: { "zh-Hans": "青海湖", en: "Qinghai Lake" },
      points: [[99.6, 37.0], [100.2, 37.2], [100.9, 37.05], [101.0, 36.7], [100.4, 36.5], [99.8, 36.65]]
    },
    {
      id: "poyanghu",
      names: { "zh-Hans": "鄱阳湖", en: "Poyang Lake" },
      points: [[115.9, 29.7], [116.3, 29.55], [116.35, 29.1], [116.6, 28.75], [116.2, 28.65], [115.95, 28.9], [115.85, 29.35]]
    },
    {
      id: "dongtinghu",
      names: { "zh-Hans": "洞庭湖", en: "Dongting Lake" },
      points: [[112.3, 29.45], [112.9, 29.5], [113.2, 29.2], [112.95, 28.85], [112.45, 28.85], [112.05, 29.15]]
    },
    {
      id: "taihu",
      names: { "zh-Hans": "太湖", en: "Lake Tai" },
      points: [[119.9, 31.4], [120.45, 31.4], [120.55, 31.05], [120.15, 30.9], [119.85, 31.05]]
    },
    {
      id: "hongzehu",
      names: { "zh-Hans": "洪泽湖", en: "Hongze Lake" },
      points: [[118.2, 33.55], [118.7, 33.5], [118.85, 33.15], [118.5, 33.0], [118.15, 33.2]]
    },
    {
      id: "chaohu",
      names: { "zh-Hans": "巢湖", en: "Chao Lake" },
      points: [[117.3, 31.75], [117.65, 31.7], [117.75, 31.5], [117.45, 31.4], [117.25, 31.5]]
    },
    {
      id: "hulunhu",
      names: { "zh-Hans": "呼伦湖", en: "Hulun Lake" },
      points: [[116.9, 49.2], [117.7, 49.25], [118.0, 48.9], [117.6, 48.55], [117.0, 48.65]]
    },
    {
      id: "dianchi",
      names: { "zh-Hans": "滇池", en: "Dianchi Lake" },
      points: [[102.55, 24.95], [102.85, 24.9], [102.9, 24.7], [102.6, 24.65], [102.5, 24.8]]
    },
    {
      id: "erhai",
      names: { "zh-Hans": "洱海", en: "Erhai Lake" },
      points: [[100.13, 26.0], [100.28, 25.95], [100.3, 25.6], [100.15, 25.55], [100.08, 25.8]]
    },
    {
      id: "namucuo",
      names: { "zh-Hans": "纳木错", en: "Namtso" },
      points: [[90.3, 30.95], [90.85, 30.9], [91.0, 30.6], [90.6, 30.5], [90.25, 30.7]]
    },
    {
      id: "bositeng",
      names: { "zh-Hans": "博斯腾湖", en: "Bosten Lake" },
      points: [[86.6, 42.05], [87.2, 42.0], [87.4, 41.75], [87.0, 41.65], [86.55, 41.8]]
    },
    {
      id: "xingkaihu",
      names: { "zh-Hans": "兴凯湖", en: "Khanka Lake" },
      points: [[132.35, 45.22], [132.85, 45.2], [132.85, 45.4], [132.4, 45.42]]
    },
    {
      id: "changbaishantianchi",
      names: { "zh-Hans": "长白山天池", en: "Heaven Lake" },
      points: [[127.82, 42.16], [127.95, 42.12], [127.94, 42.05], [127.82, 42.04], [127.76, 42.1]]
    }
  ],

  // ── 3. 面状地貌（椭圆近似）─────────────────────────────────
  landforms: [
    {
      id: "qingzang",
      names: { "zh-Hans": "青藏高原", en: "Tibetan Plateau" },
      kind: "plateau", center: [88.0, 32.5], rx: 12.0, ry: 4.5, rot: -8, label: true
    },
    {
      id: "neimenggu",
      names: { "zh-Hans": "内蒙古高原", en: "Inner Mongolian Plateau" },
      kind: "plateau", center: [112.0, 42.5], rx: 9.0, ry: 3.2, rot: 4, label: true
    },
    {
      id: "huangtu",
      names: { "zh-Hans": "黄土高原", en: "Loess Plateau" },
      kind: "plateau", center: [108.5, 36.5], rx: 5.5, ry: 2.6, rot: 0, label: true
    },
    {
      id: "yungui",
      names: { "zh-Hans": "云贵高原", en: "Yunnan-Guizhou Plateau" },
      kind: "plateau", center: [104.0, 25.5], rx: 5.0, ry: 2.8, rot: 0, label: true
    },
    {
      id: "talimu",
      names: { "zh-Hans": "塔里木盆地", en: "Tarim Basin" },
      kind: "basin", center: [83.0, 39.8], rx: 6.0, ry: 2.6, rot: 0, label: true
    },
    {
      id: "zhungeer",
      names: { "zh-Hans": "准噶尔盆地", en: "Junggar Basin" },
      kind: "basin", center: [86.5, 45.2], rx: 5.0, ry: 2.2, rot: 0, label: true
    },
    {
      id: "chaidamu",
      names: { "zh-Hans": "柴达木盆地", en: "Qaidam Basin" },
      kind: "basin", center: [94.0, 37.5], rx: 4.5, ry: 1.8, rot: 0, label: true
    },
    {
      id: "sichuan",
      names: { "zh-Hans": "四川盆地", en: "Sichuan Basin" },
      kind: "basin", center: [105.5, 30.5], rx: 3.8, ry: 2.0, rot: 0, label: true
    },
    {
      id: "dongbei",
      names: { "zh-Hans": "东北平原", en: "Northeast China Plain" },
      kind: "plain", center: [124.5, 45.5], rx: 5.0, ry: 3.5, rot: 0, label: true
    },
    {
      id: "huabei",
      names: { "zh-Hans": "华北平原", en: "North China Plain" },
      kind: "plain", center: [116.5, 36.5], rx: 4.5, ry: 3.2, rot: 0, label: true
    },
    {
      id: "changjiangzhongxiayou",
      names: { "zh-Hans": "长江中下游平原", en: "Middle-Lower Yangtze Plain" },
      kind: "plain", center: [117.5, 31.5], rx: 4.5, ry: 1.8, rot: 0, label: true
    },
    {
      id: "takelamagan",
      names: { "zh-Hans": "塔克拉玛干沙漠", en: "Taklamakan Desert" },
      kind: "desert", center: [83.0, 39.2], rx: 4.3, ry: 1.6, rot: 0, label: true
    },
    {
      id: "dongnanqiuling",
      names: { "zh-Hans": "东南丘陵", en: "Southeast China Hills" },
      kind: "hills", center: [116.5, 26.0], rx: 4.0, ry: 2.5, rot: 0, label: true
    }
  ],

  // ── 4. 山脉（沿折线摆放山形符号）───────────────────────────
  ranges: [
    {
      id: "tianshan",
      names: { "zh-Hans": "天山", en: "Tian Shan" },
      points: [[80.6, 42.2], [82.5, 42.4], [84.5, 42.7], [86.5, 43.0], [88.5, 43.2]],
      size: 1.0, label: true
    },
    {
      id: "altaishan",
      names: { "zh-Hans": "阿尔泰山", en: "Altai Mountains" },
      points: [[86.4, 48.4], [87.6, 48.7], [88.6, 48.2], [89.4, 47.8], [90.3, 47.3]],
      size: 0.9, label: true
    },
    {
      id: "kunlunshan",
      names: { "zh-Hans": "昆仑山", en: "Kunlun Mountains" },
      points: [[80.5, 36.1], [83.0, 36.2], [86.0, 36.0], [89.0, 36.0], [92.0, 36.2], [95.0, 36.2]],
      size: 1.0, label: true
    },
    {
      id: "ximalayashan",
      names: { "zh-Hans": "喜马拉雅山", en: "Himalayas" },
      points: [[82.0, 30.6], [85.5, 29.8], [88.5, 29.0], [91.5, 28.6], [94.0, 29.2]],
      size: 1.0, label: true
    },
    {
      id: "qilianshan",
      names: { "zh-Hans": "祁连山", en: "Qilian Mountains" },
      points: [[95.5, 38.8], [98.0, 38.5], [100.5, 38.0], [102.0, 37.3]],
      size: 0.9, label: true
    },
    {
      id: "qinling",
      names: { "zh-Hans": "秦岭", en: "Qinling Mountains" },
      points: [[105.0, 33.8], [107.5, 33.7], [110.0, 33.6], [112.0, 33.9]],
      size: 0.9, label: true
    },
    {
      id: "daxinganling",
      names: { "zh-Hans": "大兴安岭", en: "Greater Khingan Range" },
      points: [[121.5, 52.5], [122.5, 50.5], [122.0, 48.5], [120.5, 47.0], [119.5, 45.5]],
      size: 1.0, label: true
    },
    {
      id: "xiaoxinganling",
      names: { "zh-Hans": "小兴安岭", en: "Lesser Khingan Range" },
      points: [[127.0, 48.8], [128.5, 48.5], [130.0, 47.8], [131.5, 47.0]],
      size: 0.8, label: true
    },
    {
      id: "changbaishan",
      names: { "zh-Hans": "长白山", en: "Changbai Mountains" },
      points: [[127.2, 42.4], [128.3, 42.5], [129.5, 42.9], [130.3, 43.3]],
      size: 0.9, label: true
    },
    {
      id: "taihangshan",
      names: { "zh-Hans": "太行山", en: "Taihang Mountains" },
      points: [[113.6, 40.0], [113.4, 38.5], [113.0, 37.0], [113.5, 35.8]],
      size: 0.9, label: true
    },
    {
      id: "yinshan",
      names: { "zh-Hans": "阴山", en: "Yinshan Mountains" },
      points: [[107.5, 41.5], [110.0, 41.3], [112.5, 41.0], [114.0, 41.0]],
      size: 0.8, label: true
    },
    {
      id: "helanshan",
      names: { "zh-Hans": "贺兰山", en: "Helan Mountains" },
      points: [[105.9, 39.2], [106.1, 38.5], [106.0, 38.0]],
      size: 0.7, label: true
    },
    {
      id: "hengduanshan",
      names: { "zh-Hans": "横断山", en: "Hengduan Mountains" },
      points: [[98.5, 32.5], [99.5, 30.5], [100.0, 28.5], [100.5, 26.5]],
      size: 1.0, label: true
    },
    {
      id: "nanling",
      names: { "zh-Hans": "南岭", en: "Nanling Mountains" },
      points: [[110.5, 25.3], [112.5, 25.1], [114.5, 25.3], [116.0, 25.8], [117.5, 26.0]],
      size: 0.8, label: true
    },
    {
      id: "wuyishan",
      names: { "zh-Hans": "武夷山", en: "Wuyi Mountains" },
      points: [[117.8, 28.3], [117.3, 27.0], [116.8, 25.7], [116.5, 24.8]],
      size: 0.8, label: true
    },
    {
      id: "dabieshan",
      names: { "zh-Hans": "大别山", en: "Dabie Mountains" },
      points: [[114.0, 31.7], [115.5, 31.6], [116.5, 31.1]],
      size: 0.8, label: true
    }
  ]
};
