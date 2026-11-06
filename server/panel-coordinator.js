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

// Which professor an answer leans toward. Terms cover general high-school CS
// backgrounds (languages, APCS, competitions, makers, AI, security, web), not one
// student's portfolio. Each category counts distinct terms; the highest count wins.
const answerLexicon = {
  technical: [
    "程式", "coding", "code", "演算法", "資料結構", "陣列", "鏈結串列", "堆疊", "佇列", "樹狀", "圖論", "遞迴", "迴圈", "排序", "搜尋", "二分", "動態規劃", "貪婪", "暴力解", "複雜度",
    "函式", "變數", "物件導向", "指標", "記憶體", "編譯", "除錯", "debug", "bug", "測試",
    "c語言", "c 語言", "c++", "c#", "java", "javascript", "typescript", "python", "rust", "golang", "kotlin", "swift", "php", "html", "css", "sql", "scratch", "arduino", "樹莓派", "raspberry pi", "micro:bit", "verilog",
    "apcs", "競程", "解題", "zerojudge", "leetcode", "codeforces", "atcoder", "ioi", "toi", "資訊奧林匹亞", "online judge",
    "系統", "架構", "伺服器", "資料庫", "前端", "後端", "網頁", "網站", "app", "api", "框架", "github", "git", "linux", "作業系統", "網路", "封包", "雲端",
    "資安", "漏洞", "加密", "密碼學", "駭客", "ctf", "滲透", "注入",
    "ai", "人工智慧", "機器學習", "深度學習", "神經網路", "模型", "訓練", "資料集", "大型語言模型", "llm", "辨識",
    "電路", "感測器", "機器人", "單晶片", "硬體", "邏輯閘", "二進位",
  ],
  motivation: [
    "動機", "為什麼", "興趣", "喜歡", "熱情", "好奇", "想讀", "想念", "志向", "志願", "夢想", "目標", "未來", "職涯", "規劃", "選擇", "科系", "契機", "啟發", "影響", "憧憬",
    "反思", "成長", "改變", "收穫", "體會", "學到", "自學", "價值", "意義", "挫折", "失敗", "堅持",
  ],
  portfolio: [
    "專題", "作品", "備審", "學習歷程", "負責", "分工", "貢獻", "組員", "隊友", "團隊", "小組", "合作", "溝通", "領導", "組長", "成果", "報告", "發表",
    "比賽", "競賽", "得獎", "社團", "幹部", "營隊", "志工", "服務", "實驗", "研究", "小論文", "科展", "多元表現", "自主學習",
  ],
};

const asciiTerm = /^[\x20-\x7e]+$/;
const answerMatchers = Object.fromEntries(Object.entries(answerLexicon).map(([role, terms]) => [role, terms.map((term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // ASCII terms must stand alone so "ai" does not match "email" and "c++" does not match "abc++".
  return new RegExp(asciiTerm.test(term) ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped, "u");
})]));

export function classifyAnswer(answer) {
  const text = String(answer || "").normalize("NFKC").toLowerCase();
  return Object.fromEntries(Object.entries(answerMatchers).map(([role, matchers]) => [role, matchers.filter((matcher) => matcher.test(text)).length]));
}

function preferredRoles(answer, eligible) {
  const counts = classifyAnswer(answer);
  const best = Math.max(0, ...eligible.map((role) => counts[role] || 0));
  // No signal: fall back to the portfolio professor, who can always ask about the student's own work.
  if (!best) return new Set(eligible.includes("portfolio") ? ["portfolio"] : []);
  const tied = eligible.filter((role) => counts[role] === best);
  // Portfolio wording ("研究", "比賽") is broad, so a tie goes to the more specific professor.
  return new Set(tied.length > 1 ? tied.filter((role) => role !== "portfolio") : tied);
}

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
    const preferred = preferredRoles(answer, eligible);
    return eligible.map((role) => ({ role, score: (preferred.has(role) ? 0.8 : 0) - (role === recent.at(-1) ? 0.3 : 0) - (recent.length === 2 && recent.every((id) => id === role) ? 2 : 0) - turns.filter((turn) => turn.roleId === role).length * 0.12 - (task === "switch_topic" && role === recent.at(-1) ? 1 : 0) })).sort((a,b) => b.score - a.score)[0].role;
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
