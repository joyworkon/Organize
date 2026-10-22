/**
 * 正文「:关键词」emoji 建议的纯数据/纯函数层：
 * 内置常用 emoji 表（中英文关键词，首个为主短码，不引入 emoji 库），
 * 前缀优先匹配 + 1 字符查询时最近使用优先，可独立单测。
 * 标注块（Callout）图标选择器的 24 个选项是本表的子集（callout-icons.ts 各自维护，互不影响）。
 */

export interface EmojiOption {
  emoji: string;
  /** 搜索关键词（中英文，小写匹配）；首个为主短码（:fire: 直替换与浮层展示用） */
  keywords: string[];
}

export const EMOJI_SUGGEST_LIMIT = 8;

export const EMOJI_CATALOG: readonly EmojiOption[] = [
  // 表情
  { emoji: "😀", keywords: ["grinning", "grin", "笑", "开心", "笑脸"] },
  { emoji: "😄", keywords: ["smile", "happy", "笑", "开心", "大笑"] },
  { emoji: "😁", keywords: ["grin", "beaming", "笑", "咧嘴"] },
  { emoji: "😆", keywords: ["laughing", "xd", "笑", "大笑", "哈哈"] },
  { emoji: "😅", keywords: ["sweat_smile", "sweat", "笑", "尴尬", "苦笑"] },
  { emoji: "🤣", keywords: ["rofl", "lol", "笑翻", "爆笑", "哈哈"] },
  { emoji: "😂", keywords: ["laugh", "funny", "笑", "搞笑", "哈哈", "开心"] },
  { emoji: "🙂", keywords: ["slightly_smiling", "smile", "微笑"] },
  { emoji: "😉", keywords: ["wink", "眨眼"] },
  { emoji: "😊", keywords: ["blush", "shy", "害羞", "开心", "微笑"] },
  { emoji: "😍", keywords: ["heart_eyes", "love", "爱心眼", "喜欢", "花痴"] },
  { emoji: "😘", keywords: ["kiss", "亲亲", "飞吻"] },
  { emoji: "😋", keywords: ["yum", "delicious", "好吃", "美味", "馋"] },
  { emoji: "😜", keywords: ["stuck_out_tongue", "playful", "调皮", "吐舌"] },
  { emoji: "🤪", keywords: ["zany", "crazy", "疯", "搞怪"] },
  { emoji: "🤔", keywords: ["think", "consider", "考虑", "思考", "疑惑", "想想"] },
  { emoji: "🤨", keywords: ["raised_eyebrow", "doubt", "怀疑", "挑眉"] },
  { emoji: "🙄", keywords: ["eye_roll", "翻白眼", "无语"] },
  { emoji: "😟", keywords: ["worried", "担心", "焦虑"] },
  { emoji: "😕", keywords: ["confused", "困惑"] },
  { emoji: "😮", keywords: ["open_mouth", "wow", "惊讶"] },
  { emoji: "😳", keywords: ["flushed", "脸红", "害羞"] },
  { emoji: "🥺", keywords: ["pleading", "please", "拜托", "可怜", "求"] },
  { emoji: "😢", keywords: ["tear", "cry", "哭", "伤心"] },
  { emoji: "😭", keywords: ["cry", "sad", "哭", "难过", "伤心"] },
  { emoji: "😱", keywords: ["scream", "fear", "害怕", "尖叫"] },
  { emoji: "😡", keywords: ["angry", "mad", "生气", "愤怒", "气"] },
  { emoji: "🤬", keywords: ["cursing", "swear", "骂人", "爆粗"] },
  { emoji: "💀", keywords: ["skull", "death", "骷髅", "笑死"] },
  { emoji: "💩", keywords: ["poop", "shit", "便便"] },
  { emoji: "👻", keywords: ["ghost", "鬼", "幽灵"] },
  { emoji: "🤖", keywords: ["robot", "机器人"] },
  // 手势与人
  { emoji: "👋", keywords: ["wave", "hello", "挥手", "你好", "再见"] },
  { emoji: "✋", keywords: ["raised_hand", "stop", "举手", "停"] },
  { emoji: "👌", keywords: ["ok_hand", "ok", "好的", "可以"] },
  { emoji: "✌️", keywords: ["victory", "peace", "耶", "胜利", "剪刀手"] },
  { emoji: "🤞", keywords: ["crossed_fingers", "luck", "祈祷", "好运"] },
  { emoji: "👈", keywords: ["point_left", "left", "左", "指左"] },
  { emoji: "👉", keywords: ["point_right", "right", "右", "指右"] },
  { emoji: "👆", keywords: ["point_up", "up", "上", "指上"] },
  { emoji: "👇", keywords: ["point_down", "down", "下", "指下"] },
  { emoji: "👍", keywords: ["up", "like", "good", "赞", "好", "顶", "点赞"] },
  { emoji: "👎", keywords: ["down", "bad", "踩", "不好", "差"] },
  { emoji: "✊", keywords: ["fist", "拳头", "加油"] },
  { emoji: "👏", keywords: ["clap", "鼓掌", "拍手"] },
  { emoji: "🙌", keywords: ["raised_hands", "celebrate", "庆祝", "万岁"] },
  { emoji: "🙏", keywords: ["pray", "please", "thanks", "拜托", "感谢", "祈祷"] },
  { emoji: "🤝", keywords: ["handshake", "deal", "握手", "合作"] },
  { emoji: "💪", keywords: ["strong", "power", "力量", "加油", "肌肉"] },
  { emoji: "✍️", keywords: ["writing_hand", "write", "写字", "写作"] },
  { emoji: "👀", keywords: ["eyes", "look", "看", "眼睛", "围观"] },
  { emoji: "🧠", keywords: ["brain", "smart", "大脑", "聪明"] },
  { emoji: "👶", keywords: ["baby", "宝宝", "婴儿"] },
  { emoji: "🧑‍💻", keywords: ["technologist", "coder", "程序员", "码农"] },
  { emoji: "🏃", keywords: ["runner", "run", "跑步", "跑"] },
  { emoji: "💃", keywords: ["dancer", "dance", "跳舞"] },
  // 动物与自然
  { emoji: "🐶", keywords: ["dog", "狗", "狗狗"] },
  { emoji: "🐱", keywords: ["cat", "猫", "猫咪"] },
  { emoji: "🐭", keywords: ["mouse", "老鼠"] },
  { emoji: "🐰", keywords: ["rabbit", "bunny", "兔子"] },
  { emoji: "🦊", keywords: ["fox", "狐狸"] },
  { emoji: "🐻", keywords: ["bear", "熊"] },
  { emoji: "🐼", keywords: ["panda", "熊猫"] },
  { emoji: "🐯", keywords: ["tiger", "老虎"] },
  { emoji: "🐷", keywords: ["pig", "猪"] },
  { emoji: "🐸", keywords: ["frog", "青蛙"] },
  { emoji: "🐵", keywords: ["monkey_face", "猴子"] },
  { emoji: "🙈", keywords: ["see_no_evil", "捂眼", "非礼勿视"] },
  { emoji: "🙉", keywords: ["hear_no_evil", "捂耳"] },
  { emoji: "🙊", keywords: ["speak_no_evil", "捂嘴"] },
  { emoji: "🐧", keywords: ["penguin", "企鹅"] },
  { emoji: "🐦", keywords: ["bird", "鸟"] },
  { emoji: "🦆", keywords: ["duck", "鸭子"] },
  { emoji: "🦄", keywords: ["unicorn", "独角兽"] },
  { emoji: "🐝", keywords: ["bee", "蜜蜂"] },
  { emoji: "🦋", keywords: ["butterfly", "蝴蝶"] },
  { emoji: "🐢", keywords: ["turtle", "乌龟"] },
  { emoji: "🐍", keywords: ["snake", "蛇"] },
  { emoji: "🐙", keywords: ["octopus", "章鱼"] },
  { emoji: "🐠", keywords: ["tropical_fish", "fish", "鱼"] },
  { emoji: "🐬", keywords: ["dolphin", "海豚"] },
  { emoji: "🐳", keywords: ["whale", "鲸鱼"] },
  { emoji: "🐘", keywords: ["elephant", "大象"] },
  { emoji: "🌴", keywords: ["palm_tree", "棕榈树", "椰子树"] },
  { emoji: "🌱", keywords: ["seedling", "幼苗", "发芽"] },
  { emoji: "🍀", keywords: ["four_leaf_clover", "luck", "四叶草", "幸运"] },
  { emoji: "🍁", keywords: ["maple_leaf", "枫叶"] },
  { emoji: "🌻", keywords: ["sunflower", "向日葵"] },
  { emoji: "🌹", keywords: ["rose", "玫瑰", "花"] },
  { emoji: "🌷", keywords: ["tulip", "郁金香"] },
  { emoji: "🌸", keywords: ["cherry_blossom", "sakura", "樱花", "花"] },
  { emoji: "💐", keywords: ["bouquet", "花束"] },
  { emoji: "🌍", keywords: ["earth_africa", "globe", "earth", "地球"] },
  { emoji: "🌙", keywords: ["crescent_moon", "moon", "月亮", "月牙"] },
  { emoji: "⭐", keywords: ["star", "favorite", "星", "收藏", "重点"] },
  { emoji: "🌟", keywords: ["glowing_star", "star", "星星", "闪亮"] },
  { emoji: "✨", keywords: ["sparkles", "闪亮", "星星", "魔法"] },
  { emoji: "⚡", keywords: ["zap", "lightning", "闪电", "快"] },
  { emoji: "🔥", keywords: ["fire", "hot", "火", "热门", "重要"] },
  { emoji: "🌈", keywords: ["rainbow", "彩虹"] },
  { emoji: "☀️", keywords: ["sunny", "sun", "太阳", "晴"] },
  { emoji: "☁️", keywords: ["cloud", "云"] },
  { emoji: "🌧️", keywords: ["rain", "下雨", "雨"] },
  { emoji: "❄️", keywords: ["snowflake", "snow", "雪", "雪花"] },
  { emoji: "🌊", keywords: ["ocean", "wave", "海浪", "海"] },
  // 食物饮品
  { emoji: "🍎", keywords: ["apple", "苹果"] },
  { emoji: "🍊", keywords: ["tangerine", "orange", "橘子", "橙子"] },
  { emoji: "🍋", keywords: ["lemon", "柠檬"] },
  { emoji: "🍌", keywords: ["banana", "香蕉"] },
  { emoji: "🍉", keywords: ["watermelon", "西瓜"] },
  { emoji: "🍇", keywords: ["grapes", "葡萄"] },
  { emoji: "🍓", keywords: ["strawberry", "草莓"] },
  { emoji: "🍒", keywords: ["cherries", "樱桃"] },
  { emoji: "🍑", keywords: ["peach", "桃子"] },
  { emoji: "🍍", keywords: ["pineapple", "菠萝"] },
  { emoji: "🍅", keywords: ["tomato", "西红柿", "番茄"] },
  { emoji: "🥑", keywords: ["avocado", "牛油果"] },
  { emoji: "🌶️", keywords: ["hot_pepper", "spicy", "辣椒", "辣"] },
  { emoji: "🌽", keywords: ["corn", "玉米"] },
  { emoji: "🥕", keywords: ["carrot", "胡萝卜"] },
  { emoji: "🍞", keywords: ["bread", "面包"] },
  { emoji: "🧀", keywords: ["cheese", "奶酪", "芝士"] },
  { emoji: "🥚", keywords: ["egg", "鸡蛋"] },
  { emoji: "🍳", keywords: ["fried_egg", "cooking", "煎蛋", "做饭"] },
  { emoji: "🍔", keywords: ["hamburger", "burger", "汉堡"] },
  { emoji: "🍟", keywords: ["fries", "薯条"] },
  { emoji: "🍕", keywords: ["pizza", "披萨"] },
  { emoji: "🥗", keywords: ["salad", "沙拉"] },
  { emoji: "🍝", keywords: ["spaghetti", "pasta", "意面"] },
  { emoji: "🍜", keywords: ["ramen", "noodles", "拉面", "面条"] },
  { emoji: "🍲", keywords: ["stew", "hotpot", "火锅", "炖菜"] },
  { emoji: "🍛", keywords: ["curry", "咖喱"] },
  { emoji: "🍣", keywords: ["sushi", "寿司"] },
  { emoji: "🥟", keywords: ["dumpling", "饺子"] },
  { emoji: "🍦", keywords: ["soft_serve", "甜筒", "冰淇淋"] },
  { emoji: "🍰", keywords: ["cake", "shortcake", "蛋糕"] },
  { emoji: "🎂", keywords: ["birthday", "cake", "生日", "蛋糕"] },
  { emoji: "🍬", keywords: ["candy", "糖果", "糖"] },
  { emoji: "🍫", keywords: ["chocolate", "巧克力"] },
  { emoji: "🍪", keywords: ["cookie", "饼干"] },
  { emoji: "🥛", keywords: ["milk", "牛奶"] },
  { emoji: "☕", keywords: ["coffee", "咖啡", "热饮"] },
  { emoji: "🍵", keywords: ["tea", "茶", "绿茶"] },
  { emoji: "🥤", keywords: ["cup_with_straw", "drink", "饮料", "奶茶"] },
  { emoji: "🧋", keywords: ["bubble_tea", "boba", "珍珠奶茶", "奶茶"] },
  { emoji: "🍺", keywords: ["beer", "啤酒"] },
  { emoji: "🍻", keywords: ["beers", "cheers", "干杯", "啤酒"] },
  { emoji: "🥂", keywords: ["champagne", "toast", "香槟", "碰杯", "庆祝"] },
  { emoji: "🍷", keywords: ["wine", "红酒", "葡萄酒"] },
  // 运动与娱乐
  { emoji: "⚽", keywords: ["soccer", "football", "足球"] },
  { emoji: "🏀", keywords: ["basketball", "篮球"] },
  { emoji: "🎾", keywords: ["tennis", "网球"] },
  { emoji: "🏓", keywords: ["ping_pong", "乒乓球"] },
  { emoji: "🏋️", keywords: ["weight_lifter", "gym", "举重", "健身"] },
  { emoji: "🏊", keywords: ["swimmer", "swim", "游泳"] },
  { emoji: "🚴", keywords: ["cyclist", "bike", "骑车", "骑行"] },
  { emoji: "🏆", keywords: ["trophy", "奖杯", "冠军"] },
  { emoji: "🥇", keywords: ["first_place", "medal", "金牌", "第一"] },
  { emoji: "🎨", keywords: ["art", "palette", "画画", "艺术", "调色板"] },
  { emoji: "🎬", keywords: ["clapper", "movie", "电影", "拍摄"] },
  { emoji: "🎤", keywords: ["microphone", "麦克风", "唱歌"] },
  { emoji: "🎧", keywords: ["headphones", "music", "耳机", "听歌"] },
  { emoji: "🎸", keywords: ["guitar", "吉他"] },
  { emoji: "🎲", keywords: ["dice", "game", "骰子", "随机"] },
  { emoji: "🎯", keywords: ["target", "goal", "目标", "目的", "靶"] },
  { emoji: "🎮", keywords: ["video_game", "game", "游戏", "手柄"] },
  { emoji: "🧩", keywords: ["puzzle", "jigsaw", "拼图"] },
  // 出行与地点
  { emoji: "🚗", keywords: ["car", "red_car", "汽车", "车"] },
  { emoji: "🚕", keywords: ["taxi", "出租车"] },
  { emoji: "🚌", keywords: ["bus", "公交车"] },
  { emoji: "🚲", keywords: ["bike", "bicycle", "自行车"] },
  { emoji: "🚨", keywords: ["rotating_light", "alarm", "警报", "警灯"] },
  { emoji: "🚄", keywords: ["bullet_train", "高铁", "动车"] },
  { emoji: "🚇", keywords: ["metro", "subway", "地铁"] },
  { emoji: "✈️", keywords: ["airplane", "plane", "飞机"] },
  { emoji: "🚀", keywords: ["rocket", "launch", "发布", "上线", "快速", "火箭"] },
  { emoji: "🚢", keywords: ["ship", "船", "轮船"] },
  { emoji: "⛽", keywords: ["fuel", "gas", "加油", "加油站"] },
  { emoji: "🚦", keywords: ["traffic_light", "红绿灯"] },
  { emoji: "🏠", keywords: ["house", "home", "家", "房子"] },
  { emoji: "🏢", keywords: ["office", "公司", "办公楼"] },
  { emoji: "🏥", keywords: ["hospital", "医院"] },
  { emoji: "🏫", keywords: ["school", "学校"] },
  { emoji: "🌅", keywords: ["sunrise", "日出"] },
  { emoji: "🌇", keywords: ["sunset", "日落", "夕阳"] },
  // 物品
  { emoji: "⌚", keywords: ["watch", "手表"] },
  { emoji: "📱", keywords: ["iphone", "mobile", "phone", "手机"] },
  { emoji: "💻", keywords: ["computer", "laptop", "电脑", "笔记本"] },
  { emoji: "📷", keywords: ["camera", "photo", "相机", "拍照"] },
  { emoji: "📸", keywords: ["camera_flash", "拍照"] },
  { emoji: "📺", keywords: ["tv", "television", "电视"] },
  { emoji: "⏰", keywords: ["alarm_clock", "alarm", "闹钟"] },
  { emoji: "⏳", keywords: ["hourglass_flowing", "hourglass", "沙漏", "时间"] },
  { emoji: "🔋", keywords: ["battery", "电池"] },
  { emoji: "🔌", keywords: ["plug", "插头", "电源"] },
  { emoji: "💡", keywords: ["idea", "light", "tip", "提示", "灵感", "想法", "灯泡"] },
  { emoji: "💰", keywords: ["moneybag", "money", "钱", "金钱"] },
  { emoji: "💎", keywords: ["gem", "diamond", "钻石", "宝石"] },
  { emoji: "🔧", keywords: ["wrench", "tool", "扳手", "工具"] },
  { emoji: "🔨", keywords: ["hammer", "锤子"] },
  { emoji: "🛠️", keywords: ["tools", "工具", "修理"] },
  { emoji: "⚙️", keywords: ["gear", "settings", "齿轮", "设置"] },
  { emoji: "🧲", keywords: ["magnet", "磁铁"] },
  { emoji: "💣", keywords: ["bomb", "炸弹"] },
  { emoji: "🧨", keywords: ["firecracker", "鞭炮", "爆竹"] },
  { emoji: "🔪", keywords: ["knife", "刀"] },
  { emoji: "🛡️", keywords: ["shield", "盾牌", "保护"] },
  { emoji: "🔬", keywords: ["microscope", "science", "显微镜", "科学"] },
  { emoji: "💊", keywords: ["pill", "medicine", "药", "药丸"] },
  { emoji: "🔑", keywords: ["key", "钥匙"] },
  { emoji: "🚪", keywords: ["door", "门"] },
  { emoji: "🛒", keywords: ["shopping_cart", "cart", "购物车"] },
  { emoji: "🎁", keywords: ["gift", "present", "礼物"] },
  { emoji: "🎈", keywords: ["balloon", "气球"] },
  { emoji: "🎀", keywords: ["ribbon", "蝴蝶结", "丝带"] },
  { emoji: "🎊", keywords: ["confetti", "彩带", "庆祝"] },
  { emoji: "🎉", keywords: ["party", "celebrate", "庆祝", "祝贺", "好棒"] },
  { emoji: "🪄", keywords: ["magic_wand", "magic", "魔法棒", "魔法"] },
  { emoji: "📦", keywords: ["package", "box", "包裹", "快递"] },
  { emoji: "🏷️", keywords: ["label", "tag", "标签"] },
  { emoji: "📅", keywords: ["calendar", "date", "日历", "日期"] },
  { emoji: "📚", keywords: ["books", "book", "书", "书籍"] },
  { emoji: "📖", keywords: ["book", "read", "书", "阅读", "书本"] },
  { emoji: "🔖", keywords: ["bookmark", "书签"] },
  { emoji: "🔗", keywords: ["link", "链接"] },
  { emoji: "📎", keywords: ["paperclip", "回形针", "附件"] },
  { emoji: "📌", keywords: ["pin", "pinned", "图钉", "置顶", "固定", "钉"] },
  { emoji: "📍", keywords: ["round_pushpin", "location", "位置", "地点", "定位"] },
  { emoji: "✂️", keywords: ["scissors", "cut", "剪刀"] },
  { emoji: "📝", keywords: ["note", "write", "edit", "笔记", "记录", "编辑", "备忘"] },
  { emoji: "🔍", keywords: ["mag", "search", "搜索", "放大镜"] },
  { emoji: "🔒", keywords: ["lock", "locked", "锁", "锁定", "加密"] },
  { emoji: "🔓", keywords: ["unlock", "解锁", "打开"] },
  // 符号
  { emoji: "❤️", keywords: ["heart", "like", "love", "爱", "喜欢", "心", "点赞"] },
  { emoji: "💔", keywords: ["broken_heart", "心碎"] },
  { emoji: "💕", keywords: ["two_hearts", "爱心"] },
  { emoji: "💖", keywords: ["sparkling_heart", "爱心"] },
  { emoji: "💯", keywords: ["perfect", "hundred", "满分", "百分", "完美"] },
  { emoji: "✅", keywords: ["check", "done", "ok", "完成", "已办", "对", "勾"] },
  { emoji: "❌", keywords: ["cross", "wrong", "fail", "错误", "失败", "叉", "不对"] },
  { emoji: "❗", keywords: ["important", "exclaim", "重要", "感叹", "惊叹"] },
  { emoji: "❓", keywords: ["question", "help", "问题", "疑问", "帮助", "提问"] },
  { emoji: "⚠️", keywords: ["warning", "caution", "warn", "警告", "注意", "小心"] },
  { emoji: "💬", keywords: ["comment", "talk", "chat", "评论", "对话", "消息", "留言"] },
  { emoji: "💭", keywords: ["thought_balloon", "想法", "思考"] },
  { emoji: "➕", keywords: ["plus", "加"] },
  { emoji: "➖", keywords: ["minus", "减"] },
  { emoji: "✖️", keywords: ["multiply", "乘", "叉"] },
  { emoji: "➗", keywords: ["divide", "除"] },
  { emoji: "♾️", keywords: ["infinity", "无限"] },
  { emoji: "🚫", keywords: ["no_entry", "prohibited", "禁止"] },
  { emoji: "⭕", keywords: ["circle", "correct", "圈", "对"] },
  { emoji: "🔄", keywords: ["refresh", "repeat", "刷新", "循环"] },
  { emoji: "🔝", keywords: ["top", "顶部", "置顶"] },
  { emoji: "🆘", keywords: ["sos", "help", "救命", "求助"] },
];

