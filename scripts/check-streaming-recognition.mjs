import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { InterviewTiming } from "../src/interview-timing.js";
import { buildPostureFeedback } from "../src/posture-feedback.js";
import { VoiceActivityDetector } from "../src/voice-activity.js";

// Browser streaming recognition with a fake Web Speech API; no microphone or Google service is used.
let now = 1000;
let level = 0;
let nextFrame;
let timerId = 0;
const timers = new Map();
const posts = [];
const recordings = [];
const recognitions = [];
const audios = [];
const notices = [];
const listeners = new Map();
let audioAnswerFailures = 0;
const textarea = { value: "", classList: { toggle(name, on) { this.live = on; }, remove() { this.live = false; } } };
const element = { innerHTML: "", textContent: "", style: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener(name, fn) { listeners.set(name, fn); },
  querySelector(selector) { return selector === '[data-form="answer"] textarea' ? textarea : null; } };
const toast = { ...element, set textContent(value) { if (value) notices.push(value); }, get textContent() { return notices.at(-1) || ""; } };
class TestDate extends Date { static now() { return now; } }
class TestAudio {
  constructor(url) { this.src = url; this.listeners = new Map(); audios.push(this); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  async play() { this.listeners.get("play")?.(); }
  pause() {}
  end() { this.listeners.get("ended")?.(); }
}
class TestRecorder {
  static isTypeSupported(type) { return type.startsWith("audio/webm"); }
  constructor(stream, options) { this.mimeType = options.mimeType; this.state = "inactive"; recordings.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(["synthetic recording"], { type: this.mimeType }) }); this.onstop?.(); });
  }
}
class TestRecognition {
  constructor() { this.starts = []; this.stopped = false; this.aborted = false; recognitions.push(this); }
  start(track) { this.starts.push(track); }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
  // results: [[text, isFinal], ...] — the whole list for this recognition session, as Chrome reports it.
  emit(results) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex: 0, results: list });
  }
  fail(error) { this.onerror?.({ error }); this.onend?.(); }
}
class TestStream {
  constructor(tracks) { this.tracks = tracks; }
  getAudioTracks() { return this.tracks; }
  getVideoTracks() { return []; }
  getTracks() { return this.tracks; }
}
class TestAudioContext {
  createAnalyser() { return { fftSize: 512, getByteTimeDomainData(samples) { samples.fill(128 + Math.round(level * 128)); } }; }
  createMediaStreamSource() { return { connect() {} }; }
  async resume() {}
  async close() {}
}
const savedPreferences = new Map();
const sandbox = vm.createContext({ console: { ...console, info() {} }, Blob, Buffer, URL, Uint8Array, Uint32Array, Date: TestDate, MediaRecorder: TestRecorder, MediaStream: TestStream, Audio: TestAudio,
  InterviewTiming: class extends InterviewTiming { constructor() { super(() => now); } },
  createCameraAnalyzer: () => ({}), buildPostureFeedback, VoiceActivityDetector, percent: (value) => value * 100,
  document: { getElementById: (id) => id === "app" ? element : id === "toast" ? toast : null, querySelector: () => null, body: { classList: element.classList } },
  window: { AudioContext: TestAudioContext, MediaRecorder: TestRecorder, webkitSpeechRecognition: TestRecognition, addEventListener() {}, scrollTo() {},
    localStorage: { getItem: (key) => savedPreferences.get(key) || null, setItem: (key, value) => savedPreferences.set(key, value) } },
  navigator: {},
  setTimeout: (fn, ms = 0) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
  clearTimeout: (id) => timers.delete(id), setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: (fn) => { nextFrame = fn; return 1; }, cancelAnimationFrame() {},
  fetch: async (path, options) => {
    posts.push({ path, options, at: now });
    if (path.endsWith("audio-answers") && audioAnswerFailures-- > 0) return { ok: false, status: 422, json: async () => ({ error: { code: "TRANSCRIPTION_FAILED", message: "辨識失敗" } }) };
    return { ok: true, status: 202, json: async () => path.endsWith("audio-answers") ? { transcript: "後端辨識的回答", accepted: true } : { accepted: true } };
  },
});
let source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
source = source.replace(/^import .*;\r?\n/gm, "").replace(/render\(\);\r?\nasync function initializeApp/, "async function initializeApp").replace(/initializeApp\(\);\s*$/, "");
source += "\nrender = () => {}; globalThis.exercise = { state, timing: interviewTiming, acceptInterviewEvent, discardRecording, preferenceScope, loadPreferences, settingsPage, devicePage, voiceLatencies };";
vm.runInContext(source, sandbox);
const e = sandbox.exercise;

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
function sample(rms, delta = 100) { level = rms; advance(delta); nextFrame(); }
const settle = () => new Promise((resolve) => setImmediate(resolve));
const answerPosts = () => posts.filter((post) => post.path.endsWith("/answers"));
const track = { readyState: "live", enabled: true, kind: "audio" };
Object.assign(e.state, { page: "interview", sessionId: "test", voiceEnabled: true, authReady: true, csrfToken: "test", audioReady: true, speechStatus: { available: true, provider: "whisper-local", processingLocation: "local", ttsLocation: "cloud" }, stream: new TestStream([track]) });
const question = { type: "interview.event", seq: 1, turnId: "t1", phase: "question", speakerId: "portfolio", utterance: "你負責了什麼？", audioUrl: "/audio/1" };

