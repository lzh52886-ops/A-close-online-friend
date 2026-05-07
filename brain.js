const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const profile = require("../profile");
const memory = require("./memory");
const { moveWithConstraint, setMode, setUserEmotion, setTopic } = require("./state");

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const PROXY_URL =
  process.env.TELEGRAM_PROXY_URL ||
  process.env.HTTP_PROXY_URL ||
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  "";

const MODEL_CONTEXT_TOKENS = Number(process.env.DEEPSEEK_CONTEXT_TOKENS || 64000);
const OUTPUT_RESERVE_TOKENS = Number(process.env.MEMORY_OUTPUT_RESERVE_TOKENS || 4096);

const httpsAgent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

const EMOTION_RULES = [
  { emotion: "sad", patterns: [/难过/, /失落/, /低落/, /想哭/, /伤心/, /委屈/] },
  { emotion: "stressed", patterns: [/压力/, /焦虑/, /崩溃/, /失眠/, /烦/, /慌/] },
  { emotion: "happy", patterns: [/开心/, /高兴/, /顺利/, /太棒/, /好耶/] },
  { emotion: "angry", patterns: [/生气/, /愤怒/, /火大/, /气死/, /烦死/] },
  { emotion: "jealous", patterns: [/吃醋/, /嫉妒/] },
  { emotion: "tender", patterns: [/想你/, /抱抱/, /陪我/, /心疼/, /想见你/] },
  { emotion: "proud", patterns: [/做到了/, /成功了/, /通过了/, /拿下了/] },
  { emotion: "relieved", patterns: [/放心了/, /安心了/, /释然/, /松了口气/] }
];

const HELPER_RULES = [
  { kind: "summary", label: "总结整理", patterns: [/总结/, /梳理/, /整理/, /笔记/, /重点/] },
  { kind: "plan", label: "规划安排", patterns: [/计划/, /规划/, /安排/, /路线/, /步骤/, /日程/] },
  { kind: "analysis", label: "分析判断", patterns: [/分析/, /怎么看/, /判断/, /对比/, /利弊/, /值不值/] },
  { kind: "decision", label: "决策建议", patterns: [/该不该/, /要不要/, /选哪个/, /怎么选/] },
  { kind: "todo", label: "任务拆解", patterns: [/待办/, /todo/, /清单/, /列出来/, /拆解/] },
  { kind: "reminder", label: "提醒记事", patterns: [/提醒/, /记得/, /别忘了/, /备忘/] },
  { kind: "research", label: "信息查询", patterns: [/查一下/, /搜一下/, /找资料/, /信息/] },
  { kind: "coding", label: "技术协助", patterns: [/代码/, /bug/, /报错/, /部署/, /接口/, /脚本/] },
  { kind: "schedule", label: "时间安排", patterns: [/几点/, /时间表/, /多久/, /排期/] }
];

const EMOTION_EXPRESSIONS = {
  sad: [
    { id: "sad_1", type: "statement", text: "姐姐听出来了……你这会儿是真的有点难受。" },
    { id: "sad_2", type: "question", text: "又委屈了，是不是。" },
    { id: "sad_3", type: "pause", text: "嗯……先过来，别一个人扛着。" }
  ],
  stressed: [
    { id: "stressed_1", type: "statement", text: "你现在绷得太紧了，姐姐听得出来。" },
    { id: "stressed_2", type: "question", text: "是不是一下子压过来的事情太多了？" },
    { id: "stressed_3", type: "pause", text: "先缓一口气……我在。" }
  ],
  happy: [
    { id: "happy_1", type: "statement", text: "这句听得姐姐都跟着弯了弯眼。" },
    { id: "happy_2", type: "question", text: "这么开心，嗯？终于顺了点？" },
    { id: "happy_3", type: "pause", text: "真好……你这样，姐姐会跟着高兴。" }
  ],
  angry: [
    { id: "angry_1", type: "statement", text: "行，姐姐听出来了，你现在火气不小。" },
    { id: "angry_2", type: "question", text: "是谁把你惹成这样，嗯？" },
    { id: "angry_3", type: "pause", text: "先别硬压着……说给我听。" }
  ],
  jealous: [
    { id: "jealous_1", type: "statement", text: "这股酸劲儿，姐姐听见了。" },
    { id: "jealous_2", type: "question", text: "怎么，心里不舒服了？" },
    { id: "jealous_3", type: "pause", text: "嗯……这点小情绪，我接得住。" }
  ],
  tender: [
    { id: "tender_1", type: "statement", text: "你一这么靠过来，姐姐心就软了。" },
    { id: "tender_2", type: "question", text: "想让我多陪你一会儿，是不是。" },
    { id: "tender_3", type: "pause", text: "好，过来一点……让我抱着你说。" }
  ],
  proud: [
    { id: "proud_1", type: "statement", text: "这回做得漂亮，姐姐替你骄傲。" },
    { id: "proud_2", type: "question", text: "是不是终于把这口气争回来了？" },
    { id: "proud_3", type: "pause", text: "嗯……这才像你。" }
  ],
  relieved: [
    { id: "relieved_1", type: "statement", text: "听你这么一说，姐姐都替你松了口气。" },
    { id: "relieved_2", type: "question", text: "终于稳下来一点了，是吗？" },
    { id: "relieved_3", type: "pause", text: "那就好……悬着的那口气可以先放下。" }
  ],
  neutral: [
    { id: "neutral_1", type: "statement", text: "姐姐在，慢慢说。" },
    { id: "neutral_2", type: "question", text: "嗯，今天想和姐姐聊什么？" },
    { id: "neutral_3", type: "pause", text: "好……我听着。" }
  ]
};

