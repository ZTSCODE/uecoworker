import { useLangStore } from "./i18n";

// 游戏主题的“风味文案”库。本 agent 面向游戏制作，所以把通用的“正在思考…”
// 替换成不断变化、富有想象力、贴合游戏/奇幻/游戏开发主题的短语；把“已就绪”
// 替换成一批语义仍清晰指向“准备好了”的就绪短语（避免用户困惑）。
//
// 约定：
// - THINKING_PHRASES 是“模型名”之后拼接的后缀，渲染为「{模型名} {短语}」。
//   全部以「…中…」收尾，表达“正在进行中”的持续状态（对应 Claude 的 -ing 进行
//   时），而不是一次性动作。需要非常大量（200+），因为它会持续轮换。
// - READY_PHRASES 是空会话欢迎页「{模型名} {短语}」的后缀，语义都明确等价于
//   “已就绪/准备好了/整装待发”，按会话 id 确定性挑选，同会话稳定、跨会话不同。

// 思考中：持续轮换的游戏化进度短语（≥200 条），统一为进行态「…中…」。
export const THINKING_PHRASES: string[] = [
  // —— 锻造 / 装备 ——
  "打磨传说级装备中…",
  "在铁砧上回火断剑中…",
  "为护甲镶嵌符文中…",
  "重铸碎裂的圣盾中…",
  "淬炼一把会低语的匕首中…",
  "给战锤缠绕雷霆中…",
  "擦亮蒙尘的王冠中…",
  "校准弩炮的扳机中…",
  "为长弓重新上弦中…",
  "熔炼陨铁、锻造箭簇中…",
  "把铠甲抛光到照出人影中…",
  "为空荡的法杖灌注魔力中…",
  "敲直被巨人踩弯的长矛中…",
  "为护手缝制龙皮衬里中…",
  "在剑刃上蚀刻古老誓言中…",
  // —— 酒馆 / 线索 / 任务 ——
  "在酒馆角落打探消息中…",
  "向吟游诗人打听往事中…",
  "拼凑悬赏告示上的线索中…",
  "翻找任务板的新委托中…",
  "和神秘斗篷客交换情报中…",
  "追踪一封被撕碎的密信中…",
  "破译盗贼公会的暗号中…",
  "盘问醉醺醺的老水手中…",
  "在账本里追查失踪的金币中…",
  "跟踪戴面具的告密者中…",
  "拼合摔碎的预言石板中…",
  "顺着血迹追查失踪的信使中…",
  "在通缉墙上比对嫌犯画像中…",
  "向城门卫兵套话中…",
  "把零碎传闻串成线索中…",
  // —— 烹饪 / 篝火 ——
  "在篝火上翻烤独眼巨鸟的鸟翅中…",
  "熬煮咕嘟作响的史莱姆浓汤中…",
  "为烤龙排撒火山岩盐中…",
  "腌制狮鹫的胸脯肉中…",
  "用月光草煨炖魔法炖菜中…",
  "翻烤穿在长矛上的野猪中…",
  "调制冒泡的回复药水中…",
  "烘焙矮人黑麦面包中…",
  "为远征队风干兽肉中…",
  "搅动女巫的咕嘟大锅中…",
  "温烫一壶蜂蜜酒中…",
  "撒入会发光的香料中…",
  "给炖菜偷偷加颗龙之心中…",
  "在余烬里烤精灵土豆中…",
  "晾晒明日要带的肉干中…",
  // —— 探索 / 地牢 / 地图 ——
  "绘制未知地牢的地图中…",
  "点亮幽暗洞窟的火把中…",
  "撬开生锈的宝箱中…",
  "解开石门上的谜题中…",
  "探查坍塌回廊的暗道中…",
  "丈量深渊的回声中…",
  "在迷雾沼泽里辨认方向中…",
  "拨开藤蔓寻找遗迹入口中…",
  "标记安全屋的位置中…",
  "聆听地下河的流向中…",
  "数清陷阱地砖的间距中…",
  "贴墙细听空响中…",
  "顺着锈迹寻找拉杆开关中…",
  "在地图边缘补全空白中…",
  "辨认天花板上的星座刻纹中…",
  // —— 魔法 / 卷轴 / 施法 ——
  "誊抄一卷禁忌咒文中…",
  "为法杖充能中…",
  "调配星辰墨水中…",
  "校准传送门的坐标中…",
  "封印躁动的元素精灵中…",
  "解读漂浮的魔法符文中…",
  "唤醒沉睡的守护魔像中…",
  "编织一道护盾结界中…",
  "推演占星盘的指引中…",
  "点燃符文水晶中…",
  "把咒语压缩进一枚护符中…",
  "稳住快要失控的法阵中…",
  "为卷轴系上防潮封印中…",
  "调准沙漏里的时间魔法中…",
  "向水晶球低声问路中…",
  // —— 怪物 / 战斗 ——
  "研判巨龙的弱点中…",
  "布置对付亡灵的陷阱中…",
  "演练剑盾连招中…",
  "计算暴击的最佳时机中…",
  "潜行绕过沉睡的巨人中…",
  "把敌人诱进狭窄峡谷中…",
  "为伏击重新调整阵型中…",
  "观察哥布林的巡逻路线中…",
  "估算这场遭遇战的胜算中…",
  "拔出嵌在巨石里的剑中…",
  "给弩箭抹上麻痹毒液中…",
  "盯紧 Boss 露出的破绽中…",
  "屏息等待换弹的空档中…",
  "数清骷髅大军的数量中…",
  "寻找巨像膝盖的裂缝中…",
  // —— 宝藏 / 战利品 ——
  "清点鼓鼓的战利品袋中…",
  "鉴定一枚来路不明的戒指中…",
  "称量龙窟里的金币中…",
  "为稀有掉落估价中…",
  "擦去宝石上的尘土中…",
  "公平分配队伍奖励中…",
  "解锁封印已久的宝库中…",
  "辨别赝品与真宝物中…",
  "把战利品塞进满背包中…",
  "对着光检视一颗龙之泪中…",
  // —— NPC / 对话 ——
  "聆听老国王的临终遗愿中…",
  "安抚受惊的村民中…",
  "说服固执的守卫放行中…",
  "与商队首领讨价还价中…",
  "向贤者请教古老的预言中…",
  "哄睡哭闹的龙宝宝中…",
  "替铁匠跑腿办事中…",
  "回应公主塔顶的求救中…",
  "为迷路的小精灵指路中…",
  "听铁匠抱怨涨价的矿石中…",
  "陪老兵回忆当年的战役中…",
  "替村长清点失窃的家禽中…",
  // —— 游戏开发梗（贴合本 agent 的本职）——
  "编译关卡的着色器中…",
  "烘焙场景的全局光照中…",
  "修复角色的碰撞体中…",
  "绑定怪物的骨骼动画中…",
  "加载下一张关卡中…",
  "调试敌人的寻路网格中…",
  "平衡 Boss 的血量数值中…",
  "细调粒子特效的配色中…",
  "把资源打包进游戏体中…",
  "校准相机的跟随曲线中…",
  "排查掉帧的元凶中…",
  "重连物理引擎的关节中…",
  "合并冲突的存档分支中…",
  "为对话树补全缺失的分支中…",
  "生成一座程序化地牢中…",
  "压缩纹理的内存占用中…",
  "缝合破碎的网格法线中…",
  "重算导航网格中…",
  "注入一条新的成就解锁中…",
  "热重载技能脚本中…",
  "为 NPC 绘制待机动画中…",
  "调试失灵的机关触发器中…",
  "把音效对齐到打击帧中…",
  "修掉穿模的披风中…",
  "给天空盒换上黄昏中…",
  "为关卡埋藏隐藏彩蛋中…",
  "重写卡死的状态机中…",
  "给水面加上反射中…",
  "削减一帧里过多的 draw call 中…",
  "把存档迁移到新版本中…",
  // —— 角色 / 技能 / 同伴 ——
  "分配刚到手的技能点中…",
  "研习失传的剑术流派中…",
  "擦亮冒险者的徽章中…",
  "缝补旅途磨破的披风中…",
  "喂养随行的幼龙中…",
  "训练猎鹰去侦察中…",
  "为坐骑钉上新蹄铁中…",
  "点亮天赋树的下一节点中…",
  "为同伴包扎战斗的伤口中…",
  "教鹦鹉学说暗号中…",
  "替战马刷洗鬃毛中…",
  "把经验值兑换成新招式中…",
  // —— 商队 / 旅途 ——
  "为远征清点补给中…",
  "扬起商船的风帆中…",
  "在星图上规划航线中…",
  "牵着驮兽翻越雪山中…",
  "搭建过夜的营地中…",
  "检查马车的轮轴中…",
  "横渡湍急的暗河中…",
  "追赶最后一班渡船中…",
  "钉牢防风的帐篷中…",
  "在岔路口掷硬币决定方向中…",
  "给篝火添上最后一捆柴中…",
  "顺着北极星校正方向中…",
  // —— 其他想象力满满 ——
  "摇动命运的骰子中…",
  "洗一副会预言的塔罗中…",
  "聆听森林深处的低语中…",
  "收集流星坠落的碎片中…",
  "在沙漏里凝视时间中…",
  "拨动古老的八音盒中…",
  "召集失散的队友中…",
  "擦亮水晶球窥探未来中…",
  "给信鸽系上口信中…",
  "清点背包格子里的家当中…",
  "辨认地图边缘的可疑污渍中…",
  "打捞沉船的航海日志中…",
  "唤醒会说话的魔法书中…",
  "喂饱看门的三头犬中…",
  "临摹壁画上失落的符号中…",
  "调试机关城堡的齿轮中…",
  "平息火山祭坛的怒火中…",
  "擦净蒙尘的传送法阵中…",
  "为夜战点燃信号烟中…",
  "跟随萤火虫穿越暗林中…",
  "把愿望投进许愿井中…",
  "翻译矮人语的墓志铭中…",
  "为迷宫做回程记号中…",
  "聆听贝壳里的海妖之歌中…",
  "为篝火旁的故事续写结尾中…",
  "驯服一团乱跑的火元素中…",
  "在月圆夜采集发光蘑菇中…",
  "让碎掉的怀表重新走动中…",
  "拼合两张半截藏宝图中…",
  "为星象师记录今夜的异象中…",
  "给守望塔点亮长明灯中…",
  "细读漂流瓶里的信中…",
  "唤回走失的牧羊犬中…",
  "为城邦的庆典扎彩灯中…",
  "调好鲁特琴准备登台中…",
  "为药剂师碾碎晨露草中…",
  "在结霜的窗上画下路线中…",
  "数清钟楼还要敲几下中…",
  "拼上最后一块拼图中…",
  "为沉睡的火山做记号中…",
  "替灯塔守夜人添油中…",
  "在沙地上推演棋局中…",
  "解开缠成一团的钓线中…",
  "护送迷路的萤火虫回家中…",
  "给古钟上紧发条中…",
  "为信使誊清潦草的口信中…",
  "在岩壁上凿出落脚点中…",
  "把翻倒的墨水归位中…",
  "为商人核对走私清单中…",
  "为夜枭规划巡逻路线中…",
  "把命运之轮再推一格中…",
];

