import assert from "node:assert/strict";
import { InterviewOrchestrator } from "../server/interview-orchestrator.js";
import { PanelCoordinator } from "../server/panel-coordinator.js";
import { practiceBudget } from "../server/interview-guide.js";
import { buildAgentPrompt } from "../server/agent-provider.js";
import { roles } from "../server/agent-service.js";

function fixture() {
  const session = { id: "test", status: "active", phase: "question", durationMinutes: 5, elapsedSeconds: 0, roster: ["portfolio", "technical", "logic"], seed: 1, claims: [], portfolioEvidence: [], sources: [], assessments: [], profileSnapshot: {}, audioBySequence: new Map(), nudgeUsedForTurn: new Set(), eventSequence: 1, consentSnapshot: {},
    currentEvent: { seq: 1, turnId: "t1", speakerId: "portfolio", utterance: "你的學習從哪裡開始？" },
    turns: [{ turnId: "t1", speakerId: "portfolio", roleId: "portfolio", questionText: "你的學習從哪裡開始？", questionFocus: "learning", answerText: "", followUps: [] }] };
  const events = [], calls = [];
  let deferred = null;
  const store = { get: () => session, save() {}, emit(id, event) { const next = { ...event, seq: ++session.eventSequence }; events.push(next); return next; } };
  const agentService = { mode: "mock", release() {}, async assess(role, context) { calls.push(context); if(deferred) return deferred; return { agentId: role, candidateQuestion: context.task === "final_question" ? "最後一個問題，進大學後你最想先學什麼？" : "你如何確認程式的結果是正確的？", questionFocus: context.task === "final_question" ? "future_plan" : "verification", dialogueAction: "switch_topic", sourceRefs: [], relevance: 1 }; } };
  const speechAdapter = { status: () => ({ available: true }), async synthesize() { return { buffer: Buffer.from("synthetic audio"), mimeType: "audio/wav" }; }, async transcribe() { return "這是最後一段合成語音回答"; } };
  const orchestrator = new InterviewOrchestrator({ store, agentService, coordinator: new PanelCoordinator(), speechAdapter, config: { maxAnswerLength: 8000 } });
  return { session, events, calls, orchestrator, defer(promise) { deferred = promise; } };
}
{
  const f = fixture();
  assert.equal(practiceBudget(f.session).closingWindowSeconds, 45);
  f.orchestrator.progress("test", { elapsedSeconds: 260 });
  f.orchestrator.progress("test", { elapsedSeconds: 30 });
  assert.equal(f.session.elapsedSeconds, 260, "Delayed progress cannot turn the clock back");
  await f.orchestrator.submitAnswer("test", { turnId: "t1", text: "我從高中自主學習開始學習 Python。", elapsedSeconds: 260 });
  await f.session.processingPromise;
  assert.equal(f.calls[0].task, "final_question");
  assert.equal(f.calls[0].practiceBudget.remainingSeconds, 40);
  assert.equal(f.session.turns[1].finalQuestion, true);
  const lastTurn = f.session.turns[1];
  await f.orchestrator.submitAnswer("test", { turnId: lastTurn.turnId, text: "我想先學習資料結構。", elapsedSeconds: 270 });
  await f.session.processingPromise;
  assert.equal(f.calls.length, 1, "Answering the final question must not trigger another question model call");
  assert.equal(f.session.status, "closing");
  assert.equal(f.session.turns.length, 2, "Courtesy is not a question or an unanswered review turn");
  assert.match(f.session.currentEvent.utterance, /謝謝/);
}
{
  const f = fixture();
  let resolve;
  f.defer(new Promise(r=>{resolve=r;}));
  await f.orchestrator.submitAnswer("test", { turnId: "t1", text: "我用 Python 解決了搜尋問題。" });
  const pending=f.session.processingPromise;
  f.orchestrator.prepareEnding("test", { reason: "time", elapsedSeconds: 300 });
  await f.orchestrator.close("test", { reason: "time" });
  resolve({ agentId: "technical", candidateQuestion: "你的演算法有哪些取捨？", questionFocus: "tradeoff", sourceRefs: [], relevance: 1 });
  await pending;
  assert.equal(f.session.turns.length, 1, "A delayed Agent response after the deadline must be discarded");
  assert.equal(f.events.filter(e=>e.type === "interview.event").length, 0);
  assert.equal(f.events.filter(e=>e.type === "interview.closing").length, 1);
  await f.orchestrator.close("test");
  assert.equal(f.events.filter(e=>e.type === "interview.closing").length, 1, "Close is idempotent");
}
{
  const f = fixture(); f.session.voiceEnabled=true;
  f.orchestrator.prepareEnding("test", { reason: "manual" });
  await f.orchestrator.transcribeAnswer("test", Buffer.from("synthetic"), "audio/webm", { turnId: "t1", eventSeq: 1, elapsedSeconds: 290 });
  assert.match(f.session.turns[0].answerText, /最後一段/);
  assert.equal(f.calls.length, 0, "The flushed final recording is saved without asking again");
  await f.orchestrator.close("test", { reason: "manual" });
  await new Promise(r=>setImmediate(r));
  assert.ok(f.events.some(e=>e.type === "interview.audio.ready" && e.eventSeq === f.session.currentEvent.seq));
  assert.equal(f.session.audioBySequence.size, 1);
}
{
  const f = fixture();
  const result=await f.orchestrator.nudge("test", { turnId: "t1", eventSeq: 1, elapsedSeconds: 285 });
  assert.equal(result.event.type, "interview.closing"); assert.equal(f.calls.length,0);
  const prompt=buildAgentPrompt({role:roles.portfolio,task:"final_question",context:{practiceBudget:practiceBudget(f.session)}});
  assert.match(prompt,/30秒/); assert.match(prompt,/提問目的是設計推論/);
}
console.log("PASS: monotonic practice clock, final-question budget, final-answer closure, late Agent cancellation, final audio preservation, closing speech, and prompt guidance");