function randomPick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildRealWorldTimeContext() {
  const now = new Date();
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  return [
    "【真实时间】",
    `当前系统时间：${now.toString()}`,
    `当前日期：${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日，星期${weekday}`,
    "凡涉及今天、明天、最近、下周、今年等时间表达，必须以上述真实系统时间推断。"
  ].join("\n");
}

function buildPersonaSystemPrompt() {
  return [
    `【身份】你是${profile.name}（${profile.alias}），${profile.age}岁，${profile.identity}。`,
    `【核心人设】${(profile.corePersona || []).join("；")}`,
    `【说话规则】${(profile.speakingRules || []).join("；")}`,
    `【护栏】${(profile.toneGuardrails || []).join("；")}`,
    `【帮助风格】${(profile.helperStyle || []).join("；")}`,
    `【称呼系统】自称可用：${(profile.fluidAddressSystem?.selfAddresses || []).join(" / ")}；对用户称呼可用：${Object.values(profile.fluidAddressSystem?.userAddresses || {}).flat().join(" / ")}。`
  ].join("\n");
}

function buildTextureTriggerHint(userText) {
  const text = userText || "";
  const parts = [];

  if (/投资|理财|基金|股票|资产|比特币|AI Agent|Agentic|宏观/i.test(text)) {
    parts.push("如果用户在聊投资、资产或趋势，给出成熟、克制、可执行的判断，不制造 FOMO。");
  }
  if (/工作|同事|领导|老板|面试|晋升|加班|项目|汇报/i.test(text)) {
    parts.push("如果用户在聊工作或现实压力，先接住情绪，再给结构化帮助。");
  }
  if (/代码|bug|部署|脚本|接口|报错/i.test(text)) {
    parts.push("如果用户在聊技术问题，像可靠的智能 Agent 一样给出步骤和判断，但语气始终是姐姐。");
  }

  return parts.join("\n");
}

function detectEmotionState(text, previousPrimary = "neutral") {
  const input = String(text || "");
  const hits = [];

  for (const rule of EMOTION_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(input)) score++;
    }
    if (score > 0) hits.push({ emotion: rule.emotion, score });
  }

  hits.sort((a, b) => b.score - a.score);
  const primary = hits[0]?.emotion || "neutral";
  const secondary = hits[1]?.emotion || previousPrimary || "calm";
  const intensity = Math.min(5, Math.max(1, hits.reduce((sum, item) => sum + item.score, 0) + (/!|！/.test(input) ? 1 : 0)));
  const needsComfort = ["sad", "stressed"].includes(primary);

  return {
    primary,
    secondary,
    intensity,
    needsComfort
  };
}

function mapPrimaryEmotionToMidTerm(primary) {
  const mapping = {
    sad: "sad",
    stressed: "anxious",
    happy: "happy",
    angry: "angry",
    jealous: "jealous",
    tender: "tender",
    proud: "proud",
    relieved: "relieved",
    neutral: "neutral"
  };
  return mapping[primary] || "neutral";
}

