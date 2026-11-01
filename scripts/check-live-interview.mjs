import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { SpeechAdapter } from "../server/speech-adapter.js";

const base = process.env.VIVAPREP_CHECK_URL || "http://127.0.0.1:4173";
const authResponse = await fetch(base + "/api/auth/session");
const auth = await authResponse.json();
const cookie = authResponse.headers.getSetCookie()[0].split(";", 1)[0];
const headers = { "content-type": "application/json", "x-csrf-token": auth.csrfToken, cookie };
async function call(path, body, extraHeaders) {
  const response = await fetch(base + path, { method: body == null ? "GET" : "POST", headers: { ...headers, ...extraHeaders }, body: body == null ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
const log = [];
function note(step, data) { log.push({ step, ...data }); console.log(JSON.stringify({ step, ...data })); }
let sessionId;
try {
  const initial = await call("/api/sessions", { profileId: "fcu-general", panelIds: ["portfolio", "technical", "logic"], durationMinutes: 5, mode: "voice", captionsEnabled: true, seed: 20260928, confirmedClaims: [{ text: "合成測試：我在校園借閱系統專題負責搜尋功能，曾使用測試資料核對搜尋結果。" }], retentionMode: "ephemeral", consent: { modelProcessing: true, audioProcessing: true, saveHistory: false } });
  sessionId = initial.session.sessionId;
  assert.equal(initial.agentMode, "cli");
  assert.equal(initial.session.voiceEnabled, true);
  note("opening", { question: initial.event.utterance, action: initial.event.dialogueAction });
  const speech = new SpeechAdapter({ mode: "windows-sapi", maxAudioBytes: 8 * 1024 * 1024 });
  const synthetic = await speech.synthesize("我負責搜尋功能，用關鍵字找出書籍。我先建立測試資料，確認每次搜尋能找到正確的書，並修正錯誤紀錄。");
  const webm = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg.exe", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-f", "webm", "pipe:1"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("WebM conversion failed")));
    child.stdin.end(synthetic.buffer);
  });
  const voice = await call(`/api/sessions/${sessionId}/audio-answers`, webm, { "content-type": "audio/webm;codecs=opus", "x-vivaprep-turn": initial.event.turnId, "x-vivaprep-event-seq": String(initial.event.seq) });
  assert.ok(voice.accepted && voice.transcript.length > 10);
  note("webm_voice_answer", { transcript: voice.transcript, accepted: voice.accepted });
  async function waitForNewQuestion(oldTurnId) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const snapshot = await call(`/api/sessions/${sessionId}`);
      if (snapshot.currentEvent?.turnId !== oldTurnId) return snapshot;
      if (snapshot.events?.some((event) => event.type === "error")) throw new Error("Agent error during live check");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Follow-up timed out");
  }
  const next = await waitForNewQuestion(initial.event.turnId);
  assert.notEqual(next.currentEvent.utterance, initial.event.utterance);
  note("answer_based_follow_up", { question: next.currentEvent.utterance, action: next.currentEvent.dialogueAction });
  await call(`/api/sessions/${sessionId}/answers`, { turnId: next.currentEvent.turnId, text: "這題我不太確定，可以換個話題嗎？" });
  const switched = await waitForNewQuestion(next.currentEvent.turnId);
  assert.equal(switched.currentEvent.dialogueAction, "switch_topic");
  note("explicit_topic_switch", { question: switched.currentEvent.utterance });
  const rephrase = await call(`/api/sessions/${sessionId}/nudge`, { turnId: switched.currentEvent.turnId, eventSeq: switched.currentEvent.seq });
  assert.equal(rephrase.event.dialogueAction, "rephrase");
  assert.equal(rephrase.event.turnId, switched.currentEvent.turnId);
  note("idle_rephrase", { question: rephrase.event.utterance });
  const moved = await call(`/api/sessions/${sessionId}/nudge`, { turnId: rephrase.event.turnId, eventSeq: rephrase.event.seq });
  assert.equal(moved.event.dialogueAction, "switch_topic");
  assert.notEqual(moved.event.turnId, rephrase.event.turnId);
  note("idle_topic_switch", { question: moved.event.utterance });
  const completed = await call(`/api/sessions/${sessionId}/finish`, { reason: "synthetic_check" });
  assert.ok(completed.review?.summary);
  note("review", { complete: true, summary: completed.review.summary });
} finally {
  if (sessionId) {
    const cleanup = await fetch(`${base}/api/sessions/${sessionId}`, { method: "DELETE", headers });
    note("cleanup", { deleted: cleanup.status === 204 });
  }
  await writeFile(new URL("../.data/live-dialogue-check.json", import.meta.url), JSON.stringify(log, null, 2));
}