// 就绪：空会话欢迎页用，语义都明确等价于“准备好了/整装待发”。
export const READY_PHRASES: string[] = [
  "已就绪",
  "准备好了",
  "整装待发",
  "随时出发",
  "蓄势待发",
  "已就位，听候差遣",
  "装备已检查完毕，可以出发",
  "已点亮篝火，等你下令",
  "背包已备齐，启程吧",
  "已磨好刀，随时动手",
  "已铺开地图，等你指路",
  "已上膛，待命中",
  "已系好披风，准备启程",
  "营地已扎好，随时拔营",
  "法杖已充能，听候召唤",
  "已备好补给，只等出发",
  "护甲已穿戴整齐",
  "已校准罗盘，可以启航",
  "已点齐人马，待命出征",
  "已热好炉子，开工吧",
  "卷轴已展开，准备施法",
  "坐骑已备鞍，随时启程",
  "已就位，请下达任务",
  "弓已上弦，箭已搭好",
  "已清点完行囊，出发待命",
  "已生好火，随时开锅",
  "传送阵已点亮，待命中",
  "已擦亮徽章，准备接令",
  "灯笼已点上，可以夜行",
  "已收拾妥当，听你号令",
];

// English thinking phrases: imaginative game / fantasy / gamedev themed,
// progressive "...ing…" style. Kept in lockstep with the spirit of the
// Chinese THINKING_PHRASES (the Chinese array above is intentionally untouched).
export const THINKING_PHRASES_EN: string[] = [
  // —— Forging / gear ——
  "Forging a legendary blade…",
  "Tempering a shattered sword on the anvil…",
  "Inlaying runes into the armor…",
  "Reforging the broken holy shield…",
  "Quenching a whispering dagger…",
  "Wrapping the warhammer in thunder…",
  "Polishing a dust-covered crown…",
  "Calibrating the ballista's trigger…",
  "Restringing the longbow…",
  "Smelting meteoric iron into arrowheads…",
  "Buffing the breastplate to a mirror shine…",
  "Channeling mana into an empty staff…",
  "Stitching a dragonhide lining into the gauntlets…",
  // —— Tavern / clues / quests ——
  "Asking around in the tavern corner…",
  "Coaxing old tales from the bard…",
  "Piecing together the bounty board clues…",
  "Sifting the quest board for new contracts…",
  "Trading secrets with a hooded stranger…",
  "Decoding the thieves' guild cipher…",
  "Tracing a torn cipher letter…",
  "Following a trail of blood to the missing courier…",
  "Comparing the suspect's portrait on the wanted wall…",
  "Spinning scattered rumors into a lead…",
  // —— Cooking / campfire ——
  "Roasting a cyclops-bird wing over the campfire…",
  "Simmering a bubbling slime stew…",
  "Sprinkling volcanic salt on the dragon steak…",
  "Brewing a fizzing healing potion…",
  "Baking dwarven rye bread…",
  "Stirring the witch's bubbling cauldron…",
  "Slipping a dragon heart into the stew…",
  "Drying jerky for tomorrow's march…",
  // —— Exploring / dungeons / maps ——
  "Mapping out an unknown dungeon…",
  "Lighting torches in the gloomy cavern…",
  "Prying open a rusted treasure chest…",
  "Solving the puzzle on the stone door…",
  "Rerolling the dungeon seed…",
  "Measuring the echo of the abyss…",
  "Finding bearings in the misty marsh…",
  "Parting the vines to find the ruin's entrance…",
  "Reading the constellation carved on the ceiling…",
  // —— Magic / scrolls / casting ——
  "Transcribing a forbidden incantation…",
  "Charging the staff with arcane power…",
  "Mixing starlight ink…",
  "Calibrating the portal coordinates…",
  "Sealing a restless elemental spirit…",
  "Awakening the slumbering guardian golem…",
  "Weaving a shield ward…",
  "Igniting the rune crystals…",
  "Steadying a runaway spell circle…",
  "Whispering a question into the crystal ball…",
  // —— Monsters / combat ——
  "Studying the dragon's weak spot…",
  "Setting traps for the undead…",
  "Drilling sword-and-shield combos…",
  "Timing the perfect critical hit…",
  "Sneaking past the sleeping giant…",
  "Luring the enemy into a narrow canyon…",
  "Scouting the goblin patrol route…",
  "Calculating the odds of this encounter…",
  "Coating the bolts with paralyzing venom…",
  "Watching for the boss to drop its guard…",
  // —— Treasure / loot ——
  "Counting a bulging bag of loot…",
  "Appraising a ring of unknown origin…",
  "Weighing the gold in the dragon's hoard…",
  "Wiping the dust off a gemstone…",
  "Splitting the party's reward fairly…",
  "Telling forgeries from true treasure…",
  "Holding a dragon's tear up to the light…",
  // —— NPCs / dialogue ——
  "Listening to the old king's last wish…",
  "Calming the frightened villagers…",
  "Persuading the stubborn guard to stand aside…",
  "Haggling with the caravan leader…",
  "Consulting the sage about an ancient prophecy…",
  "Lulling a crying baby dragon to sleep…",
  // —— Gamedev jokes (the agent's real day job) ——
  "Compiling the level shaders…",
  "Baking the global illumination…",
  "Fixing the character's collider…",
  "Rigging the monster's skeletal animation…",
  "Loading the next level…",
  "Debugging the enemy's navmesh…",
  "Balancing the boss's HP values…",
  "Packing assets into the build…",
  "Hunting down the cause of frame drops…",
  "Merging conflicting save branches…",
  "Generating a procedural dungeon…",
  "Recomputing the navigation mesh…",
  "Hot-reloading the ability scripts…",
  "Aligning the sound effect to the hit frame…",
  "Swapping the skybox for dusk…",
  "Burying a hidden easter egg in the level…",
  "Adding reflections to the water surface…",
  "Trimming too many draw calls in one frame…",
  "Migrating the save file to the new version…",
  // —— Journey / caravan / misc ——
  "Tallying supplies for the expedition…",
  "Raising the merchant ship's sails…",
  "Plotting a course on the star chart…",
  "Pitching the windproof tent…",
  "Flipping a coin at the crossroads…",
  "Rolling the dice of fate…",
  "Shuffling a deck of prophetic tarot…",
  "Collecting fragments of a fallen meteor…",
  "Translating a dwarven epitaph…",
  "Tuning the lute before stepping on stage…",
  "Nudging the wheel of fortune one notch…",
];

