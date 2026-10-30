/* 生成 src/core/cityname.ts —— 城市与省区的英/繁名称对照表。
   来源：src/core/citydata.ts 的中文名单（城市库唯一来源）。
   英文：约定俗成名优先，其余拼音（去行政后缀）。
   繁体：OpenCC s2twp（台湾正体），只落差异项以控体积。
   用法：node scripts/gen-cityname.mjs
   校验：中文名单里每一条都必须有英文名，缺一条就非零退出。 */
import fs from "node:fs";
import path from "node:path";
import OpenCC from "opencc-js";

const ROOT = path.resolve(process.cwd());
const CITYDATA = path.join(ROOT, "src/core/citydata.ts");
const OUT = path.join(ROOT, "src/core/cityname.ts");

/* ---------- 英文名：约定俗成 / 拼音（去后缀） ---------- */
const EN = {
  // 直辖市 · 特别行政区 · 台湾
  "北京市": "Beijing", "天津市": "Tianjin", "上海市": "Shanghai", "重庆市": "Chongqing",
  "香港": "Hong Kong", "澳门": "Macao", "台北": "Taipei",

  // 河北
  "石家庄市": "Shijiazhuang", "唐山市": "Tangshan", "秦皇岛市": "Qinhuangdao", "邯郸市": "Handan",
  "邢台市": "Xingtai", "保定市": "Baoding", "张家口市": "Zhangjiakou", "承德市": "Chengde",
  "沧州市": "Cangzhou", "廊坊市": "Langfang", "衡水市": "Hengshui",
  // 山西
  "太原市": "Taiyuan", "大同市": "Datong", "阳泉市": "Yangquan", "长治市": "Changzhi",
  "晋城市": "Jincheng", "朔州市": "Shuozhou", "晋中市": "Jinzhong", "运城市": "Yuncheng",
  "忻州市": "Xinzhou", "临汾市": "Linfen", "吕梁市": "Lvliang",
  // 内蒙古
  "呼和浩特市": "Hohhot", "包头市": "Baotou", "乌海市": "Wuhai", "赤峰市": "Chifeng",
  "通辽市": "Tongliao", "鄂尔多斯市": "Ordos", "呼伦贝尔市": "Hulunbuir", "巴彦淖尔市": "Bayannur",
  "乌兰察布市": "Ulanqab", "兴安盟": "Hinggan", "锡林郭勒盟": "Xilingol", "阿拉善盟": "Alxa",
  // 辽宁
  "沈阳市": "Shenyang", "大连市": "Dalian", "鞍山市": "Anshan", "抚顺市": "Fushun",
  "本溪市": "Benxi", "丹东市": "Dandong", "锦州市": "Jinzhou", "营口市": "Yingkou",
  "阜新市": "Fuxin", "辽阳市": "Liaoyang", "盘锦市": "Panjin", "铁岭市": "Tieling",
  "朝阳市": "Chaoyang", "葫芦岛市": "Huludao",
  // 吉林
  "长春市": "Changchun", "吉林市": "Jilin", "四平市": "Siping", "辽源市": "Liaoyuan",
  "通化市": "Tonghua", "白山市": "Baishan", "松原市": "Songyuan", "白城市": "Baicheng",
  "延边朝鲜族自治州": "Yanbian",
  // 黑龙江
  "哈尔滨市": "Harbin", "齐齐哈尔市": "Qiqihar", "鸡西市": "Jixi", "鹤岗市": "Hegang",
  "双鸭山市": "Shuangyashan", "大庆市": "Daqing", "伊春市": "Yichun", "佳木斯市": "Jiamusi",
  "七台河市": "Qitaihe", "牡丹江市": "Mudanjiang", "黑河市": "Heihe", "绥化市": "Suihua",
  "大兴安岭地区": "Daxing'anling",
  // 江苏
  "南京市": "Nanjing", "无锡市": "Wuxi", "徐州市": "Xuzhou", "常州市": "Changzhou",
  "苏州市": "Suzhou", "南通市": "Nantong", "连云港市": "Lianyungang", "淮安市": "Huai'an",
  "盐城市": "Yancheng", "扬州市": "Yangzhou", "镇江市": "Zhenjiang", "泰州市": "Taizhou",
  "宿迁市": "Suqian",
  // 浙江
  "杭州市": "Hangzhou", "宁波市": "Ningbo", "温州市": "Wenzhou", "嘉兴市": "Jiaxing",
  "湖州市": "Huzhou", "绍兴市": "Shaoxing", "金华市": "Jinhua", "衢州市": "Quzhou",
  "舟山市": "Zhoushan", "台州市": "Taizhou", "丽水市": "Lishui",
  // 安徽
  "合肥市": "Hefei", "芜湖市": "Wuhu", "蚌埠市": "Bengbu", "淮南市": "Huainan",
  "马鞍山市": "Ma'anshan", "淮北市": "Huaibei", "铜陵市": "Tongling", "安庆市": "Anqing",
  "黄山市": "Huangshan", "滁州市": "Chuzhou", "阜阳市": "Fuyang", "宿州市": "Suzhou",
  "六安市": "Lu'an", "亳州市": "Bozhou", "池州市": "Chizhou", "宣城市": "Xuancheng",
  // 福建
  "福州市": "Fuzhou", "厦门市": "Xiamen", "莆田市": "Putian", "三明市": "Sanming",
  "泉州市": "Quanzhou", "漳州市": "Zhangzhou", "南平市": "Nanping", "龙岩市": "Longyan",
  "宁德市": "Ningde",
  // 江西
  "南昌市": "Nanchang", "景德镇市": "Jingdezhen", "萍乡市": "Pingxiang", "九江市": "Jiujiang",
  "新余市": "Xinyu", "鹰潭市": "Yingtan", "赣州市": "Ganzhou", "吉安市": "Ji'an",
  "宜春市": "Yichun", "抚州市": "Fuzhou", "上饶市": "Shangrao",
  // 山东
  "济南市": "Jinan", "青岛市": "Qingdao", "淄博市": "Zibo", "枣庄市": "Zaozhuang",
  "东营市": "Dongying", "烟台市": "Yantai", "潍坊市": "Weifang", "济宁市": "Jining",
  "泰安市": "Tai'an", "威海市": "Weihai", "日照市": "Rizhao", "临沂市": "Linyi",
  "德州市": "Dezhou", "聊城市": "Liaocheng", "滨州市": "Binzhou", "菏泽市": "Heze",
  // 河南
  "郑州市": "Zhengzhou", "开封市": "Kaifeng", "洛阳市": "Luoyang", "平顶山市": "Pingdingshan",
  "安阳市": "Anyang", "鹤壁市": "Hebi", "新乡市": "Xinxiang", "焦作市": "Jiaozuo",
  "濮阳市": "Puyang", "许昌市": "Xuchang", "漯河市": "Luohe", "三门峡市": "Sanmenxia",
  "南阳市": "Nanyang", "商丘市": "Shangqiu", "信阳市": "Xinyang", "周口市": "Zhoukou",
  "驻马店市": "Zhumadian", "济源市": "Jiyuan",
  // 湖北
  "武汉市": "Wuhan", "黄石市": "Huangshi", "十堰市": "Shiyan", "宜昌市": "Yichang",
  "襄阳市": "Xiangyang", "鄂州市": "Ezhou", "荆门市": "Jingmen", "孝感市": "Xiaogan",
  "荆州市": "Jingzhou", "黄冈市": "Huanggang", "咸宁市": "Xianning", "随州市": "Suizhou",
  "恩施土家族苗族自治州": "Enshi", "仙桃市": "Xiantao", "潜江市": "Qianjiang",
  "天门市": "Tianmen", "神农架林区": "Shennongjia",
  // 湖南
  "长沙市": "Changsha", "株洲市": "Zhuzhou", "湘潭市": "Xiangtan", "衡阳市": "Hengyang",
  "邵阳市": "Shaoyang", "岳阳市": "Yueyang", "常德市": "Changde", "张家界市": "Zhangjiajie",
  "益阳市": "Yiyang", "郴州市": "Chenzhou", "永州市": "Yongzhou", "怀化市": "Huaihua",
  "娄底市": "Loudi", "湘西土家族苗族自治州": "Xiangxi",
  // 广东
  "广州市": "Guangzhou", "韶关市": "Shaoguan", "深圳市": "Shenzhen", "珠海市": "Zhuhai",
  "汕头市": "Shantou", "佛山市": "Foshan", "江门市": "Jiangmen", "湛江市": "Zhanjiang",
  "茂名市": "Maoming", "肇庆市": "Zhaoqing", "惠州市": "Huizhou", "梅州市": "Meizhou",
  "汕尾市": "Shanwei", "河源市": "Heyuan", "阳江市": "Yangjiang", "清远市": "Qingyuan",
  "东莞市": "Dongguan", "中山市": "Zhongshan", "潮州市": "Chaozhou", "揭阳市": "Jieyang",
  "云浮市": "Yunfu",
  // 广西
  "南宁市": "Nanning", "柳州市": "Liuzhou", "桂林市": "Guilin", "梧州市": "Wuzhou",
  "北海市": "Beihai", "防城港市": "Fangchenggang", "钦州市": "Qinzhou", "贵港市": "Guigang",
  "玉林市": "Yulin", "百色市": "Baise", "贺州市": "Hezhou", "河池市": "Hechi",
  "来宾市": "Laibin", "崇左市": "Chongzuo",
  // 海南
  "海口市": "Haikou", "三亚市": "Sanya", "三沙市": "Sansha", "儋州市": "Danzhou",
  "五指山市": "Wuzhishan", "琼海市": "Qionghai", "文昌市": "Wenchang", "万宁市": "Wanning",
  "东方市": "Dongfang", "定安县": "Ding'an", "屯昌县": "Tunchang", "澄迈县": "Chengmai",
  "临高县": "Lingao", "白沙黎族自治县": "Baisha", "昌江黎族自治县": "Changjiang",
  "乐东黎族自治县": "Ledong", "陵水黎族自治县": "Lingshui", "保亭黎族苗族自治县": "Baoting",
  "琼中黎族苗族自治县": "Qiongzhong",
  // 四川
  "成都市": "Chengdu", "自贡市": "Zigong", "攀枝花市": "Panzhihua", "泸州市": "Luzhou",
  "德阳市": "Deyang", "绵阳市": "Mianyang", "广元市": "Guangyuan", "遂宁市": "Suining",
  "内江市": "Neijiang", "乐山市": "Leshan", "南充市": "Nanchong", "眉山市": "Meishan",
  "宜宾市": "Yibin", "广安市": "Guang'an", "达州市": "Dazhou", "雅安市": "Ya'an",
  "巴中市": "Bazhong", "资阳市": "Ziyang", "阿坝藏族羌族自治州": "Aba",
  "甘孜藏族自治州": "Garze", "凉山彝族自治州": "Liangshan",
  // 贵州
  "贵阳市": "Guiyang", "六盘水市": "Liupanshui", "遵义市": "Zunyi", "安顺市": "Anshun",
  "毕节市": "Bijie", "铜仁市": "Tongren", "黔西南布依族苗族自治州": "Qianxinan",
  "黔东南苗族侗族自治州": "Qiandongnan", "黔南布依族苗族自治州": "Qiannan",
  // 云南
  "昆明市": "Kunming", "曲靖市": "Qujing", "玉溪市": "Yuxi", "保山市": "Baoshan",
  "昭通市": "Zhaotong", "丽江市": "Lijiang", "普洱市": "Pu'er", "临沧市": "Lincang",
  "楚雄彝族自治州": "Chuxiong", "红河哈尼族彝族自治州": "Honghe",
  "文山壮族苗族自治州": "Wenshan", "西双版纳傣族自治州": "Xishuangbanna",
  "大理白族自治州": "Dali", "德宏傣族景颇族自治州": "Dehong", "怒江傈僳族自治州": "Nujiang",
  "迪庆藏族自治州": "Diqing",
  // 西藏
  "拉萨市": "Lhasa", "日喀则市": "Shigatse", "昌都市": "Qamdo", "林芝市": "Nyingchi",
  "山南市": "Lhoka", "那曲市": "Nagqu", "阿里地区": "Ngari",
  // 陕西
  "西安市": "Xi'an", "铜川市": "Tongchuan", "宝鸡市": "Baoji", "咸阳市": "Xianyang",
  "渭南市": "Weinan", "延安市": "Yan'an", "汉中市": "Hanzhong", "榆林市": "Yulin",
  "安康市": "Ankang", "商洛市": "Shangluo",
  // 甘肃
  "兰州市": "Lanzhou", "嘉峪关市": "Jiayuguan", "金昌市": "Jinchang", "白银市": "Baiyin",
  "天水市": "Tianshui", "武威市": "Wuwei", "张掖市": "Zhangye", "平凉市": "Pingliang",
  "酒泉市": "Jiuquan", "庆阳市": "Qingyang", "定西市": "Dingxi", "陇南市": "Longnan",
  "临夏回族自治州": "Linxia", "甘南藏族自治州": "Gannan",
  // 青海
  "西宁市": "Xining", "海东市": "Haidong", "海北藏族自治州": "Haibei",
  "黄南藏族自治州": "Huangnan", "海南藏族自治州": "Hainan", "果洛藏族自治州": "Golog",
  "玉树藏族自治州": "Yushu", "海西蒙古族藏族自治州": "Haixi",
  // 宁夏
  "银川市": "Yinchuan", "石嘴山市": "Shizuishan", "吴忠市": "Wuzhong", "固原市": "Guyuan",
  "中卫市": "Zhongwei",
  // 新疆
  "乌鲁木齐市": "Urumqi", "克拉玛依市": "Karamay", "吐鲁番市": "Turpan", "哈密市": "Hami",
  "昌吉回族自治州": "Changji", "博尔塔拉蒙古自治州": "Bortala",
  "巴音郭楞蒙古自治州": "Bayingolin", "阿克苏地区": "Aksu",
  "克孜勒苏柯尔克孜自治州": "Kizilsu", "喀什地区": "Kashgar", "和田地区": "Hotan",
  "伊犁哈萨克自治州": "Ili", "塔城地区": "Tacheng", "阿勒泰地区": "Altay",
  "石河子市": "Shihezi", "阿拉尔市": "Aral", "图木舒克市": "Tumxuk", "五家渠市": "Wujiaqu",
  "北屯市": "Beitun", "铁门关市": "Tiemenguan", "双河市": "Shuanghe",
  "可克达拉市": "Kokdala", "昆玉市": "Kunyu", "胡杨河市": "Huyanghe",

  // 海外
  "东京": "Tokyo", "大阪": "Osaka", "札幌": "Sapporo", "首尔": "Seoul", "釜山": "Busan",
  "新加坡": "Singapore", "曼谷": "Bangkok", "清迈": "Chiang Mai", "吉隆坡": "Kuala Lumpur",
  "雅加达": "Jakarta", "巴厘岛": "Bali", "马尼拉": "Manila", "河内": "Hanoi",
  "胡志明市": "Ho Chi Minh City", "金边": "Phnom Penh", "仰光": "Yangon",
  "加德满都": "Kathmandu", "新德里": "New Delhi", "孟买": "Mumbai", "加尔各答": "Kolkata",
  "班加罗尔": "Bangalore", "科伦坡": "Colombo", "达卡": "Dhaka", "伊斯兰堡": "Islamabad",
  "卡拉奇": "Karachi", "迪拜": "Dubai", "阿布扎比": "Abu Dhabi", "多哈": "Doha",
  "利雅得": "Riyadh", "德黑兰": "Tehran", "巴格达": "Baghdad", "特拉维夫": "Tel Aviv",
  "安曼": "Amman", "贝鲁特": "Beirut", "伊斯坦布尔": "Istanbul", "安卡拉": "Ankara",
  "莫斯科": "Moscow", "圣彼得堡": "Saint Petersburg", "新西伯利亚": "Novosibirsk",
  "叶卡捷琳堡": "Yekaterinburg", "伊尔库茨克": "Irkutsk", "海参崴": "Vladivostok",
  "雅库茨克": "Yakutsk", "摩尔曼斯克": "Murmansk", "乌兰巴托": "Ulaanbaatar",
  "阿拉木图": "Almaty", "塔什干": "Tashkent", "基辅": "Kyiv", "华沙": "Warsaw",
  "布拉格": "Prague", "维也纳": "Vienna", "布达佩斯": "Budapest", "柏林": "Berlin",
  "慕尼黑": "Munich", "法兰克福": "Frankfurt", "阿姆斯特丹": "Amsterdam",
  "布鲁塞尔": "Brussels", "苏黎世": "Zurich", "罗马": "Rome", "米兰": "Milan",
  "威尼斯": "Venice", "巴黎": "Paris", "马德里": "Madrid", "巴塞罗那": "Barcelona",
  "里斯本": "Lisbon", "雅典": "Athens", "伦敦": "London", "爱丁堡": "Edinburgh",
  "都柏林": "Dublin", "斯德哥尔摩": "Stockholm", "奥斯陆": "Oslo",
  "哥本哈根": "Copenhagen", "赫尔辛基": "Helsinki", "雷克雅未克": "Reykjavik",
  "纽约": "New York", "洛杉矶": "Los Angeles", "旧金山": "San Francisco",
  "西雅图": "Seattle", "芝加哥": "Chicago", "波士顿": "Boston", "华盛顿": "Washington",
  "迈阿密": "Miami", "丹佛": "Denver", "拉斯维加斯": "Las Vegas", "休斯敦": "Houston",
  "亚特兰大": "Atlanta", "檀香山": "Honolulu", "安克雷奇": "Anchorage",
  "多伦多": "Toronto", "温哥华": "Vancouver", "蒙特利尔": "Montreal",
  "墨西哥城": "Mexico City", "哈瓦那": "Havana", "波哥大": "Bogota", "利马": "Lima",
  "圣地亚哥": "Santiago", "圣保罗": "Sao Paulo", "里约热内卢": "Rio de Janeiro",
  "布宜诺斯艾利斯": "Buenos Aires", "开罗": "Cairo", "卡萨布兰卡": "Casablanca",
  "突尼斯": "Tunis", "阿尔及尔": "Algiers", "拉各斯": "Lagos", "阿克拉": "Accra",
  "内罗毕": "Nairobi", "亚的斯亚贝巴": "Addis Ababa", "达累斯萨拉姆": "Dar es Salaam",
  "约翰内斯堡": "Johannesburg", "开普敦": "Cape Town", "悉尼": "Sydney",
  "墨尔本": "Melbourne", "布里斯班": "Brisbane", "珀斯": "Perth", "奥克兰": "Auckland",
  "惠灵顿": "Wellington"
};

