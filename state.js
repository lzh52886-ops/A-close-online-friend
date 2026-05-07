const DEFAULT_SCENE_GRAPH = {
  客厅: ["餐厅", "阳台", "走廊"],
  走廊: ["客厅", "卧室", "浴室", "书房"],
  卧室: ["走廊", "衣帽间"],
  衣帽间: ["卧室"],
  浴室: ["走廊"],
  书房: ["走廊"],
  餐厅: ["客厅", "厨房"],
  厨房: ["餐厅"],
  阳台: ["客厅"]
};

function createDefaultState() {
  return {
    mode: "daily",
    scene: {
      currentLocation: "客厅",
      posture: "坐着",
      physicalContinuityLog: []
    },
    userEmotion: "neutral",
    topic: "general"
  };
}

function canMove(graph, from, to) {
  const next = graph[from] || [];
  return next.includes(to);
}

function buildMoveNarration(from, to) {
  if (from === to) return "她没有挪动位置，只是轻轻调整了姿势。";
  return `她先从${from}起身，整理了一下衣摆，步伐从容地穿过连接区域，最后停在${to}。`;
}

function moveWithConstraint(state, to, graph = DEFAULT_SCENE_GRAPH) {
  const from = state.scene.currentLocation;
  if (from === to) {
    const text = buildMoveNarration(from, to);
    state.scene.physicalContinuityLog.push({ from, to, ok: true, text, at: Date.now() });
    return { ok: true, narration: text };
  }

  if (!canMove(graph, from, to)) {
    const text = `从${from}不能直接到${to}，需要经过中间区域，避免动作瞬移。`;
    state.scene.physicalContinuityLog.push({ from, to, ok: false, text, at: Date.now() });
    return { ok: false, narration: text };
  }

  state.scene.currentLocation = to;
  const text = buildMoveNarration(from, to);
  state.scene.physicalContinuityLog.push({ from, to, ok: true, text, at: Date.now() });
  return { ok: true, narration: text };
}

function setMode(state, mode) {
  const allow = new Set(["daily", "intimate", "healing"]);
  if (!allow.has(mode)) return false;
  state.mode = mode;
  return true;
}

function setUserEmotion(state, emotion) {
  state.userEmotion = emotion || "neutral";
}

function setTopic(state, topic) {
  state.topic = topic || "general";
}

module.exports = {
  DEFAULT_SCENE_GRAPH,
  createDefaultState,
  moveWithConstraint,
  setMode,
  setUserEmotion,
  setTopic
};
