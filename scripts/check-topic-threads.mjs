import assert from "node:assert/strict";
import { InterviewOrchestrator } from "../server/interview-orchestrator.js";
import { PanelCoordinator } from "../server/panel-coordinator.js";
import { practiceBudget, topicPolicy } from "../server/interview-guide.js";
import { buildAgentPrompt } from "../server/agent-provider.js";
import { roles } from "../server/agent-service.js";
import { redactSchoolMentions, violatesAnonymity } from "../server/anonymity.js";
import { config } from "../server/config.js";

// Durations: 3 / 5 / 8 minutes, and a short session still has a final-question window.
assert.equal(config.sessionDurationMin, 3);
assert.equal(config.sessionDurationMax, 8);
assert.equal(practiceBudget({ durationMinutes: 3 }).totalSeconds, 180);
assert.equal(practiceBudget({ durationMinutes: 3 }).closingWindowSeconds, 40);
assert.equal(practiceBudget({ durationMinutes: 5 }).closingWindowSeconds, 45);
assert.equal(practiceBudget({ durationMinutes: 8 }).closingWindowSeconds, 72);
assert.equal(topicPolicy({ durationMinutes: 3 }).maxFollowUps, 1);
assert.equal(topicPolicy({ durationMinutes: 5 }).maxFollowUps, 2);

// School names are masked; ordinary school words are kept.
for (const text of ["我在建國中學參加資訊社", "就讀臺北市立建國高級中學", "我是台中一中的學生", "在北一女參加營隊", "I study at Taipei Municipal Jianguo Senior High School."]) {
  assert.ok(redactSchoolMentions(text).count > 0, text);
}
for (const text of ["高中時期我開始寫程式", "我參加高中程式競賽", "我們學校的資訊課", "國中的時候", "整個高中"]) {
  assert.equal(redactSchoolMentions(text).count, 0, text);
}
for (const question of ["你是哪間高中的？", "你們學校有什麼特色？", "你在［學校名稱］做了什麼？", "你在建國中學時做了什麼？", "你家住哪裡？"]) {
  assert.equal(violatesAnonymity(question), true, question);
}
for (const question of ["這個專題叫什麼名字？", "你在學校社團做了什麼？", "你怎麼確認搜尋結果正確？"]) {
  assert.equal(violatesAnonymity(question), false, question);
}

function fixture({ durationMinutes = 5, roster = ["portfolio", "technical", "logic"], answer, realPlanner = false } = {}) {
  const calls = [];
  const events = [];
  let sessionRef;
  const store = {
    create(session) { sessionRef = session; },
    get: () => sessionRef,
    save() {},
    delete() {},
    emit(id, event) { const next = { ...event, seq: ++sessionRef.eventSequence }; events.push(next); return next; },
  };
  let counter = 0;
  const agentService = {
    mode: "mock",
    release() {},
    async review(context) {
      calls.push({ role: "review", context: structuredClone(context) });
      return { summary: "", sharedStrengths: [], improvementPriorities: [], perspectiveDifferences: [], practiceDrill: [], evidenceRefs: [], sourceRefs: [], dataLimits: [] };
    },
    async assess(role, context) {
      calls.push({ role, context: structuredClone(context) });
      if (answer) return answer(role, context, calls.length);
      counter += 1;
      if (context.task === "opening") return { agentId: role, candidateQuestion: "可以介紹一段你在專題中親手完成的工作嗎？", questionFocus: "personal_contribution", dialogueAction: "opening", sourceRefs: [], relevance: 1 };
      const focus = ["implementation", "verification", "challenge", "motivation", "future_plan", "reflection", "tradeoff", "learning"][counter % 8];
      const questions = ["你用什麼方式確認搜尋結果是正確的？", "當時遇到最難處理的問題是什麼？", "為什麼會想讀資訊工程？", "進大學後最想先補強哪項能力？", "回頭看這段經驗，你會改變哪個決定？", "如果資料量變大，你會怎麼調整？", "最近自學了什麼新東西？", "你怎麼安排專題和課業的時間？"];
      return { agentId: role, candidateQuestion: questions[counter % questions.length], questionFocus: focus, dialogueAction: context.task === "switch_topic" ? "switch_topic" : "follow_up", sourceRefs: [], relevance: 1 };
    },
  };
  const speechAdapter = { status: () => ({ available: false }), async synthesize() { throw new Error("unused"); } };
  const orchestrator = new InterviewOrchestrator({
    store, agentService, coordinator: new PanelCoordinator(), speechAdapter,
    reportRepository: { approvedSources: async () => [] },
    getProfile: () => ({ id: "p", version: 1, school: "逢甲大學", department: "資訊工程學系", academicYear: 115, admissionRoute: "個人申請", officialFacts: [], unknowns: [], profileStatus: "official", sources: [] }),
    config: { ...config, maxAnswerLength: 8000 },
  });
  // These checks count follow-ups from the first question, so they open on an experience instead of the greeting.
  if (!realPlanner) orchestrator.openingPlanner = { choose: ({ eligibleRoles }) => ({ id: "personal_contribution", roleId: eligibleRoles[0], instruction: "從親手完成的工作切入。", claimIndex: null, claim: null }) };
  return { orchestrator, calls, events, get session() { return sessionRef; }, durationMinutes, roster };
}