const EN_REGION = {
  "河北省": "Hebei", "山西省": "Shanxi", "内蒙古自治区": "Inner Mongolia", "辽宁省": "Liaoning",
  "吉林省": "Jilin", "黑龙江省": "Heilongjiang", "江苏省": "Jiangsu", "浙江省": "Zhejiang",
  "安徽省": "Anhui", "福建省": "Fujian", "江西省": "Jiangxi", "山东省": "Shandong",
  "河南省": "Henan", "湖北省": "Hubei", "湖南省": "Hunan", "广东省": "Guangdong",
  "广西壮族自治区": "Guangxi", "海南省": "Hainan", "四川省": "Sichuan", "贵州省": "Guizhou",
  "云南省": "Yunnan", "西藏自治区": "Tibet", "陕西省": "Shaanxi", "甘肃省": "Gansu",
  "青海省": "Qinghai", "宁夏回族自治区": "Ningxia", "新疆维吾尔自治区": "Xinjiang",
  "北京市": "Beijing", "天津市": "Tianjin", "上海市": "Shanghai", "重庆市": "Chongqing",
  "香港特别行政区": "Hong Kong SAR", "澳门特别行政区": "Macao SAR", "台湾省": "Taiwan",
  "日本": "Japan", "韩国": "South Korea", "新加坡": "Singapore", "泰国": "Thailand",
  "马来西亚": "Malaysia", "印度尼西亚": "Indonesia", "菲律宾": "Philippines",
  "越南": "Vietnam", "柬埔寨": "Cambodia", "缅甸": "Myanmar", "尼泊尔": "Nepal",
  "印度": "India", "斯里兰卡": "Sri Lanka", "孟加拉国": "Bangladesh",
  "巴基斯坦": "Pakistan", "阿联酋": "UAE", "卡塔尔": "Qatar", "沙特": "Saudi Arabia",
  "伊朗": "Iran", "伊拉克": "Iraq", "以色列": "Israel", "约旦": "Jordan",
  "黎巴嫩": "Lebanon", "土耳其": "Türkiye", "俄罗斯": "Russia", "蒙古": "Mongolia",
  "哈萨克斯坦": "Kazakhstan", "乌兹别克斯坦": "Uzbekistan", "乌克兰": "Ukraine",
  "波兰": "Poland", "捷克": "Czechia", "奥地利": "Austria", "匈牙利": "Hungary",
  "德国": "Germany", "荷兰": "Netherlands", "比利时": "Belgium", "瑞士": "Switzerland",
  "意大利": "Italy", "法国": "France", "西班牙": "Spain", "葡萄牙": "Portugal",
  "希腊": "Greece", "英国": "UK", "爱尔兰": "Ireland", "瑞典": "Sweden",
  "挪威": "Norway", "丹麦": "Denmark", "芬兰": "Finland", "冰岛": "Iceland",
  "美国": "USA", "加拿大": "Canada", "墨西哥": "Mexico", "古巴": "Cuba",
  "哥伦比亚": "Colombia", "秘鲁": "Peru", "智利": "Chile", "巴西": "Brazil",
  "阿根廷": "Argentina", "埃及": "Egypt", "摩洛哥": "Morocco", "突尼斯": "Tunisia",
  "阿尔及利亚": "Algeria", "尼日利亚": "Nigeria", "加纳": "Ghana", "肯尼亚": "Kenya",
  "埃塞俄比亚": "Ethiopia", "坦桑尼亚": "Tanzania", "南非": "South Africa",
  "澳大利亚": "Australia", "新西兰": "New Zealand"
};

