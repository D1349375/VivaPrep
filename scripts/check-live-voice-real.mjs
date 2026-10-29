// Manual check against the real Gemini Live API (needs GEMINI_LIVE_API_KEY or
// GEMINI_API_KEY in .env; not part of the offline checks). A WAV file of
// spoken answers (16-bit mono, pauses between answers) plays the student.
//   node scripts/check-live-voice-real.mjs answers.wav
// Prints the delay from the end of each answer to the professor's first audio
// chunk at the backend relay, the transcripts written to session.turns, a
// simulated connection drop with session resumption, and the Live farewell.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { config } from "../server/config.js";
import { AgentService } from "../server/agent-service.js";
import { MockAgentProvider } from "../server/agent-provider.js";
import { InterviewOrchestrator } from "../server/interview-orchestrator.js";
import { PanelCoordinator } from "../server/panel-coordinator.js";
import { LiveVoiceService } from "../server/live-voice.js";
import { LiveError } from "../server/gemini-live.js";
import { createUpgradeHandler } from "../server/http-api.js";

const wavPath = process.argv[2];
if (!wavPath) throw new Error("Usage: node scripts/check-live-voice-real.mjs answers.wav");
if (!config.liveVoiceApiKey) throw new Error("No Gemini key configured for Live.");

function readAnswers(path) {
  const buffer = readFileSync(path);
  let offset = 12, rate = 0, channels = 1, samples = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") { channels = buffer.readUInt16LE(offset + 10); rate = buffer.readUInt32LE(offset + 12); }
    if (id === "data") { samples = new Int16Array(buffer.buffer.slice(buffer.byteOffset + offset + 8, buffer.byteOffset + offset + 8 + size)); break; }
    offset += 8 + size + (size % 2);
  }
  const mono = new Float32Array(samples.length / channels);
  for (let index = 0; index < mono.length; index++) mono[index] = samples[index * channels] / 32768;
  const out = new Int16Array(Math.floor(mono.length * 16000 / rate));
  for (let index = 0; index < out.length; index++) out[index] = Math.max(-1, Math.min(1, mono[Math.floor(index * rate / 16000)])) * 32767;
  // Split on pauses longer than 1.2 s.
  const segments = [];
  let start = -1, lastLoud = -1;
  for (let index = 0; index < out.length; index += 1600) {
    let energy = 0;
    for (let j = index; j < Math.min(out.length, index + 1600); j++) energy += (out[j] / 32768) ** 2;
    const loud = Math.sqrt(energy / 1600) > 0.01;
    if (loud) { if (start < 0) start = index; lastLoud = index + 1600; }
    else if (start >= 0 && index - lastLoud > 19200) { segments.push(out.slice(start, lastLoud)); start = -1; }
  }
  if (start >= 0) segments.push(out.slice(start, lastLoud));
  return segments;
}

