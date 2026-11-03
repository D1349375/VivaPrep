import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { InterviewTiming } from "../src/interview-timing.js";
import { buildPostureFeedback } from "../src/posture-feedback.js";
import { VoiceActivityDetector } from "../src/voice-activity.js";

// Run the production page controller with isolated Web API doubles; never open a physical microphone.
let now = 1000;
let level = 0;
let nextFrame;
const posts = [];
const recordings = [];
const audios = [];
const element = { innerHTML: "", textContent: "", style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector() { return null; } };
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
  constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = "inactive"; recordings.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(["synthetic recording"], { type: this.mimeType }) }); this.onstop?.(); });
  }
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
const sandbox = vm.createContext({ console, Blob, Buffer, URL, Uint8Array, Uint32Array, Date: TestDate, MediaRecorder: TestRecorder, MediaStream: TestStream, Audio: TestAudio, InterviewTiming: class extends InterviewTiming { constructor() { super(() => now); } },
  createCameraAnalyzer: () => ({}), buildPostureFeedback, VoiceActivityDetector, percent: (value) => value * 100,
  document: { getElementById: (id) => ["app", "toast"].includes(id) ? element : null, querySelector: () => null, body: { classList: element.classList } },
  window: { AudioContext: TestAudioContext, MediaRecorder: TestRecorder, addEventListener() {}, scrollTo() {} },
  navigator: {}, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: (fn) => { nextFrame = fn; return 1; }, cancelAnimationFrame() {},
  fetch: async (path, options) => {
    posts.push({ path, options });
    return { ok: true, status: 202, json: async () => path.endsWith("audio-answers") ? { transcript: "合成測試回答", turnId: "t1", accepted: true } : { accepted: true } };
  },
});
let source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
source = source.replace(/^import .*;\r?\n/gm, "").replace(/render\(\);\r?\nasync function initializeApp/, "async function initializeApp").replace(/initializeApp\(\);\s*$/, "");
source += "\nrender = () => {}; globalThis.exercise = { state, timing: interviewTiming, acceptInterviewEvent, completeVoiceCapture, discardRecording, stopQuestionAudio, startVoiceCapture, checkDevices };";
vm.runInContext(source, sandbox);
const e = sandbox.exercise;
Object.assign(e.state, { page: "interview", sessionId: "test", voiceEnabled: true, authReady: true, csrfToken: "test", audioReady: true, stream: new TestStream([{ readyState: "live", enabled: true }]) });
const question = { type: "interview.event", seq: 1, turnId: "t1", phase: "question", speakerId: "portfolio", utterance: "你負責了什麼？", audioUrl: "/audio/1" };
e.acceptInterviewEvent(question);
assert.equal(recordings.length, 0, "Professor speech must not be recorded as an answer");
assert.equal(e.timing.phase, "speaking");
now += 30000;
assert.equal(e.timing.remainingMs(), null);
audios[0].end();
assert.equal(recordings.length, 1, "Recorder must start automatically at playback end");
assert.equal(e.state.recording, true);
assert.equal(e.timing.remainingMs(), 8000);
function sample(rms, delta = 100) { level = rms; now += delta; const frame = nextFrame; frame(); }
sample(0.025); sample(0.025); sample(0.025);
assert.equal(e.state.voiceDetected, true, "Speech below the old threshold must still be detected");
assert.equal(e.timing.phase, "capturing");
assert.equal(e.timing.remainingMs(), null);
sample(0, 3100);
await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
const audioPost = posts.find((post) => post.path.endsWith("audio-answers"));
assert.ok(audioPost, "Silence after speech must flush audio without another mic click");
assert.equal(audioPost.options.headers["X-VivaPrep-Turn"], "t1");
assert.equal(audioPost.options.headers["X-VivaPrep-Event-Seq"], "1");
assert.equal(audioPost.options.headers["Content-Type"], "audio/webm;codecs=opus");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(e.state.backendTurns[0].answerText, "合成測試回答");
e.acceptInterviewEvent({ ...question, seq: 5, turnId: "t2", audioUrl: null });
e.acceptInterviewEvent({ type: "interview.audio.ready", seq: 6, eventSeq: 1, turnId: "t1", audioUrl: "/audio/old" });
assert.equal(audios.length, 1, "Late audio from an old question must be ignored");
audios[0].end();
assert.equal(e.timing.phase, "preparing", "Old playback completion cannot enable recording of a new question");
assert.equal(recordings.length, 1);
e.stopQuestionAudio(); e.discardRecording();
const oldTrack = { readyState: "live", enabled: true, stop() { this.readyState = "ended"; } };
e.state.stream = new TestStream([oldTrack]);
e.state.audioReady = true;
e.state.microphoneId = "physical";
e.timing.listen(5);
e.startVoiceCapture();
sample(0.025); sample(0.025); sample(0.025);
assert.equal(e.timing.phase, "capturing");
let requestedInput;
sandbox.navigator.mediaDevices = { async getUserMedia(input) { requestedInput = input; return new TestStream([{ label: "實體測試麥克風", readyState: "live", enabled: true, stop() { this.readyState = "ended"; } }]); }, async enumerateDevices() { return []; } };
const countBeforeSwitch = recordings.length;
await e.checkDevices();
assert.equal(requestedInput.audio.deviceId.exact, "physical");
assert.equal(oldTrack.readyState, "ended");
assert.equal(recordings.length, countBeforeSwitch + 1, "Switching a mic while answering must restart capture for the same question");
assert.equal(e.state.recording, true);
e.discardRecording();
const beforeClosure = recordings.length;
e.acceptInterviewEvent({ type:"interview.closing",seq:10,speakerId:"portfolio",utterance:"今天就到這裡，謝謝你的分享。",audioUrl:"/closing/10",reason:"time" });
assert.equal(e.state.closing,true);
assert.equal(e.timing.phase,"closing");
assert.equal(e.timing.countsTowardPractice(),false);
e.startVoiceCapture(); assert.equal(recordings.length,beforeClosure,"Closing speech must never start another answer capture");
const closedQuestionCount=e.state.backendTurns.length;
e.acceptInterviewEvent({...question,seq:11,turnId:"late"});
assert.equal(e.state.backendTurns.length,closedQuestionCount,"Late questions cannot replace closing");
assert.equal(e.state.currentEvent.type,"interview.closing");
console.log("PASS: automatic recording, quiet speech detection, silence submission, turn binding, and stale audio using the production controller");
