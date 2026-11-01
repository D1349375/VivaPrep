// Turns local camera metrics into feedback a student can act on.
// Levels use design heuristics, not validated norms; each card says what was
// observed, why it matters in an interview, and one concrete practice step.

const MIN_ANSWER_MS = 8000;

function weighted(rows, read, weightOf = (row) => row.observedMs) {
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    const value = read(row);
    const w = Math.max(0, Number(weightOf(row)) || 0);
    if (Number.isFinite(value) && w > 0) { total += value * w; weight += w; }
  }
  return weight ? total / weight : null;
}

function level(value, good, watch, higherIsBetter = false) {
  if (!Number.isFinite(value)) return "unknown";
  if (higherIsBetter) return value >= good ? "good" : value >= watch ? "watch" : "improve";
  return value <= good ? "good" : value <= watch ? "watch" : "improve";
}

const pct = (value) => `${Math.round(value * 100)}%`;
const seconds = (ms) => `${Math.max(1, Math.round(ms / 1000))} 秒`;

// Merges every camera segment of one answer (the phase can split an answer).
function answerRows(summary, turns) {
  const order = new Map(turns.map((turn, index) => [turn.turnId, index]));
  const byTurn = new Map();
  for (const segment of summary?.segments || []) {
    if (segment.phase !== "candidate_answer" || !order.has(segment.turnId) || !segment.observedMs) continue;
    const list = byTurn.get(segment.turnId) || [];
    list.push(segment);
    byTurn.set(segment.turnId, list);
  }
  return [...byTurn.entries()].map(([turnId, segments]) => {
    const observedMs = segments.reduce((total, row) => total + row.observedMs, 0);
    const attention = Object.fromEntries(["screen", "down", "side", "up"].map((zone) => [zone, weighted(segments, (row) => row.attentionRatios?.[zone])]));
    return {
      turnId,
      index: order.get(turnId),
      question: turns[order.get(turnId)]?.questionText || "",
      observedMs,
      faceCoverage: weighted(segments, (row) => row.faceCoverage),
      attention,
      attentionUnknown: weighted(segments, (row) => row.attentionUnknownRatio),
      postureCoverage: weighted(segments, (row) => row.postureCoverage),
      tilted: weighted(segments, (row) => row.tiltedRatio, (row) => row.observedMs * (row.postureCoverage || 0)),
      slumped: weighted(segments, (row) => row.slumpedRatio, (row) => row.observedMs * (row.postureCoverage || 0)),
      handNearFace: weighted(segments, (row) => row.handNearFaceRatio, (row) => row.observedMs * (row.postureCoverage || 0)),
      motion: weighted(segments, (row) => row.averageTorsoDisplacementPerSecond),
      awayEpisodes: segments.reduce((total, row) => total + (row.awayEpisodes || 0), 0),
      longestDownMs: Math.max(0, ...segments.map((row) => row.longestDownMs || 0)),
      longestAwayMs: Math.max(0, ...segments.map((row) => row.longestAwayMs || 0)),
    };
  }).sort((a, b) => a.index - b.index);
}

function worst(rows, read, minimum) {
  const candidates = rows.filter((row) => Number.isFinite(read(row)) && read(row) > minimum).sort((a, b) => read(b) - read(a));
  return candidates[0] || null;
}

