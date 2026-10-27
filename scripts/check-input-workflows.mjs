import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { InterviewTiming } from "../src/interview-timing.js";
import { buildPostureFeedback } from "../src/posture-feedback.js";
import { VoiceActivityDetector } from "../src/voice-activity.js";
import { OpeningPlanner } from "../server/opening-planner.js";
import { InterviewOrchestrator } from "../server/interview-orchestrator.js";
import { PanelCoordinator } from "../server/panel-coordinator.js";
import { getProfile } from "../server/profiles.js";
import { PORTFOLIO_PARSER_VERSION, librarySnapshot, portfolioFileHash } from "../src/portfolio-library.js";

const requests = [];
const elements = new Map();
const element = { innerHTML: "", textContent: "", style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector() { return null; } };
elements.set("app", element); elements.set("toast", element);
let mediaFailure = null;
let lateMedia = null;
let failSecondPdf = true;
class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
}
const track = (kind = "audio") => ({ kind, label: "實體測試麥克風", enabled: true, readyState: "live", stop() { this.readyState = "ended"; } });
const mediaRequests = [];
const savedPreferences = new Map();
const savedLibraries = new Map();
const sandbox = vm.createContext({ console, Blob, Buffer, URL, Uint8Array, Uint32Array, Date, crypto: webcrypto, btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  PORTFOLIO_PARSER_VERSION, librarySnapshot, portfolioFileHash,
  readPortfolioLibrary: async (scope) => structuredClone(savedLibraries.get(scope) || null),
  writePortfolioLibrary: async (scope, snapshot) => { savedLibraries.set(scope, structuredClone(snapshot)); },
  deletePortfolioLibrary: async (scope) => { savedLibraries.delete(scope); },
  MediaStream: Stream, InterviewTiming, createCameraAnalyzer: () => ({}), buildPostureFeedback, VoiceActivityDetector, percent: (value) => value * 100,
  EventSource: class { addEventListener() {} close() {} },
  document: { getElementById: (id) => elements.get(id) || null, querySelector: () => null, body: { classList: element.classList } },
  window: { localStorage: { getItem(key) { return savedPreferences.get(key) || null; }, setItem(key,value) { savedPreferences.set(key,value); } }, addEventListener() {}, scrollTo() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  navigator: { mediaDevices: {
    async getUserMedia(input) { mediaRequests.push(input); if (input.video) throw { name: "NotReadableError" }; if (mediaFailure) throw mediaFailure; if (lateMedia) return lateMedia; return new Stream([track()]); },
    async enumerateDevices() { return [{ kind: "audioinput", deviceId: "physical", label: "實體測試麥克風" }, { kind: "audioinput", deviceId: "virtual", label: "Steam 虛擬麥克風" }]; },
  } },
  fetch: async (path, options) => {
    requests.push({ path, options });
    if (path === "/api/portfolio/parse") {
      const input = JSON.parse(options.body);
      if (input.filename === "two.pdf" && failSecondPdf) return { ok: false, status: 503, json: async () => ({ error: { message: "測試部分失敗" } }) };
      return { ok: true, status: 200, json: async () => ({ claims: [{ text: input.filename + " 的學習經驗", sourcePage: 1, evidenceQuote: "可回查摘錄" }] }) };
    }
    if (path === "/api/portfolio/release") return { ok: true, status: 200, json: async () => ({released:true}) };
    if (path.endsWith("/settings")) return { ok: true, status: 200, json: async () => ({ session: { mode: "voice", voiceEnabled: true } }) };
    if (path === "/api/sessions") return { ok: true, status: 201, json: async () => ({ session: { sessionId: "test-start", voiceEnabled: true }, event: { type: "interview.event", seq: 1, turnId: "t-start", speakerId: "portfolio", roleId: "portfolio", phase: "question", utterance: "請分享一段學習經驗。" }, agentMode: "cli", speech: { available: true } }) };
    throw new Error("Unexpected request " + path);
  },
});
let source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
source = source.replace(/^import .*;\r?\n/gm, "").replace(/render\(\);\r?\nasync function initializeApp/, "async function initializeApp").replace(/initializeApp\(\);\s*$/, "");
source += "\nrender = () => {}; globalThis.exercise = { state, timing: interviewTiming, checkDevices, checkCamera, acquireMicrophone, stopMedia, toggleMic, selectPortfolioFiles, parsePortfolioPdf, removePortfolioFile, portfolioUploadHtml, microphoneControlsHtml, claimsHtml, startInterview, loadPreferences, persistPreferences, startRestriction, settingsPage, loadPortfolioLibrary, persistPortfolioLibrary, forgetSavedPortfolio, selectedPortfolioClaims, resumePage };";
vm.runInContext(source, sandbox);
const e = sandbox.exercise;
Object.assign(e.state, { page: "device", agentMode: "cli", authReady: true, preferencesReady: true, libraryReady: true, csrfToken: "test", consentModel: true, consentAudio: true });
await e.checkDevices();
assert.equal(e.state.audioReady, true);
assert.equal(e.state.deviceReady, false);
assert.equal(mediaRequests[0].video, false, "Checking a mic must not request camera access");
assert.equal(e.state.microphones.length, 2);
const originalTrack = e.state.stream.getAudioTracks()[0];
await e.checkCamera();
assert.equal(e.state.audioReady, true, "Camera failure must preserve mic readiness");
assert.equal(originalTrack.readyState, "live");
e.state.microphoneId = "physical";
await e.checkDevices();
assert.equal(mediaRequests.at(-1).audio.deviceId.exact, "physical");
assert.equal(originalTrack.readyState, "ended", "Switching inputs must release the old mic");
const liveTrack = e.state.stream.getAudioTracks()[0];
liveTrack.stop(); liveTrack.onended();
assert.equal(e.state.audioReady, false);
assert.match(e.state.microphoneError, /中斷/);
mediaFailure = { name: "NotAllowedError" };
await e.checkDevices();
assert.match(e.state.microphoneError, /權限被拒絕/);
assert.equal(e.state.deviceChecking, false);
mediaFailure = null;
let release;
lateMedia = new Promise((resolve) => { release = resolve; });
const acquisition = e.acquireMicrophone();
e.stopMedia();
const lateTrack = track(); release(new Stream([lateTrack]));
await acquisition;
assert.equal(lateTrack.readyState, "ended", "Late permissions must not leak an active mic after leaving");
assert.equal(e.state.stream, null);
lateMedia = null;
Object.assign(e.state, { page: "device", sessionId: null, speechStatus: { available: true }, config: { mode: "voice", captions: true, duration: 15 } });
mediaFailure = { name: "NotFoundError" };
const requestsBeforeStart = requests.length;
await e.startInterview();
assert.equal(requests.length, requestsBeforeStart, "A failed mic must prevent silently starting a voice session without input");
assert.equal(e.state.page, "device");
assert.equal(e.state.sessionStarting, false);
mediaFailure = null;
const requestsBeforeAcquiring = mediaRequests.length;
await e.startInterview();
assert.equal(mediaRequests.length, requestsBeforeAcquiring + 1, "Voice start must acquire the mic even if the user skipped its check");
assert.equal(e.state.audioReady, true);
assert.equal(e.state.page, "interview");
assert.equal(e.state.sessionId, "test-start");
e.stopMedia(); e.state.sessionId = null;
Object.assign(e.state, { page: "interview", sessionId: "test", voiceEnabled: false, config: { mode: "text", captions: true } });
await e.toggleMic();
assert.equal(e.state.voiceEnabled, true, "Mic click in a text session must enable backend speech too");
assert.equal(JSON.parse(requests.at(-1).options.body).audioProcessing, true);
e.stopMedia();

const file = (name, size = 40, content = name) => ({ name, size, lastModified: 1, async arrayBuffer() { return Buffer.from("%PDF-1.7 synthetic test only " + content); } });
Object.assign(e.state, { page: "resume", agentMode: "cli", health: { portfolioParsingAvailable: true } });
e.selectPortfolioFiles([file("one.pdf"), file("two.pdf"), file("bad.txt")]);
e.selectPortfolioFiles([file("one.pdf")]);
assert.equal(e.state.portfolioFiles.length, 2, "Adding files must preserve existing files and skip duplicates");
assert.match(e.portfolioUploadHtml(true, "consent", ""), /multiple/);
const before = requests.length;
await e.parsePortfolioPdf();
assert.equal(requests.length, before, "No PDF bytes may be transmitted without consent");
e.state.resumeConsent = true;
await e.parsePortfolioPdf();
assert.equal(e.state.portfolioFiles[0].status, "done");
assert.equal(e.state.portfolioFiles[0].file, null);
assert.equal(e.state.portfolioFiles[1].status, "error");
assert.ok(e.state.portfolioFiles[1].file);
assert.equal(e.state.claims.length, 1);
assert.equal(e.state.claims[0].sourceFilename, "one.pdf");
failSecondPdf = false; e.state.resumeConsent = true;
await e.parsePortfolioPdf();
assert.equal(e.state.claims.length, 2, "Retry must append only failed documents, not duplicate successful ones");
assert.notEqual(e.state.claims[0].documentId, e.state.claims[1].documentId);
assert.match(e.claimsHtml(), /one\.pdf/);
e.state.portfolioFiles[1].selected = false;
assert.equal(e.selectedPortfolioClaims().length, 1, "Only selected document evidence enters an interview");
assert.ok(!e.resumePage().includes('type="file"'), "The interview wizard selects existing material; upload belongs in the library");
e.state.portfolioFiles[1].selected = true;
const beforeDuplicate = requests.filter((request) => request.path === "/api/portfolio/parse").length;
e.selectPortfolioFiles([file("renamed.pdf", 40, "one.pdf")]);
await e.parsePortfolioPdf();
assert.equal(requests.filter((request) => request.path === "/api/portfolio/parse").length, beforeDuplicate, "Identical content must reuse the edited claims without another model call");
assert.equal(e.state.portfolioFiles.length, 2);
e.state.claims[0].text = "已人工修正的主張";
await e.persistPortfolioLibrary();
assert.equal(savedLibraries.size, 0, "Saving document excerpts requires an explicit setting");
e.state.savePortfolio = true;
await e.loadPortfolioLibrary(); await e.persistPortfolioLibrary();
const saved = savedLibraries.get("portfolio.guest");
assert.ok(saved.documents.every((item) => !Object.hasOwn(item,"file")), "Never store raw PDFs");
assert.ok(!JSON.stringify(saved).includes("csrf"));
e.state.portfolioFiles = []; e.state.claims = [];
await e.loadPortfolioLibrary();
assert.equal(e.state.claims[0].text, "已人工修正的主張");
assert.equal(e.state.portfolioFiles.length, 2);
e.state.auth = { authenticated:true, user:{userId:"test-user"} };
await e.loadPortfolioLibrary(); assert.equal(e.state.claims.length, 0, "Account switches must clear another scope's private excerpts");
e.state.auth = {authenticated:false}; await e.loadPortfolioLibrary(); assert.equal(e.state.claims.length, 2);
e.state.savePortfolio = false; await e.forgetSavedPortfolio(); assert.equal(savedLibraries.size,0);
e.removePortfolioFile(e.state.portfolioFiles[0].id);
assert.equal(e.state.claims.length, 1);
assert.equal(e.state.claims[0].sourceFilename, "two.pdf");
e.selectPortfolioFiles([file("three.pdf"), file("four.pdf"), file("five.pdf"), file("six.pdf"), file("seven.pdf")]);
assert.equal(e.state.portfolioFiles.length, 5);

const planner = new OpeningPlanner(() => 0);
let prior = null;
for (let n = 0; n < 30; n++) {
  const plan = planner.choose({ ownerKey: "guest", profileId: "same", claims: ["經驗一", "經驗二"], eligibleRoles: ["technical"] });
  assert.notEqual(plan.id, prior, "Consecutive sessions must choose different opening angles even with the same animation seed");
  assert.equal(plan.roleId, "technical");
  assert.equal(plan.claim, plan.id === "introduction" ? null : "經驗一");
  prior = plan.id;
}
const session = { id: "test", status: "active", captionsEnabled: true, mode: "text", voiceEnabled: false, consentSnapshot: {}, ownerUserId: null, sources: [] };
const orchestrator = new InterviewOrchestrator({ store: { get: () => session, save() {} }, agentService: {}, coordinator: {}, speechAdapter: { status: () => ({ available: true }) }, config: {} });
assert.throws(() => orchestrator.updateSettings("test", { mode: "voice" }), /同意/);
assert.equal(orchestrator.updateSettings("test", { mode: "voice", audioProcessing: true }).session.voiceEnabled, true);
assert.equal(orchestrator.updateSettings("test", { captionsEnabled: false }).session.captionsEnabled, false);
let stored;
let openingContext;
const memoryStore = { create(value) { stored = value; }, get: () => stored, save() {}, delete() { stored = null; }, emit(id, event) { return { ...event, seq: ++stored.eventSequence }; } };
const multi = new InterviewOrchestrator({ store: memoryStore, agentService: { mode: "cli", modelId: "test", async assess(roleId, context) { openingContext = context; return { agentId: roleId, candidateQuestion: "從這段學習經驗中，你最想分享的挑戰是什麼？", questionFocus: "challenge", dialogueAction: "opening", sourceRefs: [], relevance: 0.5 }; } }, coordinator: new PanelCoordinator(), speechAdapter: { status: () => ({ available: false }) }, reportRepository: { approvedSources: async () => [] }, getProfile, config: { sessionDurationMin: 5, sessionDurationMax: 20 } });
const manyClaims = Array.from({ length: 10 }, (_, index) => ({ text: `合成測試經驗 ${index}`, documentId: index < 5 ? "doc-one" : "doc-two", sourceFilename: index < 5 ? "one.pdf" : "two.pdf", sourcePage: 1, evidenceQuote: `摘錄 ${index}` }));
await multi.createSession({ profileId: "fcu-general", panelIds: ["portfolio"], durationMinutes: 5, mode: "text", confirmedClaims: manyClaims, consent: { modelProcessing: true } }, { guestOwnerHash: "test-owner" });
assert.equal(stored.claims.length, 10, "Multiple PDFs must not be silently limited to the old eight-claim cap");
assert.equal(stored.portfolioEvidence[9].documentId, "doc-two");
assert.equal(stored.portfolioEvidence[9].sourceFilename, "two.pdf");
assert.equal(openingContext.portfolioEvidence[9].claimIndex, 9);
assert.equal(openingContext.openingPlan.claim, openingContext.openingPlan.id === "introduction" ? null : stored.claims[openingContext.openingPlan.claimIndex]);
await assert.rejects(() => multi.createSession({ profileId: "fcu-general", panelIds: ["portfolio"], durationMinutes: 5, mode: "text", confirmedClaims: Array.from({length:41},()=>({text:"合成測試"})), consent: { modelProcessing: true } }), /40/);
Object.assign(e.state, { agentMode:"cli", auth:{authenticated:false}, speechStatus:{provider:"whisper-local",processingLocation:"local",available:true}, config:{mode:"voice",duration:5}, preferencesReady:false });
e.loadPreferences(); assert.match(e.startRestriction(),/Agent/);
e.state.consentModel=true; assert.match(e.startRestriction(),/語音/);
e.state.config.mode="text"; assert.equal(e.startRestriction(),"");
e.state.consentAudio=true; e.state.resumeConsent=true; e.state.confirmClaims=true;
e.persistPreferences(); const storedSettings=[...savedPreferences.values()][0];
assert.ok(!storedSettings.includes("one.pdf") && !storedSettings.includes("學習經驗"),"Saved preferences contain no portfolio or answer content");
e.loadPreferences(); assert.equal(e.state.consentModel,true); assert.equal(e.state.consentAudio,true); assert.equal(e.state.confirmClaims,true);
e.selectPortfolioFiles([file("new.pdf")]); assert.equal(e.state.resumeConsent,true,"New files must not reset the saved permission");
e.state.auth={authenticated:true,user:{userId:"another-user"}}; e.loadPreferences(); assert.equal(e.state.consentModel,false,"Account scopes must be isolated");
e.state.auth={authenticated:false}; e.loadPreferences(); assert.equal(e.state.consentModel,true,"Guest preferences survive switching accounts");
e.state.speechStatus={provider:"gemini",processingLocation:"cloud"}; e.loadPreferences(); assert.equal(e.state.consentAudio,false,"Changed processing services require a new choice");
assert.match(e.state.preferencesMessage,/服務已變更/);
assert.match(e.settingsPage(),/資料使用設定/);
console.log("PASS: independent mic/camera checks, input selection, disconnect/permission races, text-to-voice consent, multiple PDF merge/retry/source labels, and varied opening angles");