const answers = readAnswers(wavPath);
console.log("answers", answers.map((pcm) => (pcm.length / 16000).toFixed(1) + " s").join(", "));
const sessions = new Map();
const events = [];
const store = {
  create(session) { sessions.set(session.id, session); }, get: (id) => sessions.get(id) || null, list: () => [...sessions.values()], save() {}, delete(id) { return sessions.delete(id); },
  emit(id, event) { const session = sessions.get(id); if (!session) return; const next = { ...event, sessionId: id, seq: ++session.eventSequence }; session.events.push(next); events.push(next); return next; },
};
const liveVoice = new LiveVoiceService({ mode: config.liveVoiceMode, apiKey: config.liveVoiceApiKey, model: config.liveVoiceModel, voice: config.ttsSpeakerVoices.portfolio || config.ttsVoice });
const orchestrator = new InterviewOrchestrator({
  store, agentService: new AgentService(new MockAgentProvider()), coordinator: new PanelCoordinator(), liveVoice,
  speechAdapter: { status: () => ({ available: true, provider: "test" }), async synthesize() { return { buffer: Buffer.alloc(0), mimeType: "audio/wav" }; } },
  reportRepository: { approvedSources: async () => [] },
  getProfile: () => ({ id: "fcu-general", version: 1, school: "逢甲大學", department: "資訊工程學系", academicYear: 115, admissionRoute: "個人申請", officialFacts: [], unknowns: [], profileStatus: "official", sources: [] }),
  config,
});
const server = createServer((request, response) => response.writeHead(404).end());
server.on("upgrade", createUpgradeHandler({ authService: { resolveContext: () => ({ isGuest: true, guestOwnerHash: "g" }), ownsInterviewSession: () => true }, store, orchestrator }));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const probe = await liveVoice.probe();
console.log("probe", JSON.stringify(probe));
assert.equal(probe.available, true);
const created = await orchestrator.createSession({ profileId: "fcu-general", panelIds: ["portfolio"], durationMinutes: 3, mode: "voice", liveVoice: true, confirmedClaims: [{ text: "我在校園借閱系統專題中負責資料處理與搜尋功能。" }], consent: { modelProcessing: true, audioProcessing: true, liveVoice: true } }, { guestOwnerHash: "g" });
const session = sessions.get(created.session.sessionId);
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${session.id}/live?ticket=${created.live.ticket}`, { headers: { origin: `http://127.0.0.1:${port}` } });
ws.binaryType = "arraybuffer";
const started = Date.now();
const at = () => ((Date.now() - started) / 1000).toFixed(2).padStart(6);
let audioBytes = 0, firstAudioAt = 0, professorTurn = false, studentTurnAt = 0;
const messages = [];
ws.onmessage = (event) => {
  if (typeof event.data !== "string") { audioBytes += event.data.byteLength; if (!firstAudioAt) firstAudioAt = Date.now(); return; }
  const message = JSON.parse(event.data);
  messages.push(message);
  if (message.type === "turn") { professorTurn = message.speaker === "professor"; if (!professorTurn) studentTurnAt = Date.now(); }
  if (!["output", "input"].includes(message.type)) console.log(at(), "browser <-", JSON.stringify(message));
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function professorSpeaks(label) {

  const waitFrom = Date.now();
  while (!(studentTurnAt > waitFrom)) { if (Date.now() - waitFrom > 30000) throw new Error("No professor turn: " + label); await sleep(20); }
  // Hold the microphone while the professor's audio would still be playing (24 kHz, 16-bit).
  const playbackMs = audioBytes / 48;
  const remaining = firstAudioAt + playbackMs - Date.now();
  console.log(at(), `${label}: "${session.currentEvent?.utterance}" (${(playbackMs / 1000).toFixed(1)} s audio)`);
  if (remaining > 0) await sleep(remaining + 300);
}
async function speak(pcm) {
  const chunk = 1600;
  const t0 = Date.now();
  for (let offset = 0, n = 0; offset < pcm.length; offset += chunk, n++) {
    ws.send(Buffer.from(pcm.buffer, pcm.byteOffset + offset * 2, Math.min(chunk, pcm.length - offset) * 2));
    const due = t0 + (n + 1) * 100 - Date.now();
    if (due > 0) await sleep(due);
  }
  const endedAt = Date.now();
  firstAudioAt = 0; audioBytes = 0;
  // Room silence after the answer, as a microphone would keep sending.
  const silence = Buffer.alloc(3200);
  while (!firstAudioAt && Date.now() - endedAt < 15000) { ws.send(silence); await sleep(100); }
  return firstAudioAt ? firstAudioAt - endedAt : null;
}
const latencies = [];
await professorSpeaks("Q1");
latencies.push(await speak(answers[0]));
await professorSpeaks("Q2");
// Simulated drop of the Live connection: the backend resumes with its handle.
const runtime = liveVoice.active(session.id);
runtime.connection.onclose(new LiveError("unavailable", "simulated drop"));
const resumeStart = Date.now();
while (!messages.some((message) => message.type === "resumed" || message.type === "fallback")) { if (Date.now() - resumeStart > 10000) break; await sleep(20); }
const resumed = messages.some((message) => message.type === "resumed");
console.log(at(), "resume took", Date.now() - resumeStart, "ms", resumed ? "(resumed)" : "(fell back)");
if (!resumed) { console.log("turns", JSON.stringify(session.turns.map((turn) => [turn.questionText, turn.answerText]))); process.exit(1); }
// Near the end of a 3-minute practice: the final-question cue.
ws.send(JSON.stringify({ type: "progress", elapsedSeconds: 142 }));
latencies.push(await speak(answers[1 % answers.length]));
await professorSpeaks("Q3");
latencies.push(await speak(answers[0]));
const closeWait = Date.now();
while (!events.some((event) => event.type === "interview.closing") && Date.now() - closeWait < 20000) await sleep(50);
console.log("\nlatency (answer end -> first professor audio at relay), ms:", JSON.stringify(latencies));
console.log("timings", JSON.stringify(session.timings));
const traditional = session.turns.filter((turn) => turn.answerText).every((turn) => !/[负责这们说书过实际]/u.test(turn.answerText));
console.log("answers in Traditional Chinese:", traditional);
console.log("turns");
for (const turn of session.turns) console.log(" Q:", turn.questionText, turn.finalQuestion ? "[final]" : "", turn.followUps.length ? "follow-ups: " + turn.followUps.join(" / ") : "", "\n A:", turn.answerText, turn.answerFromSpeech ? "[speech]" : "");
const closing = events.find((event) => event.type === "interview.closing");
console.log("closing", closing ? JSON.stringify({ live: closing.live, utterance: closing.utterance }) : "none", "live", JSON.stringify(session.live));
liveVoice.close();
ws.close();
server.close();
process.exit(0);
