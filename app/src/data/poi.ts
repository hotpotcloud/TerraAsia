/**
 * 结构化兴趣点（POI）：山峰、景区、湖泊、瀑布、峡谷、山脉、河流。
 *
 * 与 static.ts 的分工：
 *   static.ts 只回答「这个字画在哪、什么颜色、几级时才出现」——是渲染用的最小信息。
 *   poi.ts    回答「点开之后看什么」——类别、等级、海拔、所属山系/水系、最佳季节、
 *             户外强度、一段说明。渲染层用 name 做索引，把标注变成可点对象。
 *
 * 约定：
 *   · name 必须与 static.ts 中 LABELS / SCENIC 的名字逐字一致，否则点不到；
 *   · elev 一律用米，并明确是峰顶、湖面还是沟口（elevNote），不混口径；
 *   · 数据为公开常识性地理事实，用于自用性质的沙盘说明，不作测绘依据。
 */

/** 兴趣点类别 */
export type PoiKind =
  | 'peak' // 山峰
  | 'mountain' // 山脉
  | 'scenic' // 景区 / 峡谷 / 保护区
  | 'lake' // 湖泊
  | 'waterfall' // 瀑布
  | 'river' // 河流
  | 'desert'; // 沙漠

export const KIND_NAME: Record<PoiKind, string> = {
  peak: '山峰',
  mountain: '山脉',
  scenic: '景区',
  lake: '湖泊',
  waterfall: '瀑布',
  river: '河流',
  desert: '沙漠',
};

/** 1 = 世界级（世界遗产 / 世界之最）；2 = 国家级（国家级风景名胜区 / 重点保护地）；3 = 区域级 */
export type PoiGrade = 1 | 2 | 3;

export const GRADE_NAME: Record<PoiGrade, string> = {
  1: '世界级',
  2: '国家级',
  3: '区域级',
};

/** 户外强度：1 车行可达 · 2 短途步道 · 3 半日以上徒步 · 4 多日徒步/高海拔 · 5 专业登山/无人区 */
export type Effort = 1 | 2 | 3 | 4 | 5;

export const EFFORT_NAME: Record<Effort, string> = {
  1: '车行可达',
  2: '短途步道',
  3: '半日徒步',
  4: '多日徒步',
  5: '专业级',
};

export interface Poi {
  name: string;
  kind: PoiKind;
  grade: PoiGrade;
  lon: number;
  lat: number;
  /** 海拔（米） */
  elev?: number;
  /** 海拔口径：峰顶 / 湖面 / 沟口 / 台顶 */
  elevNote?: string;
  /** 所属省级行政区 */
  region?: string;
  /** 所属山脉 / 水系 */
  range?: string;
  /** 最佳季节 */
  season?: string;
  /** 户外强度 */
  effort?: Effort;
  desc: string;
  tags?: string[];
}

/**
 * 全部 POI。按 类别 → 等级 排列，便于人工校对。
 * 坐标取要素主体位置（山峰取峰顶、湖泊取湖心、景区取核心区），保留两位小数。
 */
