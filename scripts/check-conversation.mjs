import assert from "node:assert/strict";
import { InterviewTiming } from "../src/interview-timing.js";
import { PanelCoordinator, isRepeatedQuestion } from "../server/panel-coordinator.js";
import { InterviewOrchestrator } from "../server/interview-orchestrator.js";

let now = 0;
const timing = new InterviewTiming(() => now);
timing.question({ seq: 1, phase: "question" }, true);
now = 35000;
assert.equal(timing.remainingMs(), null, "Preparing speech must not consume response time");
timing.speaking(1);
now = 70000;
assert.equal(timing.remainingMs(), null, "Long playback must never trigger a silence prompt");
timing.listen(1);
assert.equal(timing.remainingMs(), 8000);
now += 7999;
assert.equal(timing.remainingMs(), 1);
now++;
assert.equal(timing.remainingMs(), 0);
timing.question({ seq: 2, phase: "follow_up" }, true);
assert.equal(timing.listen(1), false, "A late ended event cannot unlock the new question");
assert.equal(timing.remainingMs(), null);
timing.listen(2);
assert.equal(timing.remainingMs(), 12000);
assert.equal(timing.remainingMs({ draft: "我想先說明" }), null);
assert.equal(timing.remainingMs({ unavailable: true }), null);
timing.pause("transcribing");
now += 90000;
assert.equal(timing.remainingMs(), null, "Recognition time is never candidate silence");
assert.equal(timing.countsTowardPractice(), false, "STT wait must not consume the practice duration");
for (const phase of ["preparing","thinking","nudge","playback_blocked"]) {
  timing.pause(phase); assert.equal(timing.countsTowardPractice(),false);
}
for (const phase of ["speaking","listening","capturing"]) {
  timing.pause(phase); assert.equal(timing.countsTowardPractice(),true);
}

const coordinator = new PanelCoordinator();
const old = [{ questionText: "這個專題裡，你自己負責的工作是什麼？", questionFocus: "personal_contribution", roleId: "portfolio" }];
const repeated = { agentId: "portfolio", candidateQuestion: "你個人親自實作了哪些模組？", questionFocus: "personal_contribution", relevance: 1 };
assert.equal(isRepeatedQuestion(repeated, old), true, "Different wording of the same focus is a repeat");
assert.equal(coordinator.select([repeated], ["portfolio"], old, 1), null);
const fresh = { agentId: "technical", candidateQuestion: "你怎麼驗證搜尋結果是正確的？", questionFocus: "verification", relevance: 0.5 };
assert.equal(coordinator.select([repeated, fresh], ["portfolio", "technical"], old, 1).roleId, "technical");

function fixture() {
  const session = { id: "test", status: "active", phase: "question", voiceEnabled: false, roster: ["portfolio", "technical"], seed: 1, claims: [], portfolioEvidence: [], sources: [], assessments: [], profileSnapshot: {}, audioBySequence: new Map(), nudgeUsedForTurn: new Set(), processingPromise: null,
    currentEvent: { seq: 1, turnId: "t1", speakerId: "portfolio", utterance: old[0].questionText },
    turns: [{ turnId: "t1", speakerId: "portfolio", roleId: "portfolio", questionText: old[0].questionText, questionFocus: "personal_contribution", answerText: "", followUps: [] }] };
  const events = [];
  let seq = 1;
  const store = { get: () => session, save() {}, emit(id, event) { const next = { ...event, seq: ++seq }; events.push(next); return next; } };
  const deferred = {};
  const agentService = { mode: "mock", assess: () => new Promise((resolve) => { deferred.resolve = resolve; }) };
  const speechAdapter = { transcribe: () => new Promise((resolve) => { deferred.transcribe = resolve; }) };
  const orchestrator = new InterviewOrchestrator({ store, agentService, coordinator, speechAdapter, config: { maxAnswerLength: 8000 } });
  return { session, events, deferred, orchestrator };
}
{
  const { session, deferred, events, orchestrator } = fixture();
  const pending = orchestrator.nudge("test", { turnId: "t1", eventSeq: 1 });
  orchestrator.candidateActivity("test", { turnId: "t1", eventSeq: 1 });
  deferred.resolve({ ...fresh, candidateQuestion: "還是我換個方式問：你自己做的第一個步驟是什麼？", sourceRefs: [] });
  assert.equal((await pending).skipped, true, "Speech that resumes cancels a delayed prompt");
  assert.equal(events.length, 0);
  assert.equal(session.nudgeUsedForTurn.size, 0);
}
{
  const { session, deferred, orchestrator } = fixture();
  session.voiceEnabled = true;
  await assert.rejects(orchestrator.transcribeAnswer("test", Buffer.from("test"), "audio/webm", { turnId: "old" }), { code: "STALE_TURN" });
  const pending = orchestrator.transcribeAnswer("test", Buffer.from("test"), "audio/webm", { turnId: "t1", eventSeq: 1 });
  assert.equal((await orchestrator.nudge("test", { turnId: "t1", eventSeq: 1 })).skipped, true);
  await assert.rejects(orchestrator.transcribeAnswer("test", Buffer.from("test"), "audio/webm"), { code: "TRANSCRIPTION_IN_PROGRESS" });
  session.currentEvent = { seq: 2, turnId: "t2" };
  deferred.transcribe("合成的回答");
  await assert.rejects(pending, { code: "STALE_TURN" });
  assert.equal(session.turns[0].answerText, "");
  assert.equal(session.transcribingTurnId, null);
}
console.log("PASS: playback timing, semantic repeats, resumed-speech races, and stale/concurrent transcription");