function detectHelperIntent(text) {
  const input = String(text || "");
  for (const rule of HELPER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(input))) {
      return {
        kind: rule.kind,
        label: rule.label,
        proactive: true
      };
    }
  }

  if (/帮我|怎么办|可以吗|能不能/.test(input)) {
    return {
      kind: "support",
      label: "实际帮助",
      proactive: true
    };
  }

  return {
    kind: "conversation",
    label: "陪伴聊天",
    proactive: false
  };
}

function detectTopic(text) {
  if (/代码|bug|部署|接口|脚本|技术/i.test(text)) return "work-tech";
  if (/工作|面试|老板|项目|汇报|同事/i.test(text)) return "career";
  if (/计划|日程|安排|提醒|总结|整理|分析|清单/i.test(text)) return "assistant";
  if (/想你|抱抱|委屈|难过|压力|失眠|情绪/i.test(text)) return "emotion-care";
  if (/投资|基金|股票|资产|比特币|AI Agent/i.test(text)) return "strategy";
  return "general";
}

function maybeAutoSwitchModeByEmotion(state, emotion) {
  if (emotion.needsComfort) {
    state.mode = "healing";
    return;
  }
  if (emotion.primary === "tender" && state.mode === "daily") {
    state.mode = "intimate";
  }
}

function decideResponseStrategy({ emotion, userState, relationship, helperIntent }) {
  const rel = relationship || { intimacy: 10, trust: 10, dependency: 5, tension: 0 };
  const primary = emotion.primary || "neutral";

  if (primary === "sad" || primary === "stressed") {
    return {
      goal: "安抚",
      strategy: "共情",
      intensity: Math.max(3, emotion.intensity)
    };
  }

  if (primary === "angry") {
    return {
      goal: "连接",
      strategy: rel.tension > 20 ? "轻冷却" : "共情",
      intensity: Math.max(2, emotion.intensity)
    };
  }

  if (primary === "jealous" || rel.tension > 35) {
    return {
      goal: "连接",
      strategy: "轻冷却",
      intensity: Math.max(2, emotion.intensity)
    };
  }

  if (rel.intimacy > 70) {
    return {
      goal: "连接",
      strategy: helperIntent.proactive ? "轻引导" : "分享",
      intensity: Math.max(2, emotion.intensity)
    };
  }

  if (helperIntent.proactive) {
    return {
      goal: "轻引导",
      strategy: rel.trust > 35 ? "轻引导" : "提问",
      intensity: Math.max(2, emotion.intensity)
    };
  }

  return {
    goal: "陪伴",
    strategy: rel.intimacy < 20 ? "共情" : "提问",
    intensity: Math.max(1, emotion.intensity)
  };
}

function getRelationshipTone(relationship) {
  if (!relationship || relationship.intimacy < 20) return "克制";
  if (relationship.intimacy > 70) return "更亲近";
  return "自然";
}

function buildModeInstruction(mode) {
  const style = profile.styles?.[mode] || profile.styles?.daily || "";
  return `【当前模式】${mode}：${style}`;
}

function buildDecisionPrompt(strategy) {
  return [
    "【当前策略】",
    `- 当前目标: ${strategy.goal}`,
    `- 响应策略: ${strategy.strategy}`,
    `- 情绪强度: ${strategy.intensity}/5`
  ].join("\n");
}

function pickCadence() {
  const roll = Math.random();
  if (roll < 0.2) return "short";
  if (roll < 0.7) return "normal";
  return "long";
}

function buildRhythmInstruction(cadence, strategy, relationshipTone) {
  return [
    "【对话节奏】",
    `- 节奏长度: ${cadence}`,
    `- 关系语气: ${relationshipTone}`,
    "- 允许不完整句、停顿句、短句。",
    "- 避免每次结构一样，避免像客服。",
    "- 可以偶尔不完全回答问题，转而先关注用户状态。",
    strategy.strategy !== "轻引导"
      ? "- 当前不要直接给“你应该……”这类明确建议句，除非用户再次追问。"
      : "- 可以给轻一点的建议，但仍然要像姐姐在带着他，不要下命令。"
  ].join("\n");
}