// English ready phrases: suffixes meaning "ready / good to go", matched in
// count and usage to the Chinese READY_PHRASES (used as "{model} {phrase}").
export const READY_PHRASES_EN: string[] = [
  "ready to roll",
  "armed and ready",
  "good to go",
  "ready when you are",
  "standing by",
  "primed and ready",
  "all set",
  "geared up and ready",
  "ready for adventure",
  "loaded and locked",
  "at your command",
  "ready to dive in",
  "warmed up and ready",
  "saddled up and ready",
  "ready to set out",
  "fully charged and waiting",
  "battle-ready",
  "map unrolled, ready to go",
  "ready to cast",
  "packed and ready",
  "ready for orders",
  "fire's lit, let's begin",
  "ready to embark",
  "raring to go",
  "compass set, ready to sail",
  "lantern lit, ready to explore",
  "ready and waiting",
  "all systems go",
  "ready to begin",
];

// 按当前语言取“思考中”短语数组（en 取英文，否则中文）。
export function thinkingPhrases(): string[] {
  return useLangStore.getState().lang === "en" ? THINKING_PHRASES_EN : THINKING_PHRASES;
}

// 按当前语言取“就绪”短语数组（en 取英文，否则中文）。
export function readyPhrases(): string[] {
  return useLangStore.getState().lang === "en" ? READY_PHRASES_EN : READY_PHRASES;
}