/* ---------- 从 citydata 抽出中文名单 ---------- */
const src = fs.readFileSync(CITYDATA, "utf8");
function rawOf(key) {
  const i = src.indexOf(`export const ${key} = `);
  if (i < 0) throw new Error("缺常量 " + key);
  const q = src.indexOf('"', i);
  const j = src.indexOf('";', q);
  return src.slice(q + 1, j);
}
const cities = new Map();
for (const key of ["CN_CITIES_RAW", "MAP_CITIES_RAW", "GLOBAL_CITIES_RAW"]) {
  for (const rec of rawOf(key).split(";")) {
    const p = rec.split("|");
    if (p.length < 4) continue;
    if (!cities.has(p[0])) cities.set(p[0], p[3]);
  }
}
const regions = [...new Set(cities.values())];

/* ---------- 校验英文名覆盖 ---------- */
const missCity = [...cities.keys()].filter((n) => !EN[n]);
const missRegion = regions.filter((n) => !EN_REGION[n]);
if (missCity.length || missRegion.length) {
  console.error("英文名缺失：");
  if (missCity.length) console.error("  城市 " + missCity.length + " 条：", missCity.join(" "));
  if (missRegion.length) console.error("  省区 " + missRegion.length + " 条：", missRegion.join(" "));
  process.exit(1);
}
const extraCity = Object.keys(EN).filter((n) => !cities.has(n));
if (extraCity.length) console.error("提示：EN 表里有 " + extraCity.length + " 条不在城市库里（忽略）：", extraCity.join(" "));

