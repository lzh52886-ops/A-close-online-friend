const fs = require("fs");
const path = require("path");
const { createDefaultState } = require("./state");
const profile = require("../profile");

const DATA_DIR = path.join(__dirname, "..", "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const SHORT_TERM_KEEP_MAX = Number(process.env.MEMORY_SHORT_TERM_KEEP_MAX || 400);
const LONG_TERM_KEEP_MAX = Number(process.env.MEMORY_LONG_TERM_KEEP_MAX || 200);
const SUMMARY_KEEP_MAX = Number(process.env.MEMORY_SUMMARY_KEEP_MAX || 24);
const MSG_OVERHEAD_TOKENS = Number(process.env.MEMORY_MSG_OVERHEAD_TOKENS || 4);

const EMPTY_MEMORY_DB = () => ({ users: {} });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let rest = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else rest++;
  }
  return Math.ceil(cjk / 1.3 + rest / 4);
}

function estimateMessageTokens(role, content) {
  return estimateTokens(String(content || "")) + MSG_OVERHEAD_TOKENS + estimateTokens(String(role || ""));
}

function truncateContentToTokenBudget(text, maxContentTokens) {
  if (maxContentTokens <= 0) return "";
  if (estimateTokens(text) <= maxContentTokens) return text;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const slice = text.slice(0, mid);
    if (estimateTokens(slice) <= maxContentTokens) lo = mid;
    else hi = mid - 1;
  }

  return `${text.slice(0, lo)}\n[truncated]`;
}

function estimateMessagesTokens(messages) {
  let sum = 0;
  for (const message of messages) {
    sum += estimateMessageTokens(message.role, message.content);
  }
  return sum;
}

function normalizeMemoryRoot(parsed) {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return EMPTY_MEMORY_DB();
  }
  const out = { ...parsed };
  if (!out.users || typeof out.users !== "object" || Array.isArray(out.users)) {
    out.users = {};
  }
  return out;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractKeywords(text) {
  const raw = String(text || "").toLowerCase();
  const keywords = [];

  const latin = raw.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  keywords.push(...latin);

  const cjkSegments = raw.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const segment of cjkSegments) {
    keywords.push(segment);
    for (let i = 0; i < segment.length - 1; i++) {
      keywords.push(segment.slice(i, i + 2));
    }
  }

  return unique(keywords).slice(0, 32);
}

