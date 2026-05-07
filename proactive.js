function minutesBetween(from, to) {
  if (!from || !to) return Infinity;
  return Math.max(0, (to - from) / 60000);
}

function shouldReachOut(userState, lastInteraction, relationship) {
  const now = Date.now();
  const rel = relationship || userState?.relationship || {
    intimacy: 10,
    trust: 10,
    dependency: 5,
    tension: 0
  };
  const lastTalkAt = typeof lastInteraction === "number" ? lastInteraction : userState?.lastInteractionAt || 0;
  const lastProactiveAt = userState?.lastProactiveAt || 0;
  const emotion = userState?.emotionDetail?.primary || userState?.userEmotion || "neutral";

  const enoughSinceLastTalk = minutesBetween(lastTalkAt, now) >= 30;
  const recentlySadOrStressed = emotion === "sad" || emotion === "stressed" || emotion === "anxious";
  const dependencyHigh = rel.dependency > 60;
  const cooldownPassed = minutesBetween(lastProactiveAt, now) >= 20;

  if (!cooldownPassed) return false;

  return (
    (enoughSinceLastTalk && rel.intimacy > 30) ||
    recentlySadOrStressed ||
    dependencyHigh
  );
}

function generateProactiveMessage(context = {}) {
  const relationship = context.relationship || {
    intimacy: 10,
    trust: 10,
    dependency: 5,
    tension: 0
  };
  const emotion = context.emotion || context.userState?.emotionDetail?.primary || "neutral";
  const intimacy = relationship.intimacy || 10;

  let pool = [
    "刚刚突然想到你。",
    "今天好像有点安静。",
    "你现在是在发呆，还是在忙？"
  ];

  if (emotion === "sad" || emotion === "stressed" || emotion === "anxious") {
    pool = [
      "刚刚想起你，还是有点不放心。",
      "姐姐又想到你了……今天别一个人扛着。",
      "你这会儿如果还闷着，就回我一句。"
    ];
  } else if (intimacy > 70) {
    pool = [
      "刚刚突然想到你，就想来碰你一下。",
      "你今天有点安静，姐姐会惦记。",
      "在忙也好，发呆也好，记得让我知道你还在。"
    ];
  } else if (intimacy > 30) {
    pool = [
      "刚刚突然想到你，所以来看看你。",
      "今天好像有点安静，你那边还顺利吗？",
      "你现在是在忙，还是终于肯歇一下了？"
    ];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  shouldReachOut,
  generateProactiveMessage
};