/* ---------- 繁体（台湾正体），只落差异项 ---------- */
const s2t = OpenCC.Converter({ from: "cn", to: "twp" });
function twDiff(list) {
  const out = {};
  for (const zh of list) {
    const tw = s2t(zh);
    if (tw !== zh) out[zh] = tw;
  }
  return out;
}
const TW_CITY = twDiff([...cities.keys()]);
const TW_REGION = twDiff(regions);

/* ---------- 输出 ---------- */
function kv(obj, indent = "  ") {
  const rows = Object.entries(obj).map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return rows.join(",\n");
}

const ts = `/* =========================================================================
   SUNGLOW v2 · 城市与省区的多语言名称
   **本文件由 scripts/gen-cityname.mjs 生成，勿手改**（改数据请改脚本后重跑）。
   来源：src/core/citydata.ts 的中文名单（486 城 / 104 省区）。
   · 英文：约定俗成名优先，其余拼音（去行政后缀，如「广州市」→ Guangzhou）
   · 繁体：OpenCC s2twp（台湾正体），只存差异项 —— 未命中的回中文原名
   运行期零依赖：构建时就把两张表编译进来，不引第三方库。
   **本文件只有数据**；取词 / 拼串 / 搜索别名那套逻辑在手写的 citylang.ts。
   ========================================================================= */

/** 城市英文名（键=中文全名，与 citydata 完全一致） */
export const EN_CITY: Record<string, string> = {
${kv(EN)}
};

/** 省区 / 国家英文名 */
export const EN_REGION: Record<string, string> = {
${kv(EN_REGION)}
};

/** 城市繁体名（只存与简体不同的项） */
export const TW_CITY: Record<string, string> = {
${kv(TW_CITY)}
};

/** 省区繁体名（只存与简体不同的项） */
export const TW_REGION: Record<string, string> = {
${kv(TW_REGION)}
};
`;

fs.writeFileSync(OUT, ts);
const kb = (Buffer.byteLength(ts, "utf8") / 1024).toFixed(1);
console.log(`✓ ${path.relative(ROOT, OUT)}  ${kb} KB`);
console.log(`  城市 ${cities.size} 条 · 省区 ${regions.length} 条 · 繁体差异 城 ${Object.keys(TW_CITY).length} / 区 ${Object.keys(TW_REGION).length}`);
