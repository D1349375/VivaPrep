import { violatesAnonymity } from "./anonymity.js";

const roleToSpeaker = { portfolio: "portfolio", technical: "technical", motivation: "logic" };

// Used when the Agent cannot produce a valid new-topic question twice in a row.
export const safeSwitchQuestions = {
  portfolio: { candidateQuestion: "好，這部分我了解了。那我們換個方向：可以分享一段你主動找資料、自己解決問題的學習經驗嗎？", questionFocus: "learning" },
  technical: { candidateQuestion: "我們換個角度聊。最近有哪個資訊相關的概念讓你覺得有趣？可以用自己的話說明嗎？", questionFocus: "learning" },
  motivation: { candidateQuestion: "那我們聊聊動機。是什麼經驗讓你開始想讀這個科系？", questionFocus: "motivation" },
};

const roleKeywords = {
  portfolio: ["專題", "負責", "作品", "備審", "經驗", "貢獻", "成果"],
  technical: ["程式", "演算法", "資料", "系統", "概念", "驗證", "複雜度", "技術"],
  motivation: ["為什麼", "動機", "反思", "學習", "未來", "選擇", "調整"],
};

function semanticScore(assessment, answer) {
  const text = ((assessment.candidateQuestion || "") + " " + answer).toLowerCase();
  return (roleKeywords[assessment.agentId] || []).reduce((score, term) => score + (text.includes(term) ? 0.18 : 0), 0);
}

export function isRepeatedQuestion(assessment, turns) {
  const recent = turns.slice(-4);
  if (assessment.questionFocus && recent.some((turn) => turn.questionFocus === assessment.questionFocus)) return true;
  const normalize = (text) => String(text || "").normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "").toLowerCase();
  const question = normalize(assessment.candidateQuestion);
  const pairs = (text) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)));
  const currentPairs = pairs(question);
  return recent.flatMap((turn) => [turn.questionText, ...(turn.followUps || [])]).some((text) => {
    const previous = normalize(text);
    if (question === previous) return true;
    if (question.length < 16 || previous.length < 16) return false;
    const previousPairs = pairs(previous);
    const overlap = [...currentPairs].filter((pair) => previousPairs.has(pair)).length;
    return 2 * overlap / (currentPairs.size + previousPairs.size) >= 0.7;
  });
}

export class PanelCoordinator {
  chooseRole(roster, turns, answer = "", task = "assessment") {
    const eligible = roster.map((id) => id === "logic" ? "motivation" : id);
    const recent = turns.slice(-2).map((turn) => turn.roleId);
    const preferred = /程式|系統|演算法|測試|資料庫|搜尋|漏洞|Python|SSTI|API/iu.test(answer) ? "technical" : /動機|大學|學習|未來|興趣/u.test(answer) ? "motivation" : "portfolio";
    return eligible.map((role) => ({ role, score: (role === preferred ? 0.8 : 0) - (role === recent.at(-1) ? 0.3 : 0) - (recent.length === 2 && recent.every((id) => id === role) ? 2 : 0) - turns.filter((turn) => turn.roleId === role).length * 0.12 - (task === "switch_topic" && role === recent.at(-1) ? 1 : 0) })).sort((a,b) => b.score - a.score)[0].role;
  }

  select(assessments, roster, turns, seed) {
    const activeRoles = new Set(roster.map((id) => id === "logic" ? "motivation" : id));
    const available = assessments.filter((assessment) => activeRoles.has(assessment.agentId) && assessment.candidateQuestion && assessment.candidateQuestion.length <= 140 && !violatesAnonymity(assessment.candidateQuestion) && !isRepeatedQuestion(assessment, turns));
    if (!available.length) return null;
    const recent = turns.slice(-3).map((turn) => turn.roleId);
    const lastRole = recent.at(-1);
    const scores = available.map((assessment) => {
      const consecutivePenalty = lastRole === assessment.agentId ? 0.35 : 0;
      const turnCount = turns.filter((turn) => turn.roleId === assessment.agentId).length;
      const balanceBonus = 0.12 / (turnCount + 1);
      const seededTieBreak = (((seed + assessment.agentId.length * 37) % 101) / 1000);
      return {
        assessment,
        score: assessment.relevance + semanticScore(assessment, turns.at(-1)?.answerText || "") + balanceBonus + seededTieBreak - consecutivePenalty,
      };
    }).sort((a, b) => b.score - a.score || a.assessment.agentId.localeCompare(b.assessment.agentId));
    const selected = scores[0].assessment;
    return {
      speakerId: roleToSpeaker[selected.agentId],
      roleId: selected.agentId,
      utterance: selected.candidateQuestion,
      assessment: selected,
      phase: "question",
      action: "speaking",
      topic: selected.rubricDimension,
    };
  }
}