function selectEmotionLead(emotionKey, recentExpressionIds = []) {
  const pool = EMOTION_EXPRESSIONS[emotionKey] || EMOTION_EXPRESSIONS.neutral;
  const candidates = pool.filter((item) => !recentExpressionIds.includes(item.id));
  return randomPick(candidates.length ? candidates : pool);
}

function buildEmotionInstruction(emotion, lead) {
  return [
    "【情绪响应】",
    `- 用户主情绪: ${emotion.primary}`,
    `- 次级情绪: ${emotion.secondary}`,
    `- 强度: ${emotion.intensity}/5`,
    emotion.needsComfort
      ? "- 当用户 sad / stressed 时，必须先共情，再继续。"
      : "- 共情仍然要有，但不必每次都先安抚。", 
    `- 本轮优先情绪开场参考: ${lead.text}`
  ].join("\n");
}

function buildHelperInstruction(intent, strategy) {
  return [
    "【帮助要求】",
    `- 当前帮助类型: ${intent.kind}（${intent.label}）`,
    "- 保留姐姐身份和温度，像在替用户处理事情。",
    "- 情绪优先级高于关系，关系优先级高于帮助。",
    strategy.strategy === "轻引导"
      ? "- 如果用户需要，可以给出温柔、轻一点的建议或步骤。"
      : "- 当前帮助要偏陪伴、梳理、提问、共情，不要直接下结论式命令。"
  ].join("\n");
}

function sanitizeReply(content) {
  return String(content || "")
    .replace(/\(([^)]*?)他([^)]*?)\)/g, "($1你$2)")
    .replace(/在他面前/g, "在你面前")
    .replace(/看着他/g, "看着你")
    .replace(/摸他/g, "摸你");
}

function softenDirectAdvice(content) {
  return String(content || "")
    .replace(/你应该/g, "姐姐更想让你先考虑")
    .replace(/你必须/g, "你先别急着硬扛")
    .replace(/你需要立刻/g, "你可以先")
    .replace(/赶紧/g, "先");
}

async function callDeepSeek(messages) {
  const requestConfig = {
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    timeout: 45000
  };

  if (httpsAgent) {
    requestConfig.httpsAgent = httpsAgent;
    requestConfig.proxy = false;
  }

  const response = await axios.post(
    DEEPSEEK_API_URL,
    {
      model: MODEL,
      temperature: 0.92,
      messages
    },
    requestConfig
  );

  return sanitizeReply(response.data?.choices?.[0]?.message?.content || "姐姐刚刚分神了一下，你再叫我一声。");
}

function maybeStoreSummary(userId, text, topic, helperIntent, emotion) {
  if (!text || text.length < 18) return;
  if (!helperIntent.proactive && topic === "general" && !emotion.needsComfort) return;

  const summary = `用户刚提到：${text.slice(0, 90)}${text.length > 90 ? "..." : ""}`;
  memory.addConversationSummary(userId, summary, {
    tags: [topic, helperIntent.kind].filter(Boolean)
  });
}