// 用会话 id 做确定性哈希，挑一条就绪短语：同会话稳定、跨会话不同。
export function pickReadyPhrase(seed?: string): string {
  const phrases = readyPhrases();
  const s = seed && seed.length ? seed : "default";
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return phrases[h % phrases.length];
}

// 随机取一条思考短语；尽量避开 prev（连续相同会显得卡住）。
export function randomThinkingPhrase(prev?: string): string {
  const phrases = thinkingPhrases();
  if (phrases.length <= 1) return phrases[0] || "";
  let p = phrases[Math.floor(Math.random() * phrases.length)];
  if (prev) {
    let guard = 0;
    while (p === prev && guard < 5) {
      p = phrases[Math.floor(Math.random() * phrases.length)];
      guard++;
    }
  }
  return p;
}

// ── 失败 / 异常终止的游戏化风味文案 ──
// 当一轮因报错、超时或被系统终止而结束时，用一句轻松有梗的话告诉用户「模型这次
// 没成功」。要点（按用户要求）：
//   1) 必须让人看懂是「这次出错/没完成」，不能一头雾水；
//   2) 必须带玩笑、轻松成分，但不能让人误以为某句文字本身是一种「错误代码/特殊
//      错误信息」（例如别写「失去了信息」这种会被当成技术名词的说法）；
//   3) {name} 会被替换成当前模型的友好简称（Claude / GLM / DeepSeek…）。
// 每次失败「随机固定」一句：随机挑选后写入对话流的只读提示，本身不再变化。
export const FAILURE_PHRASES: string[] = [
  "{name}没有回响，这一趟空手而归。",
  "{name}迷失在了群山中，没能走回来。",
  "{name}找不到森林的出路，原地打转了。",
  "{name}在传送途中走丢了，没能抵达。",
  "{name}的水晶球碎了一地，什么也没看见。",
  "{name}被一只史莱姆绊倒，任务搁浅了。",
  "{name}法力耗尽，瘫坐在地没能继续。",
  "{name}念错了咒语，把自己变没了。",
  "{name}一脚踩空，掉进了看不见的陷阱。",
  "{name}被巨龙打断思路，没能接上话。",
  "{name}手里的卷轴突然空白了一片。",
  "{name}在迷雾里弄丢了方向，半路折返。",
  "{name}打了个盹，没接住你刚才的话。",
  "{name}的魔杖临时罢工，咒语没放出来。",
  "{name}刚踏进传送门，又被弹了回来。",
  "{name}打翻了墨水瓶，把答案糊成一团。",
  "{name}在地牢深处失联了，没能回信。",
  "{name}被一道结界挡在门外，进不去了。",
  "{name}的思绪被一阵风魔法吹散了。",
  "{name}踩到香蕉皮，滑出了战场。",
  "{name}的羽毛笔写到一半断了。",
  "{name}对着空气施了半天法，什么都没发生。",
  "{name}被自己召唤的怪物追跑了。",
  "{name}在图书馆里看着看着睡着了。",
  "{name}的指南针突然开始乱转，迷路了。",
  "{name}的火把在半路熄灭，停在了原地。",
  "{name}被一句古老谜语难住，卡死在门前。",
  "{name}的背包带断了，东西撒了一地。",
  "{name}抬头看流星看入了神，忘了正事。",
  "{name}的回城卷轴失效，没能把话带回来。",
];