function normalizeMemoryItem(item, fallbackType = "note") {
  if (item == null) return null;
  if (typeof item === "string") {
    return {
      id: `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: fallbackType,
      text: item,
      keywords: extractKeywords(item),
      tags: [],
      salience: 1,
      source: "legacy",
      ts: Date.now(),
      lastUsedAt: 0
    };
  }

  if (typeof item !== "object") return null;
  const text = item.text != null ? String(item.text) : "";
  return {
    id: item.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: item.type || fallbackType,
    text,
    keywords: Array.isArray(item.keywords) && item.keywords.length ? unique(item.keywords) : extractKeywords(text),
    tags: Array.isArray(item.tags) ? unique(item.tags.map((v) => String(v))) : [],
    salience: Number(item.salience) || 1,
    source: item.source || "manual",
    ts: typeof item.ts === "number" ? item.ts : Date.now(),
    lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : 0
  };
}

function createMemoryItem(type, text, meta = {}) {
  return normalizeMemoryItem(
    {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      text,
      keywords: extractKeywords(text),
      tags: meta.tags || [],
      salience: meta.salience || 1,
      source: meta.source || "manual",
      ts: Date.now(),
      lastUsedAt: 0
    },
    type
  );
}

class MemoryStore {
  constructor() {
    this.db = EMPTY_MEMORY_DB();
    this._ensure();
    this.reloadFromDisk();
  }

  _defaultRelationship() {
    return {
      intimacy: 10,
      trust: 10,
      dependency: 5,
      tension: 0
    };
  }

  _defaultMidTerm() {
    const state = createDefaultState();
    return {
      scene: state.scene,
      userEmotion: state.userEmotion,
      emotionDetail: {
        primary: "neutral",
        secondary: "calm",
        intensity: 1,
        needsComfort: false,
        cadence: "normal"
      },
      topic: state.topic,
      mode: state.mode,
      currentNeed: "conversation",
      lastAssistantMode: "companion",
      relationship: this._defaultRelationship(),
      recentExpressionIds: [],
      lastInteractionAt: 0,
      lastProactiveAt: 0
    };
  }

  _defaultLongTerm() {
    return {
      persona: {
        name: profile.name,
        alias: profile.alias,
        identity: profile.identity
      },
      importantEvents: [],
      userPreferences: [],
      relationshipNotes: [],
      conversationSummaries: []
    };
  }

  _writeMemoryFile(dbObj) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(dbObj, null, 2), "utf-8");
  }

  _ensureMemoryFileOnDisk() {
    if (!fs.existsSync(MEMORY_FILE)) {
      this._writeMemoryFile(EMPTY_MEMORY_DB());
      return;
    }

    try {
      const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
      if (!String(raw || "").trim()) {
        this._writeMemoryFile(EMPTY_MEMORY_DB());
        return;
      }
      normalizeMemoryRoot(JSON.parse(raw));
    } catch {
      this._writeMemoryFile(EMPTY_MEMORY_DB());
    }
  }

  _ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this._ensureMemoryFileOnDisk();
  }

  _normalizeLongTermShape(user) {
    if (!user.longTerm || typeof user.longTerm !== "object") {
      user.longTerm = this._defaultLongTerm();
      return;
    }

    const longTerm = user.longTerm;
    longTerm.persona = {
      name: profile.name,
      alias: profile.alias,
      identity: profile.identity,
      ...(longTerm.persona && typeof longTerm.persona === "object" ? longTerm.persona : {})
    };
    longTerm.importantEvents = (Array.isArray(longTerm.importantEvents) ? longTerm.importantEvents : [])
      .map((item) => normalizeMemoryItem(item, "event"))
      .filter(Boolean)
      .slice(-LONG_TERM_KEEP_MAX);
    longTerm.userPreferences = (Array.isArray(longTerm.userPreferences) ? longTerm.userPreferences : [])
      .map((item) => normalizeMemoryItem(item, "preference"))
      .filter(Boolean)
      .slice(-LONG_TERM_KEEP_MAX);
    longTerm.relationshipNotes = (Array.isArray(longTerm.relationshipNotes) ? longTerm.relationshipNotes : [])
      .map((item) => normalizeMemoryItem(item, "relationship"))
      .filter(Boolean)
      .slice(-LONG_TERM_KEEP_MAX);
    longTerm.conversationSummaries = (Array.isArray(longTerm.conversationSummaries) ? longTerm.conversationSummaries : [])
      .map((item) => normalizeMemoryItem(item, "summary"))
      .filter(Boolean)
      .slice(-SUMMARY_KEEP_MAX);
  }

  _normalizeUserShell(user) {
    if (!user || typeof user !== "object") return;

    if (!Array.isArray(user.shortTerm)) user.shortTerm = [];
    user.shortTerm = user.shortTerm
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        role: item.role || "user",
        content: String(item.content || ""),
        ts: typeof item.ts === "number" ? item.ts : Date.now()
      }));

    const fallbackMidTerm = this._defaultMidTerm();
    if (!user.midTerm || typeof user.midTerm !== "object") {
      user.midTerm = fallbackMidTerm;
    } else {
      const scene =
        user.midTerm.scene && typeof user.midTerm.scene === "object"
          ? user.midTerm.scene
          : fallbackMidTerm.scene;
      user.midTerm = {
        ...fallbackMidTerm,
        ...user.midTerm,
        scene: {
          currentLocation: scene.currentLocation || fallbackMidTerm.scene.currentLocation,
          posture: scene.posture || fallbackMidTerm.scene.posture,
          physicalContinuityLog: Array.isArray(scene.physicalContinuityLog)
            ? scene.physicalContinuityLog.slice(-40)
            : []
        },
        emotionDetail:
          user.midTerm.emotionDetail && typeof user.midTerm.emotionDetail === "object"
            ? { ...fallbackMidTerm.emotionDetail, ...user.midTerm.emotionDetail }
            : fallbackMidTerm.emotionDetail,
        relationship:
          user.midTerm.relationship && typeof user.midTerm.relationship === "object"
            ? {
                ...this._defaultRelationship(),
                ...user.midTerm.relationship
              }
            : this._defaultRelationship(),
        recentExpressionIds: Array.isArray(user.midTerm.recentExpressionIds)
          ? user.midTerm.recentExpressionIds.slice(-3)
          : []
      };
    }

    this._normalizeLongTermShape(user);
    if (typeof user.updatedAt !== "number") user.updatedAt = Date.now();
  }

  reloadFromDisk() {
    this.db = EMPTY_MEMORY_DB();
    try {
      const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
      this.db = normalizeMemoryRoot(JSON.parse(raw));
    } catch {
      this.db = EMPTY_MEMORY_DB();
      try {
        this._writeMemoryFile(this.db);
      } catch {
        // Ignore disk failures and keep in-memory defaults.
      }
    }

    for (const user of Object.values(this.db.users)) {
      this._normalizeUserShell(user);
    }
  }

  _save() {
    try {
      this._writeMemoryFile(this.db);
    } catch {
      // Ignore storage failures to keep chat flow running.
    }
  }

  _uid(userId) {
    return String(userId);
  }

  ensureUser(userId) {
    const uid = this._uid(userId);
    if (!this.db.users[uid]) {
      this.db.users[uid] = {
        shortTerm: [],
        midTerm: this._defaultMidTerm(),
        longTerm: this._defaultLongTerm(),
        updatedAt: Date.now()
      };
      this._save();
    } else {
      this._normalizeUserShell(this.db.users[uid]);
    }
    return this.db.users[uid];
  }

  updateMidTerm(userId, patch = {}) {
    const user = this.ensureUser(userId);
    const fallback = this._defaultMidTerm();
    const nextScene =
      patch.scene && typeof patch.scene === "object"
        ? {
            ...user.midTerm.scene,
            ...patch.scene,
            physicalContinuityLog: Array.isArray(patch.scene.physicalContinuityLog)
              ? patch.scene.physicalContinuityLog.slice(-40)
              : user.midTerm.scene.physicalContinuityLog
          }
        : user.midTerm.scene;

    const nextRelationship =
      patch.relationship && typeof patch.relationship === "object"
        ? {
            ...fallback.relationship,
            ...user.midTerm.relationship,
            ...patch.relationship
          }
        : user.midTerm.relationship;

    user.midTerm = {
      ...fallback,
      ...user.midTerm,
      ...patch,
      scene: nextScene,
      relationship: nextRelationship,
      emotionDetail:
        patch.emotionDetail && typeof patch.emotionDetail === "object"
          ? { ...fallback.emotionDetail, ...user.midTerm.emotionDetail, ...patch.emotionDetail }
          : user.midTerm.emotionDetail,
      recentExpressionIds: Array.isArray(patch.recentExpressionIds)
        ? patch.recentExpressionIds.slice(-3)
        : user.midTerm.recentExpressionIds
    };
    user.updatedAt = Date.now();
    this._save();
  }

  addMessage(userId, role, content) {
    const user = this.ensureUser(userId);
    user.shortTerm.push({
      role: role || "user",
      content: String(content || ""),
      ts: Date.now()
    });
    if (user.shortTerm.length > SHORT_TERM_KEEP_MAX) {
      user.shortTerm = user.shortTerm.slice(-SHORT_TERM_KEEP_MAX);
    }
    user.midTerm.lastInteractionAt = Date.now();
    user.updatedAt = Date.now();
    this._save();
  }

  _addLongTermEntry(userId, bucket, type, text, meta = {}) {
    if (!text) return null;
    const user = this.ensureUser(userId);
    const list = user.longTerm[bucket];
    const normalizedText = String(text).trim();
    if (!normalizedText) return null;

    const exists = list.find((item) => item.text === normalizedText);
    if (exists) {
      exists.lastUsedAt = Date.now();
      exists.salience = Math.max(exists.salience || 1, meta.salience || 1);
      exists.keywords = unique([...(exists.keywords || []), ...extractKeywords(normalizedText)]);
      user.updatedAt = Date.now();
      this._save();
      return exists;
    }

    const entry = createMemoryItem(type, normalizedText, meta);
    list.push(entry);
    user.longTerm[bucket] = list.slice(-LONG_TERM_KEEP_MAX);
    user.updatedAt = Date.now();
    this._save();
    return entry;
  }

  addImportantEvent(userId, eventText, meta = {}) {
    return this._addLongTermEntry(userId, "importantEvents", "event", eventText, {
      source: "manual",
      salience: 3,
      ...meta
    });
  }

  addUserPreference(userId, preferenceText, meta = {}) {
    return this._addLongTermEntry(userId, "userPreferences", "preference", preferenceText, {
      source: "manual",
      salience: 2,
      ...meta
    });
  }

  addRelationshipNote(userId, noteText, meta = {}) {
    return this._addLongTermEntry(userId, "relationshipNotes", "relationship", noteText, {
      source: "manual",
      salience: 3,
      ...meta
    });
  }

  addConversationSummary(userId, summaryText, meta = {}) {
    if (!summaryText) return null;
    const user = this.ensureUser(userId);
    const entry = createMemoryItem("summary", summaryText, {
      source: "summary",
      salience: 2,
      ...meta
    });
    user.longTerm.conversationSummaries.push(entry);
    user.longTerm.conversationSummaries = user.longTerm.conversationSummaries.slice(-SUMMARY_KEEP_MAX);
    user.updatedAt = Date.now();
    this._save();
    return entry;
  }

  captureUserFacts(userId, text, context = {}) {
    const value = String(text || "").trim();
    if (!value) return;

    const preferenceTriggers = [
      /(我喜欢|我偏爱|我爱吃|我想要|我更喜欢|我讨厌|我不喜欢)(.+)/,
      /(喜欢|偏好|口味|习惯|讨厌)(.+)/
    ];
    const eventTriggers = [
      /(今天|刚刚|刚才|昨晚|明天|下周|这周|最近|马上|正在|已经|终于)(.+)/,
      /(考试|面试|答辩|加班|出差|开会|项目|任务|计划|生日|纪念日)(.+)/
    ];
    const relationshipTriggers = [
      /(你要记得|记住|别忘了|希望你|以后你|我们)(.+)/
    ];

    if (preferenceTriggers.some((rule) => rule.test(value))) {
      this.addUserPreference(userId, value, { source: "auto", salience: 2 });
    }
    if (eventTriggers.some((rule) => rule.test(value))) {
      this.addImportantEvent(userId, value, {
        source: "auto",
        salience: context.emotion === "sad" || context.emotion === "stressed" ? 3 : 2,
        tags: [context.topic].filter(Boolean)
      });
    }
    if (relationshipTriggers.some((rule) => rule.test(value))) {
      this.addRelationshipNote(userId, value, {
        source: "auto",
        salience: 3,
        tags: ["relationship"]
      });
    }
  }

  updateRelationship(userId, userInput, emotion) {
    const user = this.ensureUser(userId);
    const relationship = {
      ...this._defaultRelationship(),
      ...(user.midTerm.relationship || {})
    };
    const input = String(userInput || "");
    const primary = typeof emotion === "string" ? emotion : emotion?.primary || "neutral";

    if (primary !== "neutral") relationship.intimacy += 2;
    if (input.trim()) relationship.dependency += 1;
    if (/压力|焦虑|崩溃|工作|老板|项目|现实|答辩|加班|失眠/.test(input)) relationship.trust += 2;
    if (/哦|嗯|随便|都行|没事|算了|呵呵/.test(input) && input.length <= 6) relationship.intimacy -= 1;
    if (/别烦|别管|走开|不想聊/.test(input)) relationship.tension += 3;
    if (/想你|抱抱|陪我|别走|想和你说/.test(input)) relationship.intimacy += 2;

    relationship.intimacy = clamp(relationship.intimacy, 0, 100);
    relationship.trust = clamp(relationship.trust, 0, 100);
    relationship.dependency = clamp(relationship.dependency, 0, 100);
    relationship.tension = clamp(relationship.tension, 0, 100);

    user.midTerm.relationship = relationship;
    user.midTerm.lastInteractionAt = Date.now();
    user.updatedAt = Date.now();
    this._save();
    return relationship;
  }

  setRecentExpression(userId, expressionId) {
    if (!expressionId) return;
    const user = this.ensureUser(userId);
    const recent = Array.isArray(user.midTerm.recentExpressionIds) ? user.midTerm.recentExpressionIds : [];
    user.midTerm.recentExpressionIds = [...recent.filter((item) => item !== expressionId), expressionId].slice(-3);
    user.updatedAt = Date.now();
    this._save();
  }

  markProactiveReachOut(userId, timestamp = Date.now()) {
    const user = this.ensureUser(userId);
    user.midTerm.lastProactiveAt = timestamp;
    user.updatedAt = Date.now();
    this._save();
  }

  getUserMemory(userId) {
    return this.ensureUser(userId);
  }

  getUserState(userId) {
    const user = this.ensureUser(userId);
    const fallback = createDefaultState();
    const mid = user.midTerm || this._defaultMidTerm();
    const scene = mid.scene || fallback.scene;

    return {
      mode: mid.mode || fallback.mode,
      scene: {
        currentLocation: scene.currentLocation || fallback.scene.currentLocation,
        posture: scene.posture || fallback.scene.posture,
        physicalContinuityLog: Array.isArray(scene.physicalContinuityLog) ? scene.physicalContinuityLog.slice(-40) : []
      },
      userEmotion: mid.userEmotion || fallback.userEmotion,
      emotionDetail: mid.emotionDetail || this._defaultMidTerm().emotionDetail,
      topic: mid.topic || fallback.topic,
      currentNeed: mid.currentNeed || "conversation",
      lastAssistantMode: mid.lastAssistantMode || "companion",
      relationship: {
        ...this._defaultRelationship(),
        ...(mid.relationship || {})
      },
      recentExpressionIds: Array.isArray(mid.recentExpressionIds) ? mid.recentExpressionIds.slice(-3) : [],
      lastInteractionAt: typeof mid.lastInteractionAt === "number" ? mid.lastInteractionAt : 0,
      lastProactiveAt: typeof mid.lastProactiveAt === "number" ? mid.lastProactiveAt : 0
    };
  }

  getRecentConversationMessagesWithinBudget(userId, maxTokens) {
    const budget = Math.max(0, Number(maxTokens) || 0);
    const user = this.ensureUser(userId);
    const list = Array.isArray(user.shortTerm) ? user.shortTerm : [];
    const picked = [];
    let used = 0;

    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i] || {};
      const cost = estimateMessageTokens(item.role, item.content);
      if (cost <= budget - used) {
        picked.push({ role: item.role, content: item.content });
        used += cost;
        continue;
      }
      if (picked.length > 0) break;

      const contentBudget = Math.max(32, budget - MSG_OVERHEAD_TOKENS - estimateTokens(String(item.role || "")));
      picked.push({
        role: item.role || "user",
        content: truncateContentToTokenBudget(String(item.content || ""), contentBudget)
      });
      break;
    }

    return picked.reverse();
  }

  _scoreMemoryItem(item, queryKeywords) {
    const itemKeywords = Array.isArray(item.keywords) ? item.keywords : [];
    let overlap = 0;
    for (const keyword of queryKeywords) {
      if (itemKeywords.includes(keyword) || String(item.text || "").includes(keyword)) {
        overlap++;
      }
    }
    const ageHours = Math.max(1, (Date.now() - (item.ts || Date.now())) / 3600000);
    const recencyBoost = 2 / ageHours;
    const reuseBoost = item.lastUsedAt ? 0.5 : 0;
    return overlap * 5 + (item.salience || 1) + recencyBoost + reuseBoost;
  }

  recallRelevantMemories(userId, query, limit = 8) {
    const user = this.ensureUser(userId);
    const queryKeywords = extractKeywords(query);
    const buckets = [
      ...(user.longTerm.importantEvents || []),
      ...(user.longTerm.userPreferences || []),
      ...(user.longTerm.relationshipNotes || []),
      ...(user.longTerm.conversationSummaries || [])
    ];

    const scored = buckets
      .map((item) => ({ item, score: this._scoreMemoryItem(item, queryKeywords) }))
      .filter((entry) => entry.score > 1.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const entry of scored) {
      entry.item.lastUsedAt = Date.now();
    }
    if (scored.length) this._save();
    return scored.map((entry) => entry.item);
  }

  buildHighPriorityMemoryPrompt(userId, query = "") {
    const user = this.ensureUser(userId);
    const mid = user.midTerm || this._defaultMidTerm();
    const scene = mid.scene || createDefaultState().scene;
    const relationship = {
      ...this._defaultRelationship(),
      ...(mid.relationship || {})
    };
    const recalled = this.recallRelevantMemories(userId, query, 8);
    const latestSummaries = (user.longTerm.conversationSummaries || []).slice(-3);

    const recalledLines = recalled.length
      ? recalled.map((item, index) => `${index + 1}. [${item.type}] ${item.text}`).join("\n")
      : "（暂无强相关长期记忆）";

    const summaryLines = latestSummaries.length
      ? latestSummaries.map((item, index) => `${index + 1}. ${item.text}`).join("\n")
      : "（暂无摘要）";

    return [
      "【高优先级记忆注入】",
      "优先保持关系连续性、情绪连续性和事实连续性。",
      "",
      "【当前中期状态】",
      `- 模式: ${mid.mode || "daily"}`,
      `- 场景: ${scene.currentLocation || ""}`,
      `- 姿态: ${scene.posture || ""}`,
      `- 用户情绪: ${mid.userEmotion || "neutral"}`,
      `- 细分情绪: ${(mid.emotionDetail && mid.emotionDetail.primary) || "neutral"}`,
      `- 当前话题: ${mid.topic || "general"}`,
      `- 当前需求: ${mid.currentNeed || "conversation"}`,
      "",
      "【关系状态】",
      `- 亲密度: ${relationship.intimacy}`,
      `- 信任: ${relationship.trust}`,
      `- 依赖: ${relationship.dependency}`,
      `- 张力: ${relationship.tension}`,
      "",
      "【相关长期记忆召回】",
      recalledLines,
      "",
      "【最近对话摘要】",
      summaryLines,
      "",
      "回复要求：自然调用记忆，不生硬背诵，不重复灌输，像真正记得。"
    ].join("\n");
  }
}

const memoryStore = new MemoryStore();
memoryStore.estimateTokens = estimateTokens;
memoryStore.estimateMessagesTokens = estimateMessagesTokens;

module.exports = memoryStore;