// 1. Recognition starts only after the professor's audio ends.
e.acceptInterviewEvent(question);
assert.equal(recognitions.length, 0, "Professor speech must never be recognized as an answer");
audios[0].end();
assert.equal(recognitions.length, 1, "Streaming recognition starts at playback end");
assert.equal(recordings.length, 0, "Streaming must not also upload a recording");
const first = recognitions[0];
assert.deepEqual([first.lang, first.continuous, first.interimResults], ["zh-TW", true, true]);
assert.equal(first.starts[0], track, "The selected microphone track is offered to recognition");

// 2. Interim words show in the answer box without becoming a typed draft.
first.emit([["我負責資料", false]]);
assert.equal(textarea.value, "我負責資料");
assert.equal(textarea.classList.live, true, "Live words are styled apart from typed text");
assert.equal(e.state.draft, "");
assert.equal(e.timing.phase, "capturing");
assert.equal(e.timing.remainingMs(), null, "Silence countdown pauses while the student is answering");

// 3. Breaths, soft passages and answers past 60 s are not cut off while words keep arriving.
for (let n = 0; n < 5; n++) sample(0.03);
first.emit([["我負責資料處理", true]]);
for (let n = 0; n < 11; n++) sample(0.002);
assert.equal(answerPosts().length, 0, "Chrome finalizing a phrase at a breath is not the end of the answer");
let spoken = "我負責資料處理";
for (let second = 0; second < 66; second++) {
  const soft = second % 10 >= 7; // three seconds in ten stay under the VAD continue threshold
  for (let n = 0; n < 10; n++) sample(soft ? 0.004 : n % 3 === 2 ? 0.006 : 0.04); // speech has gaps between syllables
  spoken += "然後";
  first.emit([["我負責資料處理", true], [spoken.slice(7), false]]);
}
assert.equal(answerPosts().length, 0, "Soft speech and a 66 s answer keep going while words arrive");
// Chrome sometimes holds words back for seconds while the student keeps talking.
for (let n = 0; n < 35; n++) sample(n % 3 === 2 ? 0.006 : 0.04);
assert.equal(answerPosts().length, 0, "A 3.5 s recognizer stall during speech does not end the answer");
spoken += "最後";
first.emit([["我負責資料處理", true], [spoken.slice(7), false]]);
for (let n = 0; n < 5; n++) sample(n % 3 === 2 ? 0.006 : 0.04);
const lastLoudAt = now;
first.emit([["我負責資料處理", true], [spoken.slice(7), true]]);
for (let n = 0; n < 15; n++) sample(0);
assert.equal(answerPosts().length, 0, "Do not send before a 1.6 s pause");
for (let n = 0; n < 3; n++) sample(0);
await settle();
const sent = answerPosts()[0];
assert.ok(sent, "The pause sends the answer without another click");
const body = JSON.parse(sent.options.body);
assert.deepEqual([body.turnId, body.eventSeq, body.text, body.speechInput], ["t1", 1, spoken, "browser-stream"]);
const finalLatency = sent.at - lastLoudAt;
assert.ok(finalLatency >= 1600 && finalLatency <= 1800, `Answer leaves about 1.6 s after the voice stops (got ${finalLatency} ms)`);
assert.equal(posts.filter((post) => post.path.endsWith("audio-answers")).length, 0, "Streaming never uploads audio to Whisper");
assert.equal(e.state.backendTurns[0].answerText, spoken);
assert.equal(textarea.value, "", "The live transcript clears after sending");
assert.ok(first.aborted, "Recognition is closed once the answer is sent");
assert.equal(e.voiceLatencies.at(-1).speechToSendMs, finalLatency, "The logged delay is measured from the last loud audio");