async function answerCurrent(f, text, elapsedSeconds) {
  const turnId = f.session.currentEvent.turnId;
  const result = await f.orchestrator.submitAnswer(f.session.id, { turnId, text, elapsedSeconds });
  await f.session.processingPromise;
  return result;
}

// Every real interview opens with the fixed greeting, then the model follows the introduction.
for (const [durationMinutes, span] of [[5, "一分鐘"], [3, "三十秒"]]) {
  const f = fixture({ realPlanner: true });
  await f.orchestrator.createSession({ profileId: "p", panelIds: f.roster, durationMinutes, mode: "text", confirmedClaims: [{ text: "我做過校園借閱系統。" }] }, { guestOwnerHash: "o" });
  assert.equal(f.calls.length, 0, "The greeting needs no model call");
  const [opening] = f.session.turns;
  assert.equal(opening.questionFocus, "introduction");
  assert.ok(opening.questionText.startsWith("同學你好，我是") && opening.questionText.includes(`先請你用${span}簡單自我介紹`), opening.questionText);
  assert.equal(violatesAnonymity(opening.questionText), false, "Telling the student not to name the school is not asking for it");
  assert.equal(f.session.timings.find((item) => item.stage === "opening_question").modelCalls, 0);
  await answerCurrent(f, "我喜歡寫程式，高二做過借閱系統。", 30);
  const followUp = f.calls.at(-1).context;
  assert.equal(followUp.conversation.reason, "after_introduction");
  assert.equal(followUp.conversation.nextAngle.claim, "我做過校園借閱系統。", "The held angle is offered once the introduction is done");
}

// A thread gets at most maxFollowUps follow-ups, then the next question is forced onto a new thread.
{
  const f = fixture();
  await f.orchestrator.createSession({ profileId: "p", panelIds: f.roster, durationMinutes: 5, mode: "text", confirmedClaims: [] }, { guestOwnerHash: "o" });
  await answerCurrent(f, "我負責搜尋功能，用 Python 寫查詢。", 30);
  await answerCurrent(f, "我用十組測試資料比對結果。", 60);
  await answerCurrent(f, "我遇到中文斷詞的問題，後來改用其他套件。", 90);
  const [opening, follow1, follow2, switched] = f.session.turns;
  assert.equal(follow1.threadId, opening.threadId);
  assert.equal(follow2.threadId, opening.threadId);
  assert.equal(follow2.threadDepth, 2);
  assert.equal(f.calls.at(-1).context.task, "switch_topic", "Third follow-up on one experience is replaced by a topic switch");
  assert.equal(f.calls.at(-1).context.conversation.reason, "thread_follow_up_limit");
  assert.equal(f.calls.at(-1).context.conversation.currentThread.questions.length, 3);
  assert.notEqual(switched.threadId, opening.threadId);
  assert.equal(switched.threadDepth, 0);
  assert.equal(f.events.filter((event) => event.type === "interview.event").at(-1).dialogueAction, "switch_topic");
}