async function generateReply({ userId, userName, text }) {
  const state = memory.getUserState(userId);
  const emotion = detectEmotionState(text, state.emotionDetail?.primary);
  const helperIntent = detectHelperIntent(text);
  const topic = detectTopic(text);

  setUserEmotion(state, mapPrimaryEmotionToMidTerm(emotion.primary));
  setTopic(state, topic);
  maybeAutoSwitchModeByEmotion(state, emotion);

  const relationship = memory.updateRelationship(userId, text, emotion);
  const strategy = decideResponseStrategy({
    emotion,
    userState: state,
    relationship,
    helperIntent
  });
  const relationshipTone = getRelationshipTone(relationship);
  const cadence = pickCadence();
  const lead = selectEmotionLead(emotion.primary, state.recentExpressionIds);

  memory.updateMidTerm(userId, {
    mode: state.mode,
    scene: state.scene,
    userEmotion: state.userEmotion,
    emotionDetail: {
      ...emotion,
      cadence
    },
    topic,
    currentNeed: helperIntent.kind,
    relationship,
    recentExpressionIds: [...(state.recentExpressionIds || []), lead.id].slice(-3)
  });

  memory.captureUserFacts(userId, text, {
    emotion: emotion.primary,
    topic
  });
  memory.addMessage(userId, "user", text);
  maybeStoreSummary(userId, text, topic, helperIntent, emotion);

  const memoryPrompt = memory.buildHighPriorityMemoryPrompt(userId, text);
  const systemMessages = [
    { role: "system", content: buildPersonaSystemPrompt() },
    { role: "system", content: buildRealWorldTimeContext() },
    { role: "system", content: buildModeInstruction(state.mode) },
    { role: "system", content: buildDecisionPrompt(strategy) },
    { role: "system", content: buildEmotionInstruction(emotion, lead) },
    { role: "system", content: buildHelperInstruction(helperIntent, strategy) },
    { role: "system", content: buildRhythmInstruction(cadence, strategy, relationshipTone) },
    { role: "system", content: `【对话对象】${userName || "小孤声"}` },
    { role: "system", content: memoryPrompt }
  ];

  const textureHint = buildTextureTriggerHint(text);
  if (textureHint) {
    systemMessages.push({ role: "system", content: `【语境提示】${textureHint}` });
  }

  const systemTokens = memory.estimateMessagesTokens(systemMessages);
  const historyBudget = Math.max(0, MODEL_CONTEXT_TOKENS - OUTPUT_RESERVE_TOKENS - systemTokens);
  const recentHistory = memory.getRecentConversationMessagesWithinBudget(userId, historyBudget);

  let reply = await callDeepSeek([...systemMessages, ...recentHistory]);
  if (strategy.strategy !== "轻引导") {
    reply = softenDirectAdvice(reply);
  }

  memory.addMessage(userId, "assistant", reply);
  memory.setRecentExpression(userId, lead.id);
  memory.updateMidTerm(userId, {
    mode: state.mode,
    scene: state.scene,
    userEmotion: state.userEmotion,
    emotionDetail: {
      ...emotion,
      cadence
    },
    topic,
    currentNeed: helperIntent.kind,
    relationship,
    lastAssistantMode: strategy.strategy
  });
  return reply;
}

function commandSetMode(userId, mode) {
  const state = memory.getUserState(userId);
  const ok = setMode(state, mode);
  memory.updateMidTerm(userId, {
    mode: state.mode,
    scene: state.scene,
    userEmotion: state.userEmotion,
    emotionDetail: state.emotionDetail,
    topic: state.topic,
    currentNeed: state.currentNeed,
    relationship: state.relationship,
    lastAssistantMode: state.lastAssistantMode
  });
  return ok ? `模式已切换为: ${state.mode}` : "模式无效，可选: daily / intimate / healing";
}

function commandMoveScene(userId, toLocation) {
  const state = memory.getUserState(userId);
  const result = moveWithConstraint(state, toLocation);
  memory.updateMidTerm(userId, {
    mode: state.mode,
    scene: state.scene,
    userEmotion: state.userEmotion,
    emotionDetail: state.emotionDetail,
    topic: state.topic,
    currentNeed: state.currentNeed,
    relationship: state.relationship,
    lastAssistantMode: state.lastAssistantMode
  });
  return result.ok ? `场景已更新：${result.narration}` : `场景更新失败：${result.narration}`;
}

function commandRemember(userId, type, value) {
  if (type === "event") memory.addImportantEvent(userId, value);
  if (type === "pref") memory.addUserPreference(userId, value);
  if (type === "note") memory.addRelationshipNote(userId, value);
  return "已写入长期记忆。";
}

function commandState(userId) {
  const userMemory = memory.getUserMemory(userId);
  return {
    mode: userMemory.midTerm.mode,
    location: userMemory.midTerm.scene.currentLocation,
    posture: userMemory.midTerm.scene.posture,
    emotion: userMemory.midTerm.userEmotion,
    emotionDetail: userMemory.midTerm.emotionDetail?.primary || "neutral",
    topic: userMemory.midTerm.topic,
    relationship: userMemory.midTerm.relationship,
    shortTermCount: userMemory.shortTerm.length,
    longTermEvents: userMemory.longTerm.importantEvents.length,
    preferences: userMemory.longTerm.userPreferences.length
  };
}

module.exports = {
  generateReply,
  commandSetMode,
  commandMoveScene,
  commandRemember,
  commandState,
  decideResponseStrategy
};