// Continuous speech must not become the noise floor (it used to end answers mid-sentence).
{
  const vad = new VoiceActivityDetector();
  let t = 0, ended = false;
  for (let n = 0; n < 30; n++) vad.update(0.003, t += 100, 100);
  for (let n = 0; n < 100; n++) ended ||= vad.update(0.035, t += 100, 100) === "end";
  assert.equal(ended, false, "Ten seconds of gapless speech keeps the answer open");
  for (let n = 0; n < 17; n++) ended ||= vad.update(0.003, t += 100, 100) === "end";
  assert.equal(ended, true, "A real pause still ends it");
}

// 4. Words still pending when the 1.6 s VAD pause ends are flushed with stop().
e.acceptInterviewEvent({ ...question, seq: 3, turnId: "t2", audioUrl: null });
assert.equal(e.timing.phase, "preparing");
e.timing.listen(3); e.state.waitingForAgent = false;
e.acceptInterviewEvent({ type: "interview.audio.ready", seq: 4, eventSeq: 3, turnId: "t2", audioUrl: "/audio/3" });
audios.at(-1).end();
const second = recognitions.at(-1);
assert.notEqual(second, first);
for (let n = 0; n < 15; n++) sample(0.002);
sample(0.03); sample(0.03); sample(0.03);
second.emit([["因為我想", false]]);
sample(0.03);
const lastVoiceAt = now;
for (let n = 0; n < 16; n++) sample(0);
assert.ok(second.stopped, "VAD pause asks the service to finalize pending words");
assert.equal(e.timing.phase, "transcribing");
assert.equal(e.timing.countsTowardPractice(), false, "Practice time pauses while the answer is sent");
second.emit([["因為我想了解系統怎麼運作", true]]);
await settle();
const flushed = JSON.parse(answerPosts().at(-1).options.body);
assert.deepEqual([flushed.turnId, flushed.eventSeq, flushed.text], ["t2", 3, "因為我想了解系統怎麼運作"]);
const vadLatency = answerPosts().at(-1).at - lastVoiceAt;
assert.ok(vadLatency <= 1800, `VAD path sends within 1.8 s of the last voice (got ${vadLatency} ms)`);

// 5. A result from an older question is never sent to the new one.
e.acceptInterviewEvent({ ...question, seq: 5, turnId: "t3", audioUrl: null });
e.timing.listen(5); e.state.waitingForAgent = false;
e.acceptInterviewEvent({ type: "interview.audio.ready", seq: 6, eventSeq: 5, turnId: "t3", audioUrl: "/audio/5" });
audios.at(-1).end();
const stale = recognitions.at(-1);
stale.emit([["舊題目的回答", false]]);
const postsBeforeStale = answerPosts().length;
e.acceptInterviewEvent({ ...question, seq: 7, turnId: "t4", audioUrl: "/audio/7" });
assert.ok(stale.aborted, "A new question aborts the old recognition");
assert.equal(textarea.value, "", "Old live words disappear with the old question");
stale.emit([["舊題目的回答", true]]);
advance(2000); await settle();
assert.equal(answerPosts().length, postsBeforeStale, "Late old results are dropped");
assert.equal(e.state.liveTranscript, "");
// Also while flushing: the question changes between stop() and the final result.
audios.at(-1).end();
const flushing = recognitions.at(-1);
for (let n = 0; n < 15; n++) sample(0.002);
sample(0.03); sample(0.03); sample(0.03);
flushing.emit([["正在說", false]]);
for (let n = 0; n < 17; n++) sample(0);
assert.ok(flushing.stopped);
e.acceptInterviewEvent({ ...question, seq: 9, turnId: "t5", audioUrl: null });
flushing.emit([["正在說的舊回答", true]]);
advance(1000); await settle();
assert.equal(answerPosts().length, postsBeforeStale, "A flush that finishes after the question changed is dropped");