// 报错原因匹配表：按顺序匹配（越具体的越靠前），命中即给出对玩家友好的可能原因。
// 在游戏梗失败语之后追加，帮用户快速判断该怎么办。test 同时匹配状态码与错误正文。
export const ERROR_HINTS: { test: RegExp; hint: string }[] = [
  { test: /image|vision|multimodal|image_url|图片|视觉/i, hint: "该模型可能不支持图片消息，请删除图片后重试，或换用支持视觉的模型。" },
  { test: /insufficient|余额|balance|欠费|arrears|not\s*enough|credit|quota.*(exceed|run out)|额度/i, hint: "余额不足，请检查此供应商的账户余额。" },
  { test: /rate.?limit|\b429\b|too\s*many\s*request|频繁|限流|\btpm\b|\brpm\b/i, hint: "请求太频繁被限流了，稍等片刻再试。" },
  { test: /unauthor|\b401\b|invalid.?api.?key|api[\s_-]?key|鉴权|认证失败/i, hint: "API Key 可能无效或已过期，请到设置里检查供应商密钥。" },
  { test: /\b403\b|access\s*denied|permission|无权|地区|region|country|unsupported_country/i, hint: "访问被拒绝，可能无权使用该模型或所在地区受限。" },
  { test: /not\s*found|\b404\b|no\s*such\s*model|model.*not.*exist|unknown\s*model|模型.*不存在/i, hint: "找不到该模型，请检查模型名是否填写正确。" },
  { test: /context|context[\s_-]?length|maximum.*context|too\s*long|token.*(exceed|limit)|上下文|超出.*长度/i, hint: "上下文太长了，试试 /compact 压缩，或换用更大上下文的模型。" },
  { test: /content|safety|policy|moderation|敏感|内容.*(拦截|策略|审核)|risk\s*control/i, hint: "内容被安全策略拦截了，换个说法或删掉敏感内容再试。" },
  { test: /max_tokens|maximum\s*tokens|length.*limit|输出.*上限|truncat/i, hint: "回答达到输出长度上限被截断了，可让它继续或把任务拆小。" },
  { test: /timeout|timed?\s*out|etimedout|deadline|超时/i, hint: "请求超时了，可能网络慢或供应商无响应，稍后再试。" },
  { test: /\btls\b|\bssl\b|econnreset|econnrefused|enotfound|eai_again|socket|getaddrinfo|网络|连接(失败|超时|中断|被拒)/i, hint: "连接失败，请检查网络连接或供应商地址是否可用。" },
  { test: /\b50[0-9]\b|bad\s*gateway|gateway\s*time|service\s*unavailable|internal\s*server|server\s*error|overload/i, hint: "供应商服务器出错了（5xx），通常稍后重试即可。" },
  { test: /\b400\b|bad\s*request|invalid.*request|参数|unsupported\s*parameter|unexpected/i, hint: "请求被拒（400），可能是该模型不支持当前参数或消息格式。" },
];

