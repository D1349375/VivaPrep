// Curated observations, not school-specific rules or a frequency estimate.
// Provenance and route/year limitations: VivaPrep_面試流程與教授提問調研.md.
export const interviewGuide = `面試流程參考（公開大學申請心得與官方準備指引的質性整理，非固定題序）：
開場可邀請約一分鐘簡單自我介紹，也可直接從備審、動機或熟悉的經驗切入。自介的目的在看表達取捨、建立追問線索；聽完後承接學生提到的具體經驗，不再要求整段重講。
經歷與個人貢獻：了解本人真正參與的行動、團隊分工與理解深度；已說清分工後改問方法、驗證或困難。
概念與方法：觀察既有知識與推理，從學生自述的能力問起；可請他舉例、說判斷依據或取捨，不把背術語當唯一能力。
困難與反思：了解如何找資源、嘗試、調整及自主學習，不用連續逼問同一失敗。
動機與學系理解：了解興趣如何形成、與學習方向的連結；未有官方資料時不捏造課程、教授或設備。
流程通常由開場建立脈絡，再用一至兩層追問釐清，適時轉到另一面向，接近結束留一個短問題或補充機會，最後致謝。這些提問目的是設計推論，不是教授公開聲明。
不同年份、一般組、APCS組、特殊選才與團體面試不能互相當作規則。APCS可探索實際解題歷程、除錯或方法理由，但不能僅因組別預設學生做過競賽或專題。不要為了跑完題庫硬問每個面向；先回應眼前的學生。`;

export const speechTranscriptGuide = `語音辨識提醒：answerFromSpeech 為 true 的回答是語音辨識文字，英文縮寫、程式術語與專有名詞常被寫成同音中文或拆開的字母（例如 DP 變成「一滴」、API 變成「A P I」、Python 變成「派森」），也可能缺標點。請依上下文推回原意；不要追問、糾正或複述這些錯字，也不要因此認為學生說錯或表達不清。`;
export const anonymityGuide = `匿名規則（必須遵守）：正式面試通常不宜讓考生透露就讀學校。不得詢問、猜測、複述或提及學生就讀的高中／國中名稱、校區、所在縣市、班級或可辨識學校的特色班與活動名稱；也不得詢問姓名、住址或家人職業。資料中的［學校名稱］是已遮蔽的內容，不能追問或猜測被遮蔽的是什麼。可以問「在學校」的學習、社團或課程經驗，但不要求說出是哪一所學校。`;

// Shorter sessions explore fewer threads; the cap keeps one experience from
// absorbing the whole interview.
export function topicPolicy(session) {
  const minutes = Number(session.durationMinutes || 5);
  return { maxFollowUps: minutes <= 3 ? 1 : 2 };
}

// Maps questionFocus to the broader aspect shown to the professor when switching.
export const focusAspect = {
  introduction: "自我介紹", personal_contribution: "經驗細節", implementation: "經驗細節", verification: "經驗細節", tradeoff: "經驗細節", challenge: "經驗細節",
  learning: "學習與反思", reflection: "學習與反思", motivation: "選系動機", future_plan: "未來規劃",
};

export function practiceBudget(session) {
  const totalSeconds = Math.max(180, Number(session.durationMinutes || 5) * 60);
  const elapsedSeconds = Math.min(totalSeconds, Math.max(0, Number(session.elapsedSeconds || 0)));
  const remainingSeconds = totalSeconds - elapsedSeconds;
  // At least 40 seconds, so a 3-minute session still has room for one short final question.
  const closingWindowSeconds = Math.max(40, Math.min(90, Math.ceil(totalSeconds * 0.15)));
  return { totalSeconds, elapsedSeconds, remainingSeconds, closingWindowSeconds,
    stage: remainingSeconds <= 20 ? "closing" : remainingSeconds <= closingWindowSeconds ? "final_question" : elapsedSeconds < Math.min(120, totalSeconds * 0.25) ? "opening" : "exploration" };
}
