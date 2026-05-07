require("dotenv").config();

const memory = require("./core/memory");
memory.reloadFromDisk();

const { Telegraf } = require("telegraf");
const brain = require("./core/brain");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("缺少 TELEGRAM_BOT_TOKEN，请先配置 .env");
}

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error("缺少 DEEPSEEK_API_KEY，请先配置 .env");
}

// ==================== 代理配置（最终加强版） ====================
const proxyUrl =
  process.env.TELEGRAM_PROXY_URL ||
  process.env.HTTP_PROXY_URL ||
  process.env.HTTP_PROXY ||
  process.env.HTTPS_PROXY ||
  "http://192.168.1.3:7897";

console.log("正在启动姐姐... 使用代理:", proxyUrl);

let botOptions = {};

if (proxyUrl) {
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    const proxyAgent = new HttpsProxyAgent(proxyUrl);
    botOptions = {
      telegram: {
        /** 强制让 Telegram Bot 的底层 HTTPS 请求走代理 */
        agent: proxyAgent
      },
      /**
       * 兼容部分底层库（如 request 风格配置）：
       * 即便当前实现未读取该字段，也不影响 telegraf 使用 `telegram.agent`。
       */
      request: {
        agent: proxyAgent
      }
    };
    console.log("✅ 代理配置已加载");
  } catch (e) {
    console.error("代理模块加载失败:", e.message);
  }
}

const bot = new Telegraf(token, botOptions);
// ==================== 原有逻辑保持不变 ====================
const delayMs = Number(process.env.TELEGRAM_MESSAGE_DELAY_MS || 6000);
const lastMessageAt = new Map();

function canProcess(userId) {
  const now = Date.now();
  const prev = lastMessageAt.get(userId) || 0;
  if (now - prev < delayMs) return false;
  lastMessageAt.set(userId, now);
  return true;
}

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || "小孤声";
  await ctx.reply(
    `姐姐在。${name}，你可以直接和我说话。\n` +
      "可用指令：\n" +
      "/mode daily|intimate|healing\n" +
      "/scene 地点(如 客厅/卧室/走廊)\n" +
      "/remember event|pref|note 内容\n" +
      "/state 查看当前记忆状态"
  );
});

bot.command("mode", async (ctx) => {
  const input = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();
  const userId = ctx.from.id;
  const result = brain.commandSetMode(userId, input);
  await ctx.reply(result);
});

bot.command("scene", async (ctx) => {
  const input = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();
  const userId = ctx.from.id;
  if (!input) {
    await ctx.reply("请提供地点，例如：/scene 卧室");
    return;
  }
  const result = brain.commandMoveScene(userId, input);
  await ctx.reply(result);
});

bot.command("remember", async (ctx) => {
  const parts = (ctx.message.text || "").split(" ").slice(1);
  const type = parts.shift();
  const value = parts.join(" ").trim();
  const userId = ctx.from.id;
  if (!type || !value) {
    await ctx.reply("用法：/remember event|pref|note 内容");
    return;
  }
  if (!["event", "pref", "note"].includes(type)) {
    await ctx.reply("类型仅支持 event / pref / note");
    return;
  }
  const result = brain.commandRemember(userId, type, value);
  await ctx.reply(result);
});

bot.command("state", async (ctx) => {
  const userId = ctx.from.id;
  const s = brain.commandState(userId);
  await ctx.reply(
    [
      `mode: ${s.mode}`,
      `location: ${s.location}`,
      `posture: ${s.posture}`,
      `emotion: ${s.emotion}`,
      `topic: ${s.topic}`,
      `shortTerm: ${s.shortTermCount}`,
      `longTerm.events: ${s.longTermEvents}`,
      `longTerm.preferences: ${s.preferences}`
    ].join("\n")
  );
});

bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || "小孤声";
  const text = ctx.message.text || "";

  if (!canProcess(userId)) {
    await ctx.reply("让我喘口气，马上继续陪你。");
    return;
  }

  try {
    await ctx.sendChatAction("typing");
    const reply = await brain.generateReply({ userId, userName, text });
    await ctx.reply(reply);
  } catch (err) {
    console.error("message error:", err?.response?.data || err.message || err);
    await ctx.reply("刚刚网络有点抖，我还在，重新和我说一句。");
  }
});

bot.catch((err) => {
  console.error("bot catch:", err);
});

bot.launch().then(() => {
  console.log("✅ 姐姐 (Lulu) 已成功启动！");
  console.log(`DeepSeek model: ${process.env.DEEPSEEK_MODEL || "deepseek-chat"}`);
  console.log(`Proxy: ${process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "http://192.168.1.3:7897"}`);
}).catch(err => {
  console.error("启动失败:", err.message);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
