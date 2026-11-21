// TerraPop · 中国省级行政区 结构化数据
// ---------------------------------------------------------------
// 只放"事实性"字段：名称、简称、省会（首府）、类型、大区、别名。
// 描述性内容（百科 / 记忆点 / 趣味知识点）在 data/cn.wiki.js，便于独立增补与翻译。
//
// 字段约定见 docs/data-schema.md。
//   type:        province | autonomous | municipality | sar
//   capitalTerm: capital(省会) | seat(首府) | none(不设省会)
//   short[]:     可能多个简称（如 川 / 蜀），填空时全部接受
// ---------------------------------------------------------------

window.TERRAPOP = window.TERRAPOP || {};
window.TERRAPOP.countries = window.TERRAPOP.countries || {};

window.TERRAPOP.countries.cn = {
  id: "cn",
  names: { "zh-Hans": "中国", en: "China" },
  mapId: "cn",
  defaultLocale: "zh-Hans",

  regions: [
    // ── 华北 ────────────────────────────────────────────────────
    {
      id: "CN-BJ", adcode: 110000, type: "municipality", group: "north",
      names: { "zh-Hans": "北京", en: "Beijing" },
      fullNames: { "zh-Hans": "北京市", en: "Beijing Municipality" },
      pinyin: "Běijīng",
      short: [{ char: "京", pinyin: "jīng" }],
      capital: null, capitalPinyin: null, capitalTerm: "none",
      capitalNote: { "zh-Hans": "直辖市，市政府驻地即本市", en: "Municipality — the city itself is the seat of government" },
      aliases: { "zh-Hans": ["首都"], en: ["Peking"] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },
    {
      id: "CN-TJ", adcode: 120000, type: "municipality", group: "north",
      names: { "zh-Hans": "天津", en: "Tianjin" },
      fullNames: { "zh-Hans": "天津市", en: "Tianjin Municipality" },
      pinyin: "Tiānjīn",
      short: [{ char: "津", pinyin: "jīn" }],
      capital: null, capitalPinyin: null, capitalTerm: "none",
      capitalNote: { "zh-Hans": "直辖市，市政府驻地即本市", en: "Municipality — the city itself is the seat of government" },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },
    {
      id: "CN-HE", adcode: 130000, type: "province", group: "north",
      names: { "zh-Hans": "河北", en: "Hebei" },
      fullNames: { "zh-Hans": "河北省", en: "Hebei Province" },
      pinyin: "Héběi",
      short: [{ char: "冀", pinyin: "jì" }],
      capital: { "zh-Hans": "石家庄", en: "Shijiazhuang" },
      capitalPinyin: "Shíjiāzhuāng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["石市"], en: [] }
    },
    {
      id: "CN-SX", adcode: 140000, type: "province", group: "north",
      names: { "zh-Hans": "山西", en: "Shanxi" },
      fullNames: { "zh-Hans": "山西省", en: "Shanxi Province" },
      pinyin: "Shānxī",
      short: [{ char: "晋", pinyin: "jìn" }],
      capital: { "zh-Hans": "太原", en: "Taiyuan" },
      capitalPinyin: "Tàiyuán", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["并州"], en: [] }
    },
    {
      id: "CN-NM", adcode: 150000, type: "autonomous", group: "north",
      names: { "zh-Hans": "内蒙古", en: "Inner Mongolia" },
      fullNames: { "zh-Hans": "内蒙古自治区", en: "Inner Mongolia Autonomous Region" },
      pinyin: "Nèiměnggǔ",
      short: [{ char: "内蒙古", pinyin: "nèiměnggǔ" }, { char: "蒙", pinyin: "měng" }],
      capital: { "zh-Hans": "呼和浩特", en: "Hohhot" },
      capitalPinyin: "Hūhéhàotè", capitalTerm: "seat",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": ["内蒙"], en: ["Nei Mongol"] },
      capitalAliases: { "zh-Hans": ["呼市", "青城"], en: ["Huhehaote"] }
    },

    // ── 东北 ────────────────────────────────────────────────────
    {
      id: "CN-LN", adcode: 210000, type: "province", group: "northeast",
      names: { "zh-Hans": "辽宁", en: "Liaoning" },
      fullNames: { "zh-Hans": "辽宁省", en: "Liaoning Province" },
      pinyin: "Liáoníng",
      short: [{ char: "辽", pinyin: "liáo" }],
      capital: { "zh-Hans": "沈阳", en: "Shenyang" },
      capitalPinyin: "Shěnyáng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["盛京"], en: ["Mukden"] }
    },
    {
      id: "CN-JL", adcode: 220000, type: "province", group: "northeast",
      names: { "zh-Hans": "吉林", en: "Jilin" },
      fullNames: { "zh-Hans": "吉林省", en: "Jilin Province" },
      pinyin: "Jílín",
      short: [{ char: "吉", pinyin: "jí" }],
      capital: { "zh-Hans": "长春", en: "Changchun" },
      capitalPinyin: "Chángchūn", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },
    {
      id: "CN-HL", adcode: 230000, type: "province", group: "northeast",
      names: { "zh-Hans": "黑龙江", en: "Heilongjiang" },
      fullNames: { "zh-Hans": "黑龙江省", en: "Heilongjiang Province" },
      pinyin: "Hēilóngjiāng",
      short: [{ char: "黑", pinyin: "hēi" }],
      capital: { "zh-Hans": "哈尔滨", en: "Harbin" },
      capitalPinyin: "Hā'ěrbīn", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["冰城"], en: [] }
    },

    // ── 华东 ────────────────────────────────────────────────────
    {
      id: "CN-SH", adcode: 310000, type: "municipality", group: "east",
      names: { "zh-Hans": "上海", en: "Shanghai" },
      fullNames: { "zh-Hans": "上海市", en: "Shanghai Municipality" },
      pinyin: "Shànghǎi",
      short: [{ char: "沪", pinyin: "hù" }, { char: "申", pinyin: "shēn" }],
      capital: null, capitalPinyin: null, capitalTerm: "none",
      capitalNote: { "zh-Hans": "直辖市，市政府驻地即本市", en: "Municipality — the city itself is the seat of government" },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },
    {
      id: "CN-JS", adcode: 320000, type: "province", group: "east",
      names: { "zh-Hans": "江苏", en: "Jiangsu" },
      fullNames: { "zh-Hans": "江苏省", en: "Jiangsu Province" },
      pinyin: "Jiāngsū",
      short: [{ char: "苏", pinyin: "sū" }],
      capital: { "zh-Hans": "南京", en: "Nanjing" },
      capitalPinyin: "Nánjīng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["金陵", "石头城"], en: ["Nanking"] }
    },
    {
      id: "CN-ZJ", adcode: 330000, type: "province", group: "east",
      names: { "zh-Hans": "浙江", en: "Zhejiang" },
      fullNames: { "zh-Hans": "浙江省", en: "Zhejiang Province" },
      pinyin: "Zhèjiāng",
      short: [{ char: "浙", pinyin: "zhè" }],
      capital: { "zh-Hans": "杭州", en: "Hangzhou" },
      capitalPinyin: "Hángzhōu", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["杭城"], en: [] }
    },
    {
      id: "CN-AH", adcode: 340000, type: "province", group: "east",
      names: { "zh-Hans": "安徽", en: "Anhui" },
      fullNames: { "zh-Hans": "安徽省", en: "Anhui Province" },
      pinyin: "Ānhuī",
      short: [{ char: "皖", pinyin: "wǎn" }],
      capital: { "zh-Hans": "合肥", en: "Hefei" },
      capitalPinyin: "Héféi", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["庐州"], en: [] }
    },
    {
      id: "CN-FJ", adcode: 350000, type: "province", group: "east",
      names: { "zh-Hans": "福建", en: "Fujian" },
      fullNames: { "zh-Hans": "福建省", en: "Fujian Province" },
      pinyin: "Fújiàn",
      short: [{ char: "闽", pinyin: "mǐn" }],
      capital: { "zh-Hans": "福州", en: "Fuzhou" },
      capitalPinyin: "Fúzhōu", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["榕城"], en: [] }
    },
    {
      id: "CN-JX", adcode: 360000, type: "province", group: "east",
      names: { "zh-Hans": "江西", en: "Jiangxi" },
      fullNames: { "zh-Hans": "江西省", en: "Jiangxi Province" },
      pinyin: "Jiāngxī",
      short: [{ char: "赣", pinyin: "gàn" }],
      capital: { "zh-Hans": "南昌", en: "Nanchang" },
      capitalPinyin: "Nánchāng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["洪城", "英雄城"], en: [] }
    },
    {
      id: "CN-SD", adcode: 370000, type: "province", group: "east",
      names: { "zh-Hans": "山东", en: "Shandong" },
      fullNames: { "zh-Hans": "山东省", en: "Shandong Province" },
      pinyin: "Shāndōng",
      short: [{ char: "鲁", pinyin: "lǔ" }],
      capital: { "zh-Hans": "济南", en: "Jinan" },
      capitalPinyin: "Jǐnán", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["泉城"], en: ["Tsinan"] }
    },
    {
      id: "CN-TW", adcode: 710000, type: "province", group: "east",
      names: { "zh-Hans": "台湾", en: "Taiwan" },
      fullNames: { "zh-Hans": "台湾省", en: "Taiwan Province" },
      pinyin: "Táiwān",
      short: [{ char: "台", pinyin: "tái" }],
      capital: { "zh-Hans": "台北", en: "Taipei" },
      capitalPinyin: "Táiběi", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: ["Chinese Taipei"] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },

    // ── 华中 ────────────────────────────────────────────────────
    {
      id: "CN-HA", adcode: 410000, type: "province", group: "central",
      names: { "zh-Hans": "河南", en: "Henan" },
      fullNames: { "zh-Hans": "河南省", en: "Henan Province" },
      pinyin: "Hénán",
      short: [{ char: "豫", pinyin: "yù" }],
      capital: { "zh-Hans": "郑州", en: "Zhengzhou" },
      capitalPinyin: "Zhèngzhōu", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["绿城"], en: [] }
    },
    {
      id: "CN-HB", adcode: 420000, type: "province", group: "central",
      names: { "zh-Hans": "湖北", en: "Hubei" },
      fullNames: { "zh-Hans": "湖北省", en: "Hubei Province" },
      pinyin: "Húběi",
      short: [{ char: "鄂", pinyin: "è" }],
      capital: { "zh-Hans": "武汉", en: "Wuhan" },
      capitalPinyin: "Wǔhàn", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["江城"], en: [] }
    },
    {
      id: "CN-HN", adcode: 430000, type: "province", group: "central",
      names: { "zh-Hans": "湖南", en: "Hunan" },
      fullNames: { "zh-Hans": "湖南省", en: "Hunan Province" },
      pinyin: "Húnán",
      short: [{ char: "湘", pinyin: "xiāng" }],
      capital: { "zh-Hans": "长沙", en: "Changsha" },
      capitalPinyin: "Chángshā", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["星城"], en: [] }
    },

    // ── 华南 ────────────────────────────────────────────────────
    {
      id: "CN-GD", adcode: 440000, type: "province", group: "south",
      names: { "zh-Hans": "广东", en: "Guangdong" },
      fullNames: { "zh-Hans": "广东省", en: "Guangdong Province" },
      pinyin: "Guǎngdōng",
      short: [{ char: "粤", pinyin: "yuè" }],
      capital: { "zh-Hans": "广州", en: "Guangzhou" },
      capitalPinyin: "Guǎngzhōu", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["羊城", "穗城", "花城"], en: ["Canton"] }
    },
    {
      id: "CN-GX", adcode: 450000, type: "autonomous", group: "south",
      names: { "zh-Hans": "广西", en: "Guangxi" },
      fullNames: { "zh-Hans": "广西壮族自治区", en: "Guangxi Zhuang Autonomous Region" },
      pinyin: "Guǎngxī",
      short: [{ char: "桂", pinyin: "guì" }],
      capital: { "zh-Hans": "南宁", en: "Nanning" },
      capitalPinyin: "Nánníng", capitalTerm: "seat",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["绿城"], en: [] }
    },
    {
      id: "CN-HI", adcode: 460000, type: "province", group: "south",
      names: { "zh-Hans": "海南", en: "Hainan" },
      fullNames: { "zh-Hans": "海南省", en: "Hainan Province" },
      pinyin: "Hǎinán",
      short: [{ char: "琼", pinyin: "qióng" }],
      capital: { "zh-Hans": "海口", en: "Haikou" },
      capitalPinyin: "Hǎikǒu", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["椰城"], en: [] }
    },
    {
      id: "CN-HK", adcode: 810000, type: "sar", group: "south",
      names: { "zh-Hans": "香港", en: "Hong Kong" },
      fullNames: { "zh-Hans": "香港特别行政区", en: "Hong Kong Special Administrative Region" },
      pinyin: "Xiānggǎng",
      short: [{ char: "港", pinyin: "gǎng" }],
      capital: null, capitalPinyin: null, capitalTerm: "none",
      capitalNote: { "zh-Hans": "特别行政区，不设省会", en: "Special administrative region — no provincial capital" },
      aliases: { "zh-Hans": ["香港特区", "港"], en: ["HK", "HKSAR"] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },
    {
      id: "CN-MO", adcode: 820000, type: "sar", group: "south",
      names: { "zh-Hans": "澳门", en: "Macao" },
      fullNames: { "zh-Hans": "澳门特别行政区", en: "Macao Special Administrative Region" },
      pinyin: "Àomén",
      short: [{ char: "澳", pinyin: "ào" }],
      capital: null, capitalPinyin: null, capitalTerm: "none",
      capitalNote: { "zh-Hans": "特别行政区，不设省会", en: "Special administrative region — no provincial capital" },
      aliases: { "zh-Hans": ["澳门特区", "澳"], en: ["Macau", "MSAR"] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },

    // ── 西南 ────────────────────────────────────────────────────
    {
      id: "CN-CQ", adcode: 500000, type: "municipality", group: "southwest",
      names: { "zh-Hans": "重庆", en: "Chongqing" },
      fullNames: { "zh-Hans": "重庆市", en: "Chongqing Municipality" },
      pinyin: "Chóngqìng",
      short: [{ char: "渝", pinyin: "yú" }],
      capital: null, capitalPinyin: null, capitalTerm: "none",
      capitalNote: { "zh-Hans": "直辖市，市政府驻地即本市", en: "Municipality — the city itself is the seat of government" },
      aliases: { "zh-Hans": [], en: ["Chungking"] },
      capitalAliases: { "zh-Hans": [], en: [] }
    },
    {
      id: "CN-SC", adcode: 510000, type: "province", group: "southwest",
      names: { "zh-Hans": "四川", en: "Sichuan" },
      fullNames: { "zh-Hans": "四川省", en: "Sichuan Province" },
      pinyin: "Sìchuān",
      short: [{ char: "川", pinyin: "chuān" }, { char: "蜀", pinyin: "shǔ" }],
      capital: { "zh-Hans": "成都", en: "Chengdu" },
      capitalPinyin: "Chéngdū", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["蓉城", "锦城"], en: [] }
    },
    {
      id: "CN-GZ", adcode: 520000, type: "province", group: "southwest",
      names: { "zh-Hans": "贵州", en: "Guizhou" },
      fullNames: { "zh-Hans": "贵州省", en: "Guizhou Province" },
      pinyin: "Guìzhōu",
      short: [{ char: "贵", pinyin: "guì" }, { char: "黔", pinyin: "qián" }],
      capital: { "zh-Hans": "贵阳", en: "Guiyang" },
      capitalPinyin: "Guìyáng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["筑城"], en: [] }
    },
    {
      id: "CN-YN", adcode: 530000, type: "province", group: "southwest",
      names: { "zh-Hans": "云南", en: "Yunnan" },
      fullNames: { "zh-Hans": "云南省", en: "Yunnan Province" },
      pinyin: "Yúnnán",
      short: [{ char: "云", pinyin: "yún" }, { char: "滇", pinyin: "diān" }],
      capital: { "zh-Hans": "昆明", en: "Kunming" },
      capitalPinyin: "Kūnmíng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["春城"], en: [] }
    },
    {
      id: "CN-XZ", adcode: 540000, type: "autonomous", group: "southwest",
      names: { "zh-Hans": "西藏", en: "Xizang" },
      fullNames: { "zh-Hans": "西藏自治区", en: "Xizang Autonomous Region" },
      pinyin: "Xīzàng",
      short: [{ char: "藏", pinyin: "zàng" }],
      capital: { "zh-Hans": "拉萨", en: "Lhasa" },
      capitalPinyin: "Lāsà", capitalTerm: "seat",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: ["Tibet"] },
      capitalAliases: { "zh-Hans": ["日光城"], en: [] }
    },

    // ── 西北 ────────────────────────────────────────────────────
    {
      id: "CN-SN", adcode: 610000, type: "province", group: "northwest",
      names: { "zh-Hans": "陕西", en: "Shaanxi" },
      fullNames: { "zh-Hans": "陕西省", en: "Shaanxi Province" },
      pinyin: "Shǎnxī",
      short: [{ char: "陕", pinyin: "shǎn" }, { char: "秦", pinyin: "qín" }],
      capital: { "zh-Hans": "西安", en: "Xi'an" },
      capitalPinyin: "Xī'ān", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["长安"], en: [] }
    },
    {
      id: "CN-GS", adcode: 620000, type: "province", group: "northwest",
      names: { "zh-Hans": "甘肃", en: "Gansu" },
      fullNames: { "zh-Hans": "甘肃省", en: "Gansu Province" },
      pinyin: "Gānsù",
      short: [{ char: "甘", pinyin: "gān" }, { char: "陇", pinyin: "lǒng" }],
      capital: { "zh-Hans": "兰州", en: "Lanzhou" },
      capitalPinyin: "Lánzhōu", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": ["陇原", "陇右"], en: [] },
      capitalAliases: { "zh-Hans": ["金城"], en: [] }
    },
    {
      id: "CN-QH", adcode: 630000, type: "province", group: "northwest",
      names: { "zh-Hans": "青海", en: "Qinghai" },
      fullNames: { "zh-Hans": "青海省", en: "Qinghai Province" },
      pinyin: "Qīnghǎi",
      short: [{ char: "青", pinyin: "qīng" }],
      capital: { "zh-Hans": "西宁", en: "Xining" },
      capitalPinyin: "Xīníng", capitalTerm: "capital",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["夏都"], en: [] }
    },
    {
      id: "CN-NX", adcode: 640000, type: "autonomous", group: "northwest",
      names: { "zh-Hans": "宁夏", en: "Ningxia" },
      fullNames: { "zh-Hans": "宁夏回族自治区", en: "Ningxia Hui Autonomous Region" },
      pinyin: "Níngxià",
      short: [{ char: "宁", pinyin: "níng" }],
      capital: { "zh-Hans": "银川", en: "Yinchuan" },
      capitalPinyin: "Yínchuān", capitalTerm: "seat",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["凤凰城"], en: [] }
    },
    {
      id: "CN-XJ", adcode: 650000, type: "autonomous", group: "northwest",
      names: { "zh-Hans": "新疆", en: "Xinjiang" },
      fullNames: { "zh-Hans": "新疆维吾尔自治区", en: "Xinjiang Uygur Autonomous Region" },
      pinyin: "Xīnjiāng",
      short: [{ char: "新", pinyin: "xīn" }],
      capital: { "zh-Hans": "乌鲁木齐", en: "Urumqi" },
      capitalPinyin: "Wūlǔmùqí", capitalTerm: "seat",
      capitalNote: { "zh-Hans": null, en: null },
      aliases: { "zh-Hans": [], en: [] },
      capitalAliases: { "zh-Hans": ["乌市"], en: ["Urumchi"] }
    }
  ]
};