// 6. Chrome ends a session after silence: listen again on the same question, not fall back.
e.timing.listen(9); e.state.waitingForAgent = false;
e.acceptInterviewEvent({ type: "interview.audio.ready", seq: 10, eventSeq: 9, turnId: "t5", audioUrl: "/audio/9" });
audios.at(-1).end();
const quiet = recognitions.at(-1);
advance(8000);
quiet.fail("no-speech");
assert.equal(quiet.starts.length, 2, "no-speech restarts the same recognition");
assert.equal(recordings.length, 0);

// 7. A service error falls back to MediaRecorder → local Whisper, keeping the one automatic retry.
quiet.fail("network");
assert.equal(recordings.length, 1, "network error switches this question to recording");
assert.match(notices.at(-1), /本機 Whisper/);
assert.equal(e.state.recording, true);
audioAnswerFailures = 1;
for (let n = 0; n < 15; n++) sample(0.002);
sample(0.03); sample(0.03); sample(0.03);
for (let n = 0; n < 17; n++) sample(0);
for (let n = 0; n < 6; n++) await settle();
assert.equal(posts.filter((post) => post.path.endsWith("audio-answers")).length, 1);
assert.equal(recordings.length, 2, "A Whisper miss listens again once on the same question");
assert.match(notices.at(-1), /再說一次/);
const recognitionsAfterFallback = recognitions.length;
e.acceptInterviewEvent({ ...question, seq: 11, turnId: "t6", audioUrl: null });
e.timing.listen(11); e.state.waitingForAgent = false;
e.acceptInterviewEvent({ type: "interview.audio.ready", seq: 12, eventSeq: 11, turnId: "t6", audioUrl: "/audio/11" });
audios.at(-1).end();
assert.equal(recognitions.length, recognitionsAfterFallback, "After a service failure the rest of the interview uses Whisper");
assert.equal(recordings.length, 3);
e.discardRecording();

// 8. Streaming that never returns words while the student talks falls back too.
vm.runInContext("streamingRecognitionFailure = ''", sandbox); // as when a new interview starts
e.acceptInterviewEvent({ ...question, seq: 13, turnId: "t7", audioUrl: null });
e.timing.listen(13); e.state.waitingForAgent = false;
e.acceptInterviewEvent({ type: "interview.audio.ready", seq: 14, eventSeq: 13, turnId: "t7", audioUrl: "/audio/13" });
audios.at(-1).end();
const silentService = recognitions.at(-1);
const recordingsBefore = recordings.length;
for (let round = 0; round < 2; round++) {
  for (let n = 0; n < 15; n++) sample(0.002);
  sample(0.03); sample(0.03); sample(0.03);
  for (let n = 0; n < 17; n++) sample(0);
}
assert.ok(silentService.aborted);
assert.equal(recordings.length, recordingsBefore + 1, "Two spoken passages with no words switch to Whisper");
assert.equal(answerPosts().length, postsBeforeStale, "Noise without words is never sent as an answer");
e.discardRecording();

// 9. Consent signature and copy name the recognition location (a new interview clears the failure).
vm.runInContext("streamingRecognitionFailure = ''", sandbox);
e.state.preferencesReady = true;
e.state.recognitionMode = "browser";
assert.equal(JSON.parse(e.preferenceScope()).stt, "browser-google");
assert.match(e.settingsPage(), /瀏覽器串流辨識（較快，音訊送 Google）/);
assert.match(e.settingsPage(), /本機 Whisper（較慢，不外傳）/);
assert.match(e.settingsPage(), /即時送 Google 語音服務辨識/);
e.state.page = "device";
assert.match(e.devicePage(), /瀏覽器即時送 Google 語音服務辨識/);
e.state.page = "interview";
e.state.consentAudio = true;
listeners.get("change")({ target: { dataset: { recognition: "" }, value: "server" } });
assert.equal(e.state.recognitionMode, "server");
assert.equal(e.state.consentAudio, false, "Changing where audio goes requires a new audio consent");
assert.match(e.state.preferencesMessage, /重新允許/);
assert.equal(JSON.parse(e.preferenceScope()).stt, "local");
e.loadPreferences();
assert.equal(e.state.recognitionMode, "server", "The chosen recognition location is remembered");
assert.match(e.devicePage(), /錄音送至面試後端進行語音辨識/);

console.log(`PASS: streaming recognition (pause send ${finalLatency} ms, VAD flush ${vadLatency} ms in simulation), no cut-off on breaths/soft speech/66 s answers, interim display, stale-result dropping, Whisper fallback with auto-retry, and consent scope`);