/** 查询归一化：小写、去首尾空白（调用方已保证无空格，这里只是防御） */
function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * 关键词匹配 emoji：前缀匹配优先于子串匹配，同级保持表内顺序（常用在前）。
 * 查询只有 1 个字符时，最近使用且匹配的 emoji 排到最前（按最近顺序）。
 */
export function searchEmoji(query: string, recentEmojis: readonly string[] = [], limit = EMOJI_SUGGEST_LIMIT): EmojiOption[] {
  const normalized = normalizeQuery(query);
  if (!normalized || limit < 1) return [];
  const prefix: EmojiOption[] = [];
  const partial: EmojiOption[] = [];
  for (const option of EMOJI_CATALOG) {
    let isPrefix = false;
    let isPartial = false;
    for (const keyword of option.keywords) {
      if (keyword.startsWith(normalized)) { isPrefix = true; break; }
      if (keyword.includes(normalized)) isPartial = true;
    }
    if (isPrefix) prefix.push(option);
    else if (isPartial || option.emoji.includes(normalized)) partial.push(option);
  }
  const ranked = [...prefix, ...partial];
  if (normalized.length !== 1 || !recentEmojis.length) return ranked.slice(0, limit);
  const recent: EmojiOption[] = [];
  for (const emoji of recentEmojis) {
    const option = ranked.find((candidate) => candidate.emoji === emoji);
    if (option && !recent.includes(option)) recent.push(option);
  }
  if (!recent.length) return ranked.slice(0, limit);
  return [...recent, ...ranked.filter((option) => !recent.includes(option))].slice(0, limit);
}

/** 精确短码匹配（:fire: 直替换用）：大小写不敏感，命中任一关键词即返回 */
export function findEmojiByShortcode(query: string): EmojiOption | null {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;
  for (const option of EMOJI_CATALOG) {
    if (option.keywords.some((keyword) => keyword === normalized)) return option;
  }
  return null;
}