export const POIS: Poi[] = [
  /* ==================== 山峰 ==================== */
  {
    name: '珠穆朗玛峰', kind: 'peak', grade: 1, lon: 86.93, lat: 27.99,
    elev: 8848.86, elevNote: '峰顶', region: '西藏日喀则', range: '喜马拉雅山脉',
    effort: 5,
    desc: '世界最高峰。2020 年中尼联合测量公布雪面高程 8848.86 m，北坡位于中国西藏定日县境内。',
    tags: ['世界之最', '8000 米级', '中尼界峰'],
  },
  {
    name: '乔戈里峰', kind: 'peak', grade: 1, lon: 76.51, lat: 35.88,
    elev: 8611, elevNote: '峰顶', region: '新疆喀什', range: '喀喇昆仑山脉',
    effort: 5,
    desc: '世界第二高峰，国际通称 K2。山体陡峭、天气窗口短，攀登死亡率长期高于珠峰。',
    tags: ['8000 米级', '中巴界峰'],
  },
  {
    name: '南迦巴瓦峰', kind: 'peak', grade: 1, lon: 95.05, lat: 29.63,
    elev: 7782, elevNote: '峰顶', region: '西藏林芝', range: '喜马拉雅山脉东端',
    effort: 5,
    desc: '喜马拉雅山脉东端最高峰，立在雅鲁藏布江大拐弯内侧。印度洋水汽沿峡谷北上，峰体常年云雾。',
    tags: ['7782 米', '大拐弯'],
  },
  {
    name: '贡嘎山', kind: 'peak', grade: 1, lon: 101.88, lat: 29.6,
    elev: 7556, elevNote: '峰顶', region: '四川甘孜', range: '大雪山脉',
    effort: 5,
    desc: '横断山区最高峰，被称「蜀山之王」。峰顶到东侧大渡河谷的高差超过 6000 m，是国内垂直带谱最完整的山地之一。',
    tags: ['横断山最高峰'],
  },
  {
    name: '慕士塔格峰', kind: 'peak', grade: 2, lon: 75.11, lat: 38.28,
    elev: 7509, elevNote: '峰顶', region: '新疆克孜勒苏', range: '帕米尔高原',
    effort: 4,
    desc: '有「冰山之父」之称。山体浑圆、坡度相对平缓，是 7000 m 级山峰中接近性较好的一座。',
    tags: ['7500 米级', '帕米尔'],
  },
  {
    name: '梅里雪山', kind: 'peak', grade: 1, lon: 98.68, lat: 28.44,
    elev: 6740, elevNote: '主峰卡瓦格博', region: '云南迪庆', range: '怒山山脉',
    effort: 4,
    desc: '主峰卡瓦格博 6740 m，为云南省最高点。1996 年后国家禁止攀登，至今仍是无登顶记录的 6000 m 级以上高峰。',
    tags: ['未登顶', '藏区神山'],
  },
  {
    name: '冈仁波齐', kind: 'peak', grade: 1, lon: 81.47, lat: 31.07,
    elev: 6656, elevNote: '峰顶', region: '西藏阿里', range: '冈底斯山脉',
    effort: 4,
    desc: '冈底斯山主峰，被藏传佛教、印度教、耆那教等共同视为神山。传统转山线路一圈约 52 km，翻越卓玛拉山口（约 5630 m）。',
    tags: ['神山', '转山'],
  },
  {
    name: '各拉丹冬', kind: 'peak', grade: 2, lon: 91.1, lat: 33.5,
    elev: 6621, elevNote: '峰顶', region: '青海海西', range: '唐古拉山脉',
    effort: 5,
    desc: '长江正源沱沱河发源于此。周围是长江流域海拔最高的冰川群，也是三江源国家级自然保护区的核心区。',
    tags: ['长江正源', '三江源'],
  },
  {
    name: '四姑娘山', kind: 'peak', grade: 2, lon: 102.9, lat: 31.1,
    elev: 6250, elevNote: '幺妹峰', region: '四川阿坝', range: '邛崃山脉',
    effort: 4,
    desc: '四座雪峰南北并列，主峰幺妹峰 6250 m，其余三峰约 5300–5400 m。国内高山攀冰与长坪沟—毕棚沟穿越的经典目的地。',
    tags: ['攀冰', '穿越'],
  },
  {
    name: '玉龙雪山', kind: 'peak', grade: 2, lon: 100.2, lat: 27.1,
    elev: 5596, elevNote: '扇子陡', region: '云南丽江', range: '横断山脉',
    effort: 3,
    desc: '北半球最靠南的现代海洋性冰川分布区之一。索道可上到约 4500 m 的冰川公园观景台，是横断山少有的高可达性雪峰。',
    tags: ['冰川', '高可达性'],
  },
  {
    name: '玉山', kind: 'peak', grade: 2, lon: 120.96, lat: 23.47,
    elev: 3952, elevNote: '峰顶', region: '台湾南投/高雄', range: '玉山山脉',
    effort: 3,
    desc: '台湾最高峰，也是西太平洋岛屿中的最高峰。登顶需提前申请入园与山屋，主峰步道往返约 10 小时。',
    tags: ['台湾最高峰'],
  },
  {
    name: '太白山', kind: 'peak', grade: 2, lon: 107.77, lat: 33.95,
    elev: 3771.2, elevNote: '拔仙台', region: '陕西宝鸡', range: '秦岭',
    effort: 4,
    desc: '秦岭主峰，拔仙台 3771.2 m，是中国大陆东部的最高点。第四纪冰川遗迹与高山灌丛、高山草甸带谱清晰。',
    tags: ['秦岭主峰', '大陆东部最高'],
  },
  {
    name: '贺兰山', kind: 'peak', grade: 3, lon: 105.9, lat: 38.6,
    elev: 3556, elevNote: '主峰', region: '宁夏银川/内蒙古阿拉善', range: '贺兰山',
    effort: 3,
    desc: '南北走向的断块山，西侧是腾格里沙漠、东侧是银川平原。中国季风区与非季风区、荒漠草原与灌丛的分界山之一。',
    tags: ['分界山', '岩画'],
  },
  {
    name: '神农架', kind: 'scenic', grade: 1, lon: 110.5, lat: 31.5,
    elev: 3106.2, elevNote: '神农顶', region: '湖北神农架', range: '大巴山东延',
    effort: 3,
    desc: '华中最高区，神农顶 3106.2 m。北亚热带常绿落叶阔叶混交林保存完整，是世界自然遗产，也是川金丝猴分布的最东缘。',
    tags: ['世界遗产', '神农顶'],
  },
  {
    name: '五台山', kind: 'peak', grade: 1, lon: 113.59, lat: 39.0,
    elev: 3061.1, elevNote: '北台叶斗峰', region: '山西忻州', range: '太行山系',
    effort: 3,
    desc: '文殊道场，五座台顶环抱成台。北台叶斗峰 3061.1 m，为华北最高点；台顶夏季仍寒，五月常有积雪。',
    tags: ['华北最高', '佛教名山'],
  },
  {
    name: '峨眉山', kind: 'peak', grade: 1, lon: 103.33, lat: 29.52,
    elev: 3099, elevNote: '万佛顶', region: '四川乐山', range: '峨眉山',
    effort: 4,
    desc: '中国佛教四大名山之一。万佛顶 3099 m，金顶可观日出、云海与「佛光」；山脚到金顶高差约 2500 m，垂直带谱完整。',
    tags: ['佛教名山', '世界遗产'],
  },
  {
    name: '长白山', kind: 'peak', grade: 1, lon: 128.06, lat: 42.0,
    elev: 2691, elevNote: '白云峰', region: '吉林延边', range: '长白山脉',
    effort: 3,
    desc: '休眠火山，主峰白云峰 2691 m，火山口积水成天池。是中国东北最高峰，也是松花江、图们江、鸭绿江的源头区。',
    tags: ['火山', '三江源区'],
  },
  {
    name: '阿里山', kind: 'peak', grade: 2, lon: 120.8, lat: 23.51,
    elev: 2663, elevNote: '大塔山', region: '台湾嘉义', range: '阿里山山脉',
    effort: 2,
    desc: '以日出、云海、神木与森林铁路闻名。大塔山 2663 m，森林铁路从海拔 30 m 的嘉义一路爬升到 2216 m 的阿里山站。',
    tags: ['森林铁路', '日出'],
  },
  {
    name: '梵净山', kind: 'peak', grade: 1, lon: 108.7, lat: 27.92,
    elev: 2572, elevNote: '凤凰山', region: '贵州铜仁', range: '武陵山脉',
    effort: 3,
    desc: '武陵山脉主峰凤凰山 2572 m。孤峰拔起于喀斯特低山之上，是黔金丝猴的唯一栖息地，世界自然遗产。',
    tags: ['世界遗产', '黔金丝猴'],
  },
  {
    name: '华山', kind: 'peak', grade: 1, lon: 110.09, lat: 34.48,
    elev: 2154.9, elevNote: '南峰', region: '陕西渭南', range: '秦岭',
    effort: 4,
    desc: '五岳之西。花岗岩断块山，东、西、南、北、中五峰环峙，南峰 2154.9 m；自古以「险」著称，长空栈道、鹞子翻身皆在崖壁之上。',
    tags: ['五岳', '花岗岩'],
  },
  {
    name: '武夷山', kind: 'peak', grade: 1, lon: 117.7, lat: 27.72,
    elev: 2160.8, elevNote: '黄岗山', region: '福建南平', range: '武夷山脉',
    effort: 3,
    desc: '丹霞地貌与九曲溪组合的典型代表，世界文化与自然双遗产。黄岗山 2160.8 m，是东南沿海大陆的最高峰。',
    tags: ['双遗产', '丹霞', '九曲溪'],
  },
  {
    name: '恒山', kind: 'peak', grade: 2, lon: 113.73, lat: 39.67,
    elev: 2016.1, elevNote: '天峰岭', region: '山西大同', range: '恒山',
    effort: 3,
    desc: '五岳之北，主峰天峰岭 2016.1 m。金龙峡西壁的悬空寺以横梁插入岩体承托，是国内仅存的三教合一高空木构建筑。',
    tags: ['五岳', '悬空寺'],
  },
  {
    name: '黄山', kind: 'peak', grade: 1, lon: 118.17, lat: 30.13,
    elev: 1864.8, elevNote: '莲花峰', region: '安徽黄山', range: '黄山',
    effort: 3,
    desc: '花岗岩峰林地貌，奇松、怪石、云海、温泉并称「四绝」。莲花峰 1864.8 m 为最高点，光明顶 1860 m 为观云海主位。',
    tags: ['世界遗产', '花岗岩峰林'],
  },
  {
    name: '三清山', kind: 'peak', grade: 1, lon: 118.06, lat: 28.91,
    elev: 1819.9, elevNote: '玉京峰', region: '江西上饶', range: '怀玉山脉',
    effort: 3,
    desc: '花岗岩峰林与石柱群密集，玉京峰 1819.9 m。巨蟒出山、东方女神等石柱沿山脊排布，世界自然遗产。',
    tags: ['世界遗产', '花岗岩'],
  },
  {
    name: '武当山', kind: 'peak', grade: 1, lon: 111.0, lat: 32.4,
    elev: 1612, elevNote: '天柱峰', region: '湖北十堰', range: '武当山脉',
    effort: 3,
    desc: '道教名山，天柱峰 1612 m，金殿立于峰顶。明代营造的宫观群依山就势，2000 余年道教活动延续不断，世界文化遗产。',
    tags: ['世界遗产', '道教'],
  },
  {
    name: '泰山', kind: 'peak', grade: 1, lon: 117.1, lat: 36.25,
    elev: 1532.7, elevNote: '玉皇顶', region: '山东泰安', range: '泰山',
    effort: 2,
    desc: '五岳之东，历代帝王封禅之地。玉皇顶 1532.7 m，红门—中天门—南天门共约 7000 级台阶，是华北最经典的登高线路。',
    tags: ['五岳', '世界遗产'],
  },
  {
    name: '嵩山', kind: 'peak', grade: 2, lon: 113.0, lat: 34.48,
    elev: 1491.7, elevNote: '峻极峰', region: '河南郑州', range: '嵩山',
    effort: 3,
    desc: '五岳之中，峻极峰 1491.7 m。太古宇至新生代地层连续出露，被地质学界称为「五代同堂」，是世界地质公园。',
    tags: ['五岳', '世界地质公园'],
  },
  {
    name: '庐山', kind: 'peak', grade: 1, lon: 115.99, lat: 29.55,
    elev: 1474, elevNote: '汉阳峰', region: '江西九江', range: '庐山',
    effort: 2,
    desc: '地垒式断块山，汉阳峰 1474 m，北临长江、东傍鄱阳湖。年雾日可达 190 天以上，是著名的避暑与观云地。',
    tags: ['世界遗产', '断块山'],
  },
  {
    name: '衡山', kind: 'peak', grade: 2, lon: 112.69, lat: 27.25,
    elev: 1300.2, elevNote: '祝融峰', region: '湖南衡阳', range: '衡山',
    effort: 3,
    desc: '五岳之南，祝融峰 1300.2 m。花岗岩山体，南岳大庙与环山步道构成完整的朝山线路。',
    tags: ['五岳'],
  },
  {
    name: '崂山', kind: 'peak', grade: 3, lon: 120.62, lat: 36.19,
    elev: 1132.7, elevNote: '巨峰', region: '山东青岛', range: '崂山',
    effort: 2,
    desc: '中国海岸线上海拔最高的山脉，主峰巨峰 1132.7 m，东侧直接没入黄海。花岗岩球状风化形成的石蛋地貌遍布。',
    tags: ['海岸最高', '花岗岩'],
  },
  {
    name: '雁荡山', kind: 'peak', grade: 2, lon: 121.05, lat: 28.37,
    elev: 1108, elevNote: '百岗尖', region: '浙江温州', range: '雁荡山',
    effort: 2,
    desc: '白垩纪流纹岩火山地貌，以「峰、嶂、洞、瀑」四绝著称。百岗尖 1108 m，灵峰、灵岩、大龙湫为三大核心景区。',
    tags: ['火山岩', '大龙湫'],
  },
  {
    name: '普陀山', kind: 'peak', grade: 2, lon: 122.39, lat: 30.0,
    elev: 291, elevNote: '佛顶山', region: '浙江舟山', range: '舟山群岛',
    effort: 1,
    desc: '观音道场，佛教四大名山之一。全岛面积约 12.5 km²，佛顶山 291 m，环岛岸线多海蚀崖与沙滩。',
    tags: ['佛教名山', '海岛'],
  },
  {
    name: '五指山', kind: 'peak', grade: 2, lon: 109.6, lat: 18.9,
    elev: 1867, elevNote: '主峰', region: '海南五指山', range: '五指山',
    effort: 3,
    desc: '海南岛最高峰，1867 m。热带山地雨林保存完整，是海南长臂猿历史分布区的核心。',
    tags: ['海南最高', '热带雨林'],
  },

  /* ==================== 景区 · 峡谷 · 保护区 ==================== */
  {
    name: '九寨沟', kind: 'scenic', grade: 1, lon: 103.92, lat: 33.26,
    elev: 2400, elevNote: '沟口', region: '四川阿坝', range: '岷山山脉',
    effort: 2,
    desc: '岷山北坡的钙华湖群与叠瀑，沟谷海拔约 2000–3100 m。湖水因钙华与藻类呈现分层蓝绿，世界自然遗产。',
    tags: ['世界遗产', '钙华湖群'],
  },
  {
    name: '张家界', kind: 'scenic', grade: 1, lon: 110.48, lat: 29.13,
    region: '湖南张家界', range: '武陵山脉',
    effort: 2,
    desc: '石英砂岩峰林地貌，武陵源世界自然遗产核心区。独立石柱三千余座，相对高差多在 100–200 m。',
    tags: ['世界遗产', '石英砂岩峰林'],
  },
  {
    name: '稻城亚丁', kind: 'scenic', grade: 1, lon: 100.3, lat: 28.45,
    region: '四川甘孜', range: '横断山脉',
    effort: 4,
    desc: '仙乃日（6032 m）、央迈勇（5958 m）、夏诺多吉（5958 m）三座雪峰围合的高原谷地，核心区海拔 4000 m 以上。',
    tags: ['三神山', '高海拔'],
  },
  {
    name: '香格里拉', kind: 'scenic', grade: 2, lon: 99.7, lat: 27.83,
    elev: 3300, elevNote: '县城', region: '云南迪庆', range: '横断山脉',
    effort: 2,
    desc: '滇西北高原坝子，海拔约 3300 m。普达措的高原湖泊与牧场、松赞林寺的藏式建筑群是主要看点。',
    tags: ['高原坝子', '藏区'],
  },
  {
    name: '喀纳斯', kind: 'scenic', grade: 1, lon: 87.0, lat: 48.7,
    elev: 1374, elevNote: '湖面', region: '新疆阿勒泰', range: '阿尔泰山',
    effort: 3,
    desc: '阿尔泰山深处的高山湖泊，湖面 1374 m。湖水随季节与光照在灰蓝到碧绿间变化，湖畔分布图瓦人村落。',
    tags: ['高山湖泊', '图瓦人'],
  },
  {
    name: '桂林漓江', kind: 'scenic', grade: 1, lon: 110.29, lat: 25.1,
    region: '广西桂林', range: '南岭',
    effort: 1,
    desc: '喀斯特峰林与峰丛沿江排布，桂林至阳朔水程约 83 km。是世界自然遗产「中国南方喀斯特」的重要组成部分。',
    tags: ['世界遗产', '喀斯特'],
  },
  {
    name: '都江堰', kind: 'scenic', grade: 1, lon: 103.62, lat: 31.0,
    region: '四川成都', range: '岷江',
    effort: 1,
    desc: '公元前 256 年由李冰主持修建，鱼嘴分水、飞沙堰泄洪排沙、宝瓶口引水三大主体至今仍在灌溉成都平原。',
    tags: ['世界遗产', '水利工程'],
  },
  {
    name: '鸣沙山月牙泉', kind: 'scenic', grade: 2, lon: 94.66, lat: 40.09,
    region: '甘肃敦煌', range: '祁连山西端',
    effort: 2,
    desc: '沙山环抱中的月牙形泉湖。沙岭与泉眼共存，风沙不断却始终不掩泉面，是干旱区独特的水沙共存景观。',
    tags: ['沙漠', '泉湖'],
  },
  {
    name: '阿尔山', kind: 'scenic', grade: 2, lon: 119.94, lat: 47.18,
    region: '内蒙古兴安盟', range: '大兴安岭',
    effort: 2,
    desc: '火山熔岩地貌与矿泉群集中分布，处于森林与草原过渡带。天池为火山口湖，驼峰岭天池的熔岩台地剖面清晰。',
    tags: ['火山', '矿泉'],
  },
  {
    name: '长江三峡', kind: 'scenic', grade: 1, lon: 110.2, lat: 31.02,
    region: '重庆/湖北', range: '长江',
    effort: 1,
    desc: '瞿塘峡、巫峡、西陵峡的合称，西起奉节白帝城、东至宜昌南津关，全长约 193 km。两岸为石灰岩峡谷，江面最窄处不足百米。',
    tags: ['峡谷', '长江'],
  },
  {
    name: '雅鲁藏布大峡谷', kind: 'scenic', grade: 1, lon: 95.0, lat: 29.75,
    region: '西藏林芝', range: '雅鲁藏布江',
    effort: 5,
    desc: '雅鲁藏布江绕南迦巴瓦峰形成的大拐弯，最深处超过 6000 m，是世界最深峡谷。水汽通道作用使其成为北半球同纬度降水最多的地区。',
    tags: ['世界最深峡谷', '水汽通道'],
  },
  {
    name: '虎跳峡', kind: 'scenic', grade: 2, lon: 100.09, lat: 27.19,
    region: '云南丽江/香格里拉', range: '金沙江',
    effort: 4,
    desc: '金沙江在玉龙雪山与哈巴雪山之间下切，江面海拔约 1800 m，两侧雪峰高差 3000 m 以上。高路徒步线分上、中、下三段。',
    tags: ['峡谷', '徒步'],
  },
  {
    name: '石林', kind: 'scenic', grade: 1, lon: 103.32, lat: 24.81,
    region: '云南昆明', range: '滇东喀斯特',
    effort: 1,
    desc: '二叠纪灰岩经长期溶蚀形成的石芽—石柱群，高低错落如林。世界自然遗产「中国南方喀斯特」组成部分。',
    tags: ['世界遗产', '喀斯特'],
  },
  {
    name: '丹霞山', kind: 'scenic', grade: 1, lon: 113.73, lat: 25.03,
    region: '广东韶关', range: '南岭',
    effort: 2,
    desc: '丹霞地貌的命名地。红色砂砾岩在流水与重力作用下形成陡崖、方山与峰丛，世界自然遗产。',
    tags: ['世界遗产', '丹霞地貌命名地'],
  },
  {
    name: '武功山', kind: 'scenic', grade: 2, lon: 114.18, lat: 27.46,
    region: '江西萍乡', range: '罗霄山脉',
    effort: 3,
    desc: '1600 m 以上山脊连绵分布高山草甸，是华东最热门的高山徒步线之一。金顶海拔 1918.3 m。',
    tags: ['高山草甸', '徒步'],
  },
  {
    name: '可可西里', kind: 'scenic', grade: 1, lon: 92.5, lat: 35.5,
    region: '青海玉树', range: '昆仑山与唐古拉山之间',
    effort: 5,
    desc: '平均海拔 4600 m 以上的高原荒原，湖泊密集、植被稀疏。藏羚羊在此产仔，世界自然遗产。',
    tags: ['世界遗产', '藏羚羊'],
  },
  {
    name: '三江源', kind: 'scenic', grade: 1, lon: 95.5, lat: 34.0,
    region: '青海玉树/果洛', range: '青藏高原腹地',
    effort: 5,
    desc: '长江、黄河、澜沧江的发源地，海拔 4000–5800 m 的冰川、湿地与高寒草甸复合区，中国面积最大的国家公园。',
    tags: ['国家公园', '江河源'],
  },

  /* ==================== 沙漠 ==================== */
  {
    name: '塔克拉玛干沙漠', kind: 'desert', grade: 2, lon: 82.5, lat: 38.9,
    region: '新疆', range: '塔里木盆地',
    effort: 5,
    desc: '中国最大沙漠，世界第二大流动沙漠，面积约 33 万 km²。沙丘以新月形与复合型沙垄为主，南北穿越线路均在 500 km 以上。',
    tags: ['中国最大沙漠', '流动沙漠'],
  },
  {
    name: '巴丹吉林沙漠', kind: 'desert', grade: 2, lon: 102.0, lat: 39.6,
    region: '内蒙古阿拉善', range: '阿拉善高原',
    effort: 4,
    desc: '中国第三大沙漠。高大沙山与 100 多个丘间湖并存，必鲁图沙峰相对高度约 460 m，被称为「沙漠珠峰」。',
    tags: ['沙山', '丘间湖'],
  },

  /* ==================== 湖泊 ==================== */
  {
    name: '青海湖', kind: 'lake', grade: 1, lon: 100.2, lat: 36.9,
    elev: 3196, elevNote: '湖面', region: '青海海南/海北', range: '祁连山南麓',
    effort: 1,
    desc: '中国面积最大的内陆湖与咸水湖，湖面约 4500 km²、海拔 3196 m。环湖公路约 360 km，是国内外知名的骑行线路。',
    tags: ['中国最大湖泊', '环湖骑行'],
  },
  {
    name: '纳木错', kind: 'lake', grade: 1, lon: 90.6, lat: 30.7,
    elev: 4718, elevNote: '湖面', region: '西藏拉萨/那曲', range: '念青唐古拉山北麓',
    effort: 3,
    desc: '世界海拔最高的特大湖泊之一，湖面 4718 m。南侧念青唐古拉山主峰 7162 m，雪山与湖面同框是其标志景观。',
    tags: ['高海拔湖泊', '念青唐古拉'],
  },
  {
    name: '长白山天池', kind: 'lake', grade: 1, lon: 128.06, lat: 42.03,
    elev: 2189, elevNote: '湖面', region: '吉林延边', range: '长白山',
    effort: 3,
    desc: '火山口湖，湖面 2189 m、平均水深约 204 m、最深处 373 m，是中国最深的湖泊。天池水经乘槎河外泄形成长白瀑布。',
    tags: ['火山口湖', '中国最深'],
  },
  {
    name: '天山天池', kind: 'lake', grade: 1, lon: 88.13, lat: 43.88,
    elev: 1910, elevNote: '湖面', region: '新疆昌吉', range: '博格达峰北坡',
    effort: 2,
    desc: '博格达峰北坡的冰碛堰塞湖，湖面约 1910 m。南侧博格达峰 5445 m，冰川融水补给，冬季封冻期长约 5 个月。',
    tags: ['冰碛堰塞湖', '博格达峰'],
  },
  {
    name: '泸沽湖', kind: 'lake', grade: 2, lon: 100.78, lat: 27.7,
    elev: 2690, elevNote: '湖面', region: '云南丽江/四川盐源', range: '横断山脉',
    effort: 2,
    desc: '川滇交界的高原淡水湖，湖面 2690 m、面积约 50 km²。湖畔摩梭人保留母系家族与「走婚」习俗。',
    tags: ['高原湖泊', '摩梭'],
  },
  {
    name: '赛里木湖', kind: 'lake', grade: 2, lon: 81.2, lat: 44.6,
    elev: 2071, elevNote: '湖面', region: '新疆博尔塔拉', range: '天山北坡',
    effort: 2,
    desc: '天山北坡的高山冷水湖，湖面 2071 m，是大西洋水汽能到达的最东端水体之一，被称「大西洋最后一滴眼泪」。',
    tags: ['高山湖泊'],
  },
  {
    name: '呼伦湖', kind: 'lake', grade: 2, lon: 117.4, lat: 48.95,
    elev: 545, elevNote: '湖面', region: '内蒙古呼伦贝尔', range: '呼伦贝尔草原',
    effort: 1,
    desc: '内蒙古第一大湖，湖面 545 m、面积约 2000 km²。与贝尔湖并称「呼伦贝尔」，是草原区重要的候鸟停歇地。',
    tags: ['草原湖泊', '候鸟'],
  },
  {
    name: '鄱阳湖', kind: 'lake', grade: 1, lon: 116.3, lat: 29.1,
    region: '江西上饶/九江', range: '长江',
    effort: 1,
    desc: '中国最大淡水湖。水位年变幅可达 10 m 以上，呈现「洪水一片、枯水一线」的季节形态，是长江中游最重要的调蓄湖泊。',
    tags: ['中国最大淡水湖', '候鸟越冬地'],
  },
  {
    name: '洞庭湖', kind: 'lake', grade: 2, lon: 112.9, lat: 29.3,
    region: '湖南岳阳', range: '长江',
    effort: 1,
    desc: '长江中游的调蓄湖泊，与洪道、垸区共同构成复合湿地。东洞庭湖是白鹤、小天鹅等越冬水鸟的重要栖息地。',
    tags: ['长江调蓄', '湿地'],
  },
  {
    name: '太湖', kind: 'lake', grade: 1, lon: 120.2, lat: 31.2,
    region: '江苏苏州/无锡/湖州', range: '长江三角洲',
    effort: 1,
    desc: '面积约 2338 km²，中国第三大淡水湖。湖中岛屿与半岛交错，沿岸是典型的江南水网与圩田区。',
    tags: ['江南水网'],
  },
  {
    name: '千岛湖', kind: 'lake', grade: 2, lon: 119.03, lat: 29.6,
    region: '浙江杭州', range: '新安江',
    effort: 1,
    desc: '新安江水库，正常水位 108 m 时露出岛屿 1000 余座。库区水深、能见度高，是长三角重要的水源地。',
    tags: ['水库', '水源地'],
  },
  {
    name: '镜泊湖', kind: 'lake', grade: 2, lon: 128.9, lat: 43.9,
    region: '黑龙江牡丹江', range: '长白山脉',
    effort: 1,
    desc: '约一万年前火山熔岩堰塞牡丹江河道形成的湖泊，是中国最大的火山堰塞湖。出口吊水楼瀑布落差约 20 m。',
    tags: ['堰塞湖', '火山'],
  },
  {
    name: '五大连池', kind: 'lake', grade: 2, lon: 126.1, lat: 48.72,
    region: '黑龙江黑河', range: '小兴安岭西麓',
    effort: 1,
    desc: '1719–1721 年火山喷发的熔岩堰塞白河，形成五个串珠状湖泊。周围分布新期火山锥与大面积熔岩台地。',
    tags: ['火山', '熔岩台地'],
  },
  {
    name: '喀拉峻草原', kind: 'scenic', grade: 2, lon: 82.05, lat: 43.15,
    region: '新疆伊犁', range: '天山',
    effort: 3,
    desc: '天山山间的高山五花草甸，海拔约 2000 m。草甸沿等高线呈波浪状起伏，是世界自然遗产「新疆天山」的组成部分。',
    tags: ['世界遗产', '高山草甸'],
  },

  /* ==================== 瀑布 ==================== */
  {
    name: '黄果树瀑布', kind: 'waterfall', grade: 1, lon: 105.67, lat: 25.99,
    region: '贵州安顺', range: '白水河',
    effort: 1,
    desc: '高 77.8 m、宽 101 m，是中国最大的瀑布之一。白水河在此跌落犀牛潭，瀑后水帘洞可横向穿行。',
    tags: ['中国最大瀑布之一', '水帘洞'],
  },
  {
    name: '壶口瀑布', kind: 'waterfall', grade: 1, lon: 110.44, lat: 36.15,
    region: '山西临汾/陕西延安', range: '黄河',
    effort: 1,
    desc: '黄河在此由 300 余米宽收窄到 30–50 m，落差约 30 m。含沙量高，水色浑黄，是中国第二大瀑布。',
    tags: ['黄河', '峡谷瀑布'],
  },

  /* ==================== 山脉 ==================== */
  {
    name: '喜马拉雅山脉', kind: 'mountain', grade: 1, lon: 80.8, lat: 30.1,
    range: '主峰珠穆朗玛峰', effort: 5,
    desc: '世界最高山脉，西起克什米尔的南迦帕尔巴特峰、东至雅鲁藏布江大拐弯，长约 2400 km，全球 14 座 8000 m 级高峰中有 10 座在此。',
    tags: ['世界最高山脉', '8000 米级'],
  },
  {
    name: '昆仑山', kind: 'mountain', grade: 1, lon: 80.8, lat: 36.3,
    range: '西起帕米尔、东接秦岭', effort: 5,
    desc: '长约 2500 km，平均海拔 5500–6000 m，是中国最长的山脉。它是塔里木盆地、柴达木盆地与青藏高原的分界。',
    tags: ['中国最长山脉', '高原分界'],
  },
  {
    name: '天山', kind: 'mountain', grade: 1, lon: 84.5, lat: 43.3,
    range: '主峰托木尔峰 7443 m', effort: 4,
    desc: '全长约 2500 km，横亘新疆中部，把准噶尔盆地与塔里木盆地隔开。南北坡降水差异极大，是干旱区山地垂直带谱的典型样本。',
    tags: ['世界遗产', '干旱区山地'],
  },
  {
    name: '阿尔泰山', kind: 'mountain', grade: 2, lon: 89.0, lat: 47.7,
    range: '主峰友谊峰 4374 m', effort: 4,
    desc: '中国、蒙古、俄罗斯、哈萨克斯坦四国交界的山脉。额尔齐斯河发源于南坡，是中国唯一注入北冰洋的水系。',
    tags: ['额尔齐斯河', '四国交界'],
  },
  {
    name: '祁连山', kind: 'mountain', grade: 2, lon: 98.4, lat: 38.6,
    range: '最高峰疏勒南山 5826 m', effort: 4,
    desc: '长约 1000 km 的北西—南东向山系。冰川融水滋养河西走廊，是内陆河流域与黄河上游的分水岭。',
    tags: ['河西走廊', '冰川融水'],
  },
  {
    name: '横断山脉', kind: 'mountain', grade: 1, lon: 99.4, lat: 27.5,
    range: '金沙江、澜沧江、怒江', effort: 4,
    desc: '一系列南北纵贯的岭谷，山脊与河谷高差常达 2000–3000 m。金沙江、澜沧江、怒江在此并行南流，「三江并流」为世界自然遗产。',
    tags: ['世界遗产', '三江并流', '岭谷相间'],
  },
  {
    name: '秦岭', kind: 'mountain', grade: 1, lon: 106.8, lat: 33.6,
    range: '主峰太白山 3771.2 m', effort: 3,
    desc: '东西长约 1600 km，是中国南北气候、植被与水文的分界。南坡属长江流域、北坡属黄河流域，也是南水北调中线水源区。',
    tags: ['南北分界', '中央水塔'],
  },
  {
    name: '大兴安岭', kind: 'mountain', grade: 2, lon: 122.0, lat: 49.6,
    range: '主峰黄岗梁', effort: 3,
    desc: '长约 1200 km 的北北东向山系，是中国最北、面积最大的寒温带针叶林区，也是湿润区与半干旱区的分界。',
    tags: ['寒温带针叶林', '分界线'],
  },
  {
    name: '太行山脉', kind: 'mountain', grade: 2, lon: 113.5, lat: 38.4,
    range: '主峰小五台山 2882 m', effort: 3,
    desc: '长约 400 km，东侧以陡崖直落华北平原，西侧缓倾入黄土高原。太行八陉是穿越山地的古老通道。',
    tags: ['华北平原西界', '太行八陉'],
  },
  {
    name: '巫山', kind: 'mountain', grade: 2, lon: 110.4, lat: 31.3,
    range: '主峰乌云顶 2400 m', effort: 3,
    desc: '长江横切巫山形成巫峡，两岸石灰岩崖壁高数百米。山原期夷平面与深切峡谷并存，是长江三峡地貌的关键一段。',
    tags: ['三峡', '石灰岩峡谷'],
  },
  {
    name: '雪峰山', kind: 'mountain', grade: 3, lon: 110.2, lat: 27.3,
    range: '主峰苏宝顶 1934 m', effort: 3,
    desc: '湖南中西部南北向山系，是资水与沅水的分水岭。山地对南下的冷空气有阻滞作用，两侧气候差异明显。',
    tags: ['分水岭'],
  },
  {
    name: '长白山脉', kind: 'mountain', grade: 2, lon: 128.1, lat: 42.2,
    range: '主峰白云峰 2691 m', effort: 3,
    desc: '东北东部的中朝界山，由多级熔岩台地与火山锥组成。是松花江、图们江、鸭绿江的发源地。',
    tags: ['界山', '三江源区'],
  },
  {
    name: '台湾山脉', kind: 'mountain', grade: 2, lon: 121.2, lat: 23.5,
    range: '主峰玉山 3952 m', effort: 4,
    desc: '纵贯台湾岛的五列平行山脉，占全岛面积约三分之二。玉山 3952 m 为最高点，3000 m 以上高峰有 200 余座。',
    tags: ['台湾最高', '高山密集'],
  },
  {
    name: '阴山', kind: 'mountain', grade: 2, lon: 108.8, lat: 41.2,
    range: '主峰呼和巴什格 2364 m', effort: 3,
    desc: '东西走向的断块山，横亘内蒙古中部。南坡陡降入河套平原，是农牧交错带与季风边缘的天然标志。',
    tags: ['农牧交错带'],
  },
  {
    name: '南岭', kind: 'mountain', grade: 2, lon: 112.0, lat: 24.8,
    range: '主峰石坑崆 1902 m', effort: 3,
    desc: '长江与珠江两大水系的分水岭，也是中亚热带与南亚热带的分界。山间谷地自古是湘桂、粤赣通道。',
    tags: ['两大水系分水岭'],
  },

  /* ==================== 河流 ==================== */
  {
    name: '长江', kind: 'river', grade: 1, lon: 111.0, lat: 30.8,
    region: '青海至上海', range: '发源于各拉丹冬', effort: 1,
    desc: '全长约 6300 km，中国第一、世界第三长河。上游落差集中、中下游湖泊密布，流域面积约占全国五分之一。',
    tags: ['中国第一长河'],
  },
  {
    name: '黄河', kind: 'river', grade: 1, lon: 108.4, lat: 39.4,
    region: '青海至山东', range: '发源于巴颜喀拉山', effort: 1,
    desc: '全长约 5464 km。中游穿越黄土高原，年输沙量长期居世界首位，下游河床普遍高出两岸地面，形成「地上河」。',
    tags: ['含沙量世界第一', '地上河'],
  },
  {
    name: '珠江', kind: 'river', grade: 1, lon: 110.6, lat: 23.4,
    region: '云南至广东', range: '干流为西江', effort: 1,
    desc: '以西江为干流，全长约 2320 km，由西江、北江、东江及珠江三角洲网河区组成，年径流量仅次于长江。',
    tags: ['三角洲', '网河区'],
  },
  {
    name: '黑龙江', kind: 'river', grade: 2, lon: 127.6, lat: 50.6,
    region: '中俄界河', range: '发源于肯特山', effort: 1,
    desc: '全长约 4400 km，中俄界河。结冰期长达 5–6 个月，春季开江时形成冰坝，易发凌汛。',
    tags: ['界河', '凌汛'],
  },
  {
    name: '松花江', kind: 'river', grade: 2, lon: 127.2, lat: 46.2,
    region: '吉林/黑龙江', range: '黑龙江最大支流', effort: 1,
    desc: '全长约 1900 km，黑龙江最大支流。上游发源于长白山天池，中游建有丰满、白山水电站。',
    tags: ['黑龙江最大支流'],
  },
  {
    name: '雅鲁藏布江', kind: 'river', grade: 1, lon: 91.6, lat: 29.0,
    region: '西藏', range: '发源于杰马央宗冰川', effort: 3,
    desc: '中国境内长约 2057 km，是世界上海拔最高的大河。绕南迦巴瓦峰形成大拐弯后出境，改称布拉马普特拉河。',
    tags: ['世界最高大河', '大拐弯'],
  },
  {
    name: '塔里木河', kind: 'river', grade: 2, lon: 84.3, lat: 41.0,
    region: '新疆', range: '塔里木盆地北缘', effort: 3,
    desc: '全长约 2179 km，中国最长的内流河。沿塔克拉玛干沙漠北缘东流，下游断流与生态输水是近二十年的治理重点。',
    tags: ['中国最长内流河', '生态输水'],
  },
  {
    name: '淮河', kind: 'river', grade: 2, lon: 116.3, lat: 32.7,
    region: '河南/安徽/江苏', range: '桐柏山至洪泽湖', effort: 1,
    desc: '全长约 1000 km。秦岭—淮河一线是中国南北气候分界，也是南北方言、作物与建筑形式的分野。',
    tags: ['南北分界'],
  },
];

/** 名称索引：渲染层用它把标注变成可点对象 */
export const POI_BY_NAME: Map<string, Poi> = new Map(POIS.map((p) => [p.name, p]));

/** 按类别筛选（详情卡「同类」跳转用） */
export function poisOfKind(kind: PoiKind): Poi[] {
  return POIS.filter((p) => p.kind === kind);
}
