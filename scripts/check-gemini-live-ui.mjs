import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { InterviewTiming } from "../src/interview-timing.js";
import { buildPostureFeedback } from "../src/posture-feedback.js";
import { VoiceActivityDetector } from "../src/voice-activity.js";
import { LiveAudioLink, BARGE_IN_RMS, gateChunk } from "../src/live-audio.js";

// Browser side of the Gemini Live warm-up with a fake audio link; no microphone,
// Web Audio or Google service is used.
let now = 1000;
let timerId = 0;
const timers = new Map();
const posts = [];
const notices = [];
const links = [];
const recognitions = [];
const audios = [];
const textarea = { value: "", classList: { toggle() {}, remove() {} } };
const caption = { textContent: "" };
const element = { innerHTML: "", textContent: "", style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
  querySelector(selector) { return selector === '[data-form="answer"] textarea' ? textarea : selector === ".caption-bubble p" ? caption : null; } };
const toast = { ...element, set textContent(value) { if (value) notices.push(value); }, get textContent() { return notices.at(-1) || ""; } };
class TestDate extends Date { static now() { return now; } }
class FakeLink {
  constructor(options) { Object.assign(this, options); this.sent = []; this.playing = false; this.remaining = 0; links.push(this); }
  async start() {}
  send(message) { this.sent.push(message); return true; }
  get audioQueued() { return this.playing; }
  remainingPlaybackMs() { return this.remaining; }
  flush() { this.flushed = true; }
  close(options) { this.closedWith = options || {}; }
}
class TestRecognition { constructor() { recognitions.push(this); } start() {} stop() {} abort() {} }
class TestAudio { constructor(url) { audios.push(url); } addEventListener() {} async play() {} pause() {} }
class TestStream { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return this.tracks; } getVideoTracks() { return []; } getTracks() { return this.tracks; } }
const responses = {
  "/api/live/probe": { available: true, latencyMs: 1820 },
  "/api/sessions": { session: { sessionId: "s1", voiceEnabled: true, mode: "voice" }, event: null, live: { ticket: "tk", model: "gemini-3.8-live" }, agentMode: "mock", speech: { available: true, provider: "fake", processingLocation: "local", ttsLocation: "cloud" } },
};
const sandbox = vm.createContext({ console: { ...console, info() {} }, Blob, URL, Uint8Array, Uint32Array, Date: TestDate, MediaStream: TestStream, Audio: TestAudio, LiveAudioLink: FakeLink,
  InterviewTiming: class extends InterviewTiming { constructor() { super(() => now); } },
  createCameraAnalyzer: () => ({}), buildPostureFeedback, VoiceActivityDetector, percent: (value) => value * 100,
  document: { getElementById: (id) => id === "app" ? element : id === "toast" ? toast : null, querySelector: () => null, body: { classList: element.classList } },
  window: { AudioContext: class { createAnalyser() { return { fftSize: 512, getByteTimeDomainData(samples) { samples.fill(128); } }; } createMediaStreamSource() { return { connect() {} }; } async resume() {} async close() {} }, webkitSpeechRecognition: TestRecognition, addEventListener() {}, scrollTo() {}, localStorage: { getItem: () => null, setItem() {} } },
  location: { protocol: "http:", host: "127.0.0.1:4180" },
  EventSource: class { close() {} },
  navigator: {},
  setTimeout: (fn, ms = 0) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
  clearTimeout: (id) => timers.delete(id), setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  fetch: async (path, options) => {
    posts.push({ path, body: options?.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => responses[path] || { accepted: true } };
  },
});
let source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
source = source.replace(/^import .*;\r?\n/gm, "").replace(/render\(\);\r?\nasync function initializeApp/, "async function initializeApp").replace(/initializeApp\(\);\s*$/, "");
source += "\nrender = () => {}; globalThis.exercise = { state, timing: interviewTiming, acceptInterviewEvent, startInterview, submitAnswer, triggerFollowUp, preferenceScope, settingsPage, devicePage, interviewPage, maybeProbeLive, voiceLatencies, get liveLink() { return liveLink; } };";
vm.runInContext(source, sandbox);
const e = sandbox.exercise;
const settle = () => new Promise((resolve) => setImmediate(resolve));
function advance(ms) {
  const until = now + ms;
  for (;;) {
    const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    now = Math.max(now, due[1].at);
    due[1].fn();
  }
  now = until;
}
const track = { readyState: "live", enabled: true, kind: "audio", stop() {} };
Object.assign(e.state, {
  page: "device", panel: "warmup", people: ["portfolio"], config: { duration: 5, mode: "voice", captions: true },
  authReady: true, preferencesReady: true, agentMode: "mock", csrfToken: "t", audioReady: true, stream: new TestStream([track]), libraryReady: true,
  consentModel: true, consentAudio: true, liveVoiceConsent: true, confirmClaims: false,
  health: { liveVoice: { enabled: true, model: "gemini-3.8-live" } },
  speechStatus: { available: true, provider: "fake", processingLocation: "local", ttsLocation: "cloud" },
});

// 1. Consent: Live is part of the permission signature and the notice states free-tier data use.
assert.match(e.preferenceScope(), /"live":"gemini-3.8-live"/);
const settings = e.settingsPage();
assert.match(settings, /Gemini Live 即時對談/);
assert.match(settings, /免費層/);
assert.match(settings, /改進其產品/);

// 2. The device page probes Live once and says so; a failure shows the turn-based notice.
e.maybeProbeLive();
await settle(); await settle();
assert.equal(e.state.liveProbe.status, "ok");
assert.match(e.devicePage(), /已試連 Gemini Live/);
assert.match(e.devicePage(), /Gemini Live API/);
e.state.liveProbe = { status: "failed", at: now, reason: "quota", message: "即時對談額度已用完" };
assert.match(e.devicePage(), /即時對談無法使用，改用回合制/);
e.state.liveProbe = { status: "ok", at: now, latencyMs: 1820 };

// 3. Starting the warm-up asks for Live and connects the audio link instead of playing a TTS opening.
await e.startInterview();
const created = posts.find((post) => post.path === "/api/sessions").body;
assert.equal(created.liveVoice, true);
assert.equal(created.consent.liveVoice, true);
assert.equal(links.length, 1);
const link = links[0];
assert.equal(link.url, "ws://127.0.0.1:4180/api/sessions/s1/live?ticket=tk");
assert.equal(e.timing.phase, "preparing");
assert.equal(audios.length, 0);

// 4. A Live question is shown without TTS or Web Speech; listening starts when playback ends.
link.onMessage({ type: "ready" });
link.onMessage({ type: "turn", speaker: "professor" });
link.onMessage({ type: "output", text: "你好，可以先" });
assert.equal(caption.textContent, "你好，可以先", "Captions stream with the professor's words");
link.playing = true;
link.onPlaybackStart(now + 30);
assert.equal(e.timing.phase, "speaking");
e.acceptInterviewEvent({ type: "interview.event", live: true, seq: 2, turnId: "t1", phase: "question", speakerId: "portfolio", roleId: "portfolio", utterance: "你好，可以先簡單介紹自己嗎？" });
assert.equal(e.state.backendTurns.length, 1);
assert.equal(e.timing.phase, "speaking", "Still speaking until the queued audio has played");
link.onMessage({ type: "turn", speaker: "student" });
link.playing = false;
link.onPlaybackIdle();
assert.equal(e.timing.phase, "listening");
assert.equal(recognitions.length, 0, "Web Speech never runs during Live");
assert.equal(audios.length, 0, "No TTS audio during Live");

// 5. The student's speech is tracked locally and the response delay is reported.
for (let index = 0; index < 4; index++) link.onChunk(0.004, now += 100, false);
for (let index = 0; index < 8; index++) link.onChunk(0.2, now += 100, false);
assert.equal(e.timing.phase, "capturing");
const spokeUntil = now;
link.onMessage({ type: "input", text: "我是高三學生" });
assert.equal(textarea.value, "我是高三學生", "Live transcript appears in the answer box");
for (let index = 0; index < 18; index++) link.onChunk(0.003, now += 100, false);
assert.equal(e.timing.phase, "thinking", "After the student stops it is the professor's turn, not the student's");
link.onMessage({ type: "turn", speaker: "professor" });
link.playing = true;
link.onPlaybackStart(now + 900);
const latency = link.sent.find((message) => message.type === "latency");
assert.equal(latency.ms, now + 900 - spokeUntil, "Measured from the last loud chunk");
assert.equal(e.voiceLatencies.at(-1).liveResponseMs, latency.ms);

// 5b. A turn end that arrives right after playback drained (inside the echo
// tail) still hands the turn to the student.
link.playing = false;
e.acceptInterviewEvent({ type: "interview.event", live: true, seq: 3, turnId: "t1b", phase: "question", speakerId: "portfolio", roleId: "portfolio", utterance: "短問題？" });
assert.equal(e.timing.phase, "listening");

// 6. Silence asks Live to rephrase over the socket, not through the turn-based nudge API.
e.acceptInterviewEvent({ type: "interview.event", live: true, seq: 4, turnId: "t2", phase: "question", speakerId: "portfolio", roleId: "portfolio", utterance: "最早怎麼開始寫程式？" });
link.onMessage({ type: "turn", speaker: "student" });
link.playing = false;
link.onPlaybackIdle();
now += 8100;
e.triggerFollowUp();
assert.ok(link.sent.some((message) => message.type === "nudge"));
assert.ok(!posts.some((post) => post.path.endsWith("/nudge")));
assert.equal(e.timing.phase, "nudge");

// 7. A typed answer goes into the Live conversation.
link.onMessage({ type: "turn", speaker: "professor" });
link.onMessage({ type: "turn", speaker: "student" });
link.onPlaybackIdle();
e.state.draft = "國中用 Scratch 做遊戲";
assert.equal(await e.submitAnswer(), true);
assert.ok(link.sent.some((message) => message.type === "text" && message.text === "國中用 Scratch 做遊戲"));
assert.ok(!posts.some((post) => post.path.endsWith("/answers")));
assert.equal(e.state.draft, "");

// 8. Fallback mid-answer: the words so far stay as a draft and the spoken question is not replayed.
link.onMessage({ type: "fallback", reason: "quota", message: "即時對談額度已用完，改用回合制繼續。", draftText: "我負責資料庫" });
assert.equal(e.liveLink, null);
assert.ok(link.closedWith);
assert.equal(e.state.draft, "我負責資料庫");
assert.ok(notices.includes("即時對談額度已用完，改用回合制繼續。"));
assert.match(e.interviewPage(), /已改用回合制/);
e.acceptInterviewEvent({ type: "interview.event", seq: 6, turnId: "t2", phase: "question", speakerId: "portfolio", roleId: "portfolio", utterance: "最早怎麼開始寫程式？", alreadySpoken: true, liveFallback: { reason: "quota", draftText: "我負責資料庫" } });
assert.equal(e.timing.phase, "listening");
assert.equal(audios.length, 0);
assert.equal(recognitions.length, 0, "With a draft, recognition waits for the student");
advance(25000);
assert.equal(audios.length, 0, "No speech-not-ready timer for an already spoken question");

// 9. A fallback without a draft resumes turn-based voice capture right away.
e.state.draft = "";
e.acceptInterviewEvent({ type: "interview.event", seq: 7, turnId: "t3", phase: "question", speakerId: "portfolio", roleId: "portfolio", utterance: "你怎麼確認結果正確？", alreadySpoken: true, liveFallback: { reason: "disconnected", draftText: "" } });
assert.equal(recognitions.length, 1, "Turn-based Web Speech takes over");

// 10. The Live farewell finishes playing before the review starts.

Object.assign(e.state, { closing: false, finishing: false, sessionId: "s1", page: "interview" });
await e.startInterview();
const farewellLink = links.at(-1);
farewellLink.remaining = 2500;
e.acceptInterviewEvent({ type: "interview.closing", live: true, seq: 20, reason: "completed", speakerId: "portfolio", utterance: "謝謝你的分享，今天就到這裡。" });
assert.equal(farewellLink.closedWith.drain, true, "The farewell audio is drained, not cut");
assert.equal(e.state.closing, true);
const finishPosts = () => posts.filter((post) => post.path.endsWith("/finish")).length;
advance(2000);
assert.equal(finishPosts(), 0, "The review waits for the farewell audio");
advance(2000);
await settle();
assert.equal(finishPosts(), 1);


// 11. Echo gating: quiet input during playback (speaker echo) is held back, a
// clearly louder voice barges in and keeps sending until playback ends.
assert.deepEqual(gateChunk({ playing: false, bargeIn: false, rms: 0.001 }), { send: true, bargeIn: false });
assert.deepEqual(gateChunk({ playing: true, bargeIn: false, rms: BARGE_IN_RMS / 2 }), { send: false, bargeIn: false });
assert.deepEqual(gateChunk({ playing: true, bargeIn: false, rms: BARGE_IN_RMS }), { send: true, bargeIn: true });
assert.deepEqual(gateChunk({ playing: true, bargeIn: true, rms: 0.001 }), { send: true, bargeIn: true });
assert.deepEqual(gateChunk({ playing: false, bargeIn: true, rms: 0.001 }), { send: true, bargeIn: false });
const idle = new LiveAudioLink({ url: "", now: () => now });
assert.equal(idle.playing, false);
assert.equal(idle.remainingPlaybackMs(), 0);
console.log("Gemini Live UI checks passed");