// 常见模型/供应商品牌识别：把任意 model/provider 串归一成一个好看的简称。
const BRAND_PATTERNS: [RegExp, string][] = [
  [/claude/i, "Claude"],
  [/gemini/i, "Gemini"],
  [/deepseek/i, "DeepSeek"],
  [/\bglm\b|chatglm|zhipu|智谱/i, "GLM"],
  [/qwen|通义|千问/i, "Qwen"],
  [/grok/i, "Grok"],
  [/llama/i, "Llama"],
  [/mistral|mixtral/i, "Mistral"],
  [/kimi|moonshot/i, "Kimi"],
  [/doubao|豆包/i, "豆包"],
  [/ernie|文心/i, "文心一言"],
  [/hunyuan|混元/i, "混元"],
  [/minimax|abab/i, "MiniMax"],
  [/\byi[-\s]/i, "Yi"],
  [/step-?\d|阶跃/i, "Step"],
  [/gpt|openai|\bo[1-9]\b|davinci/i, "GPT"],
];

// 把 model（优先）/ provider 归一成友好简称，用于失败语里的 {name}。识别不到时
// 退回 provider 名，再退回 model 首段，最后兜底「模型」。
export function prettyModelName(model?: string, provider?: string): string {
  const hay = ((model || "") + " " + (provider || "")).trim();
  for (const [re, name] of BRAND_PATTERNS) if (re.test(hay)) return name;
  if (provider && provider.trim()) return provider.trim();
  if (model && model.trim()) return model.split(/[\/:@\s]/)[0] || model;
  return "模型";
}

// 随机取一条失败语并把 {name} 替换为模型简称。每次失败调用一次即固定下来。
export function randomFailurePhrase(name: string): string {
  const p = FAILURE_PHRASES[Math.floor(Math.random() * FAILURE_PHRASES.length)] || "{name}这一趟没能成功。";
  return p.replace(/\{name\}/g, name || "模型");
}

// 在报错文本里匹配第一条命中的「可能原因」提示；没命中返回空串。
export function matchErrorHint(rawError?: string): string {
  const s = rawError || "";
  if (!s) return "";
  for (const e of ERROR_HINTS) if (e.test.test(s)) return e.hint;
  return "";
}

// 组装一条失败/终止提示：游戏梗失败语（醒目）+ 可选附加说明（如超时）+ 匹配到的
// 可能原因 + 原始报错原文（供排查，rawTail=false 可省略）。
export function buildFailureNotice(
  rawError: string | undefined,
  name: string,
  opts?: { extra?: string; rawTail?: boolean }
): string {
  let out = randomFailurePhrase(name);
  if (opts?.extra) out += opts.extra;
  const hint = matchErrorHint(rawError);
  if (hint) out += " " + hint;
  if (rawError && opts?.rawTail !== false) out += "\n\n" + String(rawError);
  return out;
}