// Three-minute sessions allow one follow-up per thread.
{
  const f = fixture();
  await f.orchestrator.createSession({ profileId: "p", panelIds: f.roster, durationMinutes: 3, mode: "text", confirmedClaims: [] }, { guestOwnerHash: "o" });
  await answerCurrent(f, "我負責搜尋功能。", 20);
  await answerCurrent(f, "我用測試資料檢查。", 40);
  assert.equal(f.calls.at(-1).context.task, "switch_topic");
  assert.equal(f.session.turns.at(-1).threadDepth, 0);
}

// School names never reach the Agent, and a question about the school is replaced.
{
  let leaked = false;
  const f = fixture({
    answer(role, context, n) {
      const serialized = JSON.stringify(context);
      if (/建國|北一女/u.test(serialized)) leaked = true;
      if (context.task === "opening") return { agentId: role, candidateQuestion: "你提到在［學校名稱］的資訊社，可以先介紹那段經驗嗎？", questionFocus: "personal_contribution", dialogueAction: "opening", sourceRefs: [], relevance: 1 };
      return { agentId: role, candidateQuestion: "你是哪間高中的？那裡的資訊課程如何？", questionFocus: "learning", dialogueAction: "switch_topic", sourceRefs: [], relevance: 1 };
    },
  });
  await f.orchestrator.createSession({ profileId: "p", panelIds: f.roster, durationMinutes: 5, mode: "text", confirmedClaims: [{ text: "我在建國中學資訊社負責網站專題。", evidenceQuote: "臺北市立建國高級中學資訊社", sourceFilename: "北一女_學習歷程.pdf", sourcePage: 1 }] }, { guestOwnerHash: "o" });
  assert.match(f.session.claims[0], /［學校名稱］/);
  assert.doesNotMatch(JSON.stringify(f.session.portfolioEvidence), /建國|北一女/u);
  assert.equal(f.session.turns[0].questionFocus, "introduction", "An opening that repeats the masked school falls back to a self-introduction");
  assert.equal(violatesAnonymity(f.session.turns[0].questionText), false);
  const result = await answerCurrent(f, "我在北一女參加程式營，也在建國中學資訊社做網站。", 40);
  assert.equal(result.schoolMentionRedacted, true);
  assert.ok(f.events.some((event) => event.type === "answer.received" && event.schoolMentionRedacted === true));
  const asked = f.session.turns.at(-1).questionText;
  assert.equal(violatesAnonymity(asked), false, "A question about the student's school is never asked");
  assert.match(f.calls.at(-1).context.retryReason || "", /匿名/);
  assert.equal(leaked, false, "Raw school names must not appear in any Agent context");
  assert.equal(f.session.turns[0].answerText.includes("北一女"), true, "The student's own transcript is kept unchanged");
  await f.orchestrator.finish(f.session.id, "manual");
  assert.ok(f.session.review.dataLimits.some((item) => item.startsWith("匿名保護")));
  assert.ok(f.calls.some((call) => call.role === "review"));
  assert.doesNotMatch(JSON.stringify(f.calls.map((call) => call.context)), /建國|北一女/u, "Review context is masked too");
}

// Prompts carry the anonymity and thread rules.
{
  const prompt = buildAgentPrompt({ role: roles.portfolio, task: "switch_topic", context: { practiceBudget: practiceBudget({ durationMinutes: 5 }) } });
  assert.match(prompt, /匿名規則/);
  assert.match(prompt, /currentThread/);
  const review = buildAgentPrompt({ task: "review", context: { turns: [] } });
  assert.match(review, /匿名規則/);
}

console.log("PASS: 3/5/8-minute budgets, per-thread follow-up cap and forced topic switch, school-name masking for claims/answers/review, and anonymity guard on generated questions");