export function buildPostureFeedback(summary, turns = []) {
  if (!summary || !Array.isArray(summary.segments)) return null;
  const calibrated = summary.calibration === "camera-baseline-calibrated";
  const rows = answerRows(summary, turns);
  const observedMs = rows.reduce((total, row) => total + row.observedMs, 0);
  const faceCoverage = weighted(rows, (row) => row.faceCoverage);
  const postureCoverage = weighted(rows, (row) => row.postureCoverage);
  const limits = [];
  if (summary.schemaVersion !== "camera-trial-v2") limits.push("這份紀錄來自舊版鏡頭分析，只有頭部左右方向，沒有視線與坐姿資料。");
  if (!calibrated) limits.push("沒有完成個人基線校正，視線與坐姿無法判斷。下次開始時請坐正、看著考官約 3 秒。");
  if (observedMs < MIN_ANSWER_MS) limits.push("回答期間的鏡頭資料不到 8 秒，結果僅供參考。");
  if (Number.isFinite(faceCoverage) && faceCoverage < 0.6) limits.push(`回答時只有 ${pct(faceCoverage)} 的時間偵測到臉，可能是光線、角度或離鏡頭太遠。`);
  if (Number.isFinite(postureCoverage) && postureCoverage < 0.5) limits.push(`回答時只有 ${pct(postureCoverage)} 的時間看得到雙肩，坐姿數值較不可靠；把鏡頭拉遠一點，讓肩膀入鏡。`);
  const usable = calibrated && summary.schemaVersion === "camera-trial-v2" && observedMs >= MIN_ANSWER_MS;

  const screen = weighted(rows, (row) => row.attention.screen);
  const down = weighted(rows, (row) => row.attention.down);
  const side = weighted(rows, (row) => row.attention.side);
  const up = weighted(rows, (row) => row.attention.up);
  const tilted = weighted(rows, (row) => row.tilted, (row) => row.observedMs * (row.postureCoverage || 0));
  const slumped = weighted(rows, (row) => row.slumped, (row) => row.observedMs * (row.postureCoverage || 0));
  const hands = weighted(rows, (row) => row.handNearFace, (row) => row.observedMs * (row.postureCoverage || 0));
  const motion = weighted(rows, (row) => row.motion);
  const longestDownMs = Math.max(0, ...rows.map((row) => row.longestDownMs));
  const postureIssue = Number.isFinite(tilted) || Number.isFinite(slumped) ? Math.max(tilted || 0, slumped || 0) : null;
  const downWorst = worst(rows, (row) => row.attention.down, 0.2);
  const sideWorst = worst(rows, (row) => row.attention.side, 0.2);
  const where = (row, label) => row ? `最明顯在第 ${row.index + 1} 題（${label}）。` : "";

  const cards = usable ? [
    {
      id: "eye-contact", title: "看向考官", value: Number.isFinite(screen) ? pct(screen) : "—",
      level: level(screen, 0.7, 0.5, true),
      detail: Number.isFinite(screen) ? `回答時約 ${pct(screen)} 的時間視線在考官（螢幕）方向。` : "資料不足。",
      why: "委員會從視線判斷你是否在跟他們對話，而不是在背稿。",
      tip: "把考官畫面拉到鏡頭正下方；講結論的那一句，刻意看著考官說完。",
    },
    {
      id: "looking-down", title: "低頭", value: Number.isFinite(down) ? pct(down) : "—",
      level: level(down, 0.15, 0.3),
      detail: Number.isFinite(down) ? `回答時約 ${pct(down)} 的時間低頭${longestDownMs >= 3000 ? `，最長連續 ${seconds(longestDownMs)}` : ""}。${where(downWorst, `低頭 ${pct(downWorst?.attention.down || 0)}`)}` : "資料不足。",
      why: "長時間低頭容易讓人覺得在看稿，聲音也會變小、變悶。",
      tip: "提示改成三個關鍵字，貼在鏡頭旁邊而不是放在桌上；想事情可以短暫低頭，開口時抬頭。",
    },
    {
      id: "looking-aside", title: "看旁邊", value: Number.isFinite(side) ? pct(side) : "—",
      level: level(side, 0.15, 0.3),
      detail: Number.isFinite(side) ? `回答時約 ${pct(side)} 的時間視線偏向左右。${where(sideWorst, `看旁邊 ${pct(sideWorst?.attention.side || 0)}`)}` : "資料不足。",
      why: "回想時移開視線很正常，但一直看旁邊會顯得分心或不確定。",
      tip: "回想時可以移開，整理好第一句就把視線拉回考官；關掉旁邊會跳通知的視窗。",
    },
    {
      id: "posture", title: "坐姿", value: Number.isFinite(postureIssue) ? pct(postureIssue) : "—",
      level: level(postureIssue, 0.2, 0.4),
      detail: Number.isFinite(postureIssue) ? `和開場校正相比，約 ${pct(slumped || 0)} 的時間頭肩下沉（駝背或滑坐）、${pct(tilted || 0)} 的時間肩膀明顯歪斜。` : "看不到雙肩，無法判斷坐姿。",
      why: "坐直讓聲音比較穩，也比較像在正式場合對談。",
      tip: "坐在椅子前三分之二、背挺直、雙肩放鬆同高；鏡頭架到眼睛高度，避免一路往下看螢幕而駝背。",
    },
    {
      id: "hands", title: "手部靠近臉", value: Number.isFinite(hands) ? pct(hands) : "—",
      level: level(hands, 0.1, 0.25),
      detail: Number.isFinite(hands) ? `約 ${pct(hands)} 的時間手靠近臉部（托腮、摸臉、撥頭髮或遮嘴）。` : "看不到雙手，無法判斷。",
      why: "手常靠近臉會擋住表情和聲音，也容易被解讀成緊張。",
      tip: "手自然放在桌面或腿上，需要強調時再比手勢，說完放回原位。",
    },
    {
      id: "movement", title: "身體晃動", value: Number.isFinite(motion) ? `${motion.toFixed(2)}` : "—",
      level: level(motion, 0.08, 0.15),
      detail: Number.isFinite(motion) ? `上半身平均每秒移動約 ${motion.toFixed(2)} 個肩寬。` : "看不到雙肩，無法判斷。",
      why: "持續前後搖或轉椅子會分散委員注意力。",
      tip: "雙腳平踩地面，不坐會旋轉的椅子；緊張時先吐一口氣再開口。",
    },
  ] : [];
  if (usable && Number.isFinite(up) && up > 0.2) {
    cards.push({ id: "looking-up", title: "往上看", value: pct(up), level: "watch",
      detail: `約 ${pct(up)} 的時間往上看。思考時往上看很常見，不算扣分。`,
      why: "如果是在想答案，可以先說「我想一下」，讓委員知道你在整理。",
      tip: "先講結論再補細節，可以減少邊講邊想的時間。" });
  }

  const perQuestion = rows.map((row) => {
    const flags = [];
    if (usable && row.attention.down > 0.3) flags.push(`低頭 ${pct(row.attention.down)}`);
    if (usable && row.attention.side > 0.3) flags.push(`看旁邊 ${pct(row.attention.side)}`);
    if (usable && Math.max(row.tilted || 0, row.slumped || 0) > 0.4) flags.push("坐姿下沉或歪斜");
    if (usable && row.handNearFace > 0.25) flags.push("手常靠近臉");
    if (row.longestDownMs >= 5000) flags.push(`連續低頭 ${seconds(row.longestDownMs)}`);
    return { ...row, flags };
  });
  const priorities = cards.filter((card) => card.level === "improve").concat(cards.filter((card) => card.level === "watch")).slice(0, 2);
  const strengths = cards.filter((card) => card.level === "good").map((card) => card.title);
  return { usable, calibrated, cards, perQuestion, priorities, strengths, limits };
}
