import assert from "node:assert/strict";
import { createServer } from "node:http";
import { InterviewOrchestrator } from "../server/interview-orchestrator.js";
import { PanelCoordinator } from "../server/panel-coordinator.js";
import { LiveVoiceService, buildLiveInstruction } from "../server/live-voice.js";
import { classifyLiveClose } from "../server/gemini-live.js";
import { acceptWebSocket } from "../server/websocket.js";
import { createUpgradeHandler } from "../server/http-api.js";
import { anonymityGuide, interviewGuide, speechTranscriptGuide } from "../server/interview-guide.js";
import { config } from "../server/config.js";
import { AppDatabase } from "../server/database.js";

// Gemini Live warm-up voice against a fake Live server and a fake browser over
// the real WebSocket upgrade path. Never connects to Google.

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
async function until(check, label, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// --- Fake Gemini Live server -------------------------------------------------
const fake = { connections: [], onSetup: null, onClient: null };
const liveServer = createServer();
liveServer.on("upgrade", (request, socket, head) => {
  const ws = acceptWebSocket(request, socket, head, { maxPayload: 4 * 1024 * 1024 });
  const conn = { ws, key: request.headers["x-goog-api-key"], url: request.url, received: [], setup: null, closed: false };
  fake.connections.push(conn);
  ws.on("close", () => { conn.closed = true; });
  ws.on("message", (data) => {
    const message = JSON.parse(String(data));
    conn.received.push(message);
    if (message.setup) {
      conn.setup = message.setup;
      // Like Gemini Live: one client per session, so resuming while the old socket is open is refused.
      const owner = fake.connections.find((item, index) => `handle-${index}` === message.setup.sessionResumption?.handle);
      if (owner && !owner.closed) { ws.close(1008, "BidiGenerateContent session is already connected to an existing client"); return; }
      fake.onSetup?.(conn);
    }
    else fake.onClient?.(conn, message);
  });
});
const livePort = await listen(liveServer);
const send = (conn, message) => conn.ws.send(JSON.stringify(message));
const ready = (conn, handle = "handle-" + fake.connections.indexOf(conn)) => { send(conn, { setupComplete: {} }); send(conn, { sessionResumptionUpdate: { newHandle: handle, resumable: true } }); };
const say = (conn, text) => {
  send(conn, { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: Buffer.alloc(480, 7).toString("base64") } }] } } });
  send(conn, { serverContent: { outputTranscription: { text } } });
  send(conn, { serverContent: { generationComplete: true } });
  send(conn, { serverContent: { turnComplete: true } });
};
const hear = (conn, text) => send(conn, { serverContent: { inputTranscription: { text } } });
const textsFrom = (conn) => conn.received.filter((message) => message.clientContent).map((message) => ({ text: message.clientContent.turns[0].parts[0].text, turnComplete: message.clientContent.turnComplete }));

// --- VivaPrep backend with fakes for the Agent and storage ---------------------
const sessions = new Map();
const events = [];
const consents = [];
const agentCalls = [];
const store = {
  create(session) { sessions.set(session.id, session); },
  get: (id) => sessions.get(id) || null,
  list: () => [...sessions.values()],
  save() {},
  delete(id) { return sessions.delete(id); },
  emit(id, event) { const session = sessions.get(id); if (!session) return; const next = { ...event, sessionId: id, seq: ++session.eventSequence }; session.events.push(next); events.push(next); return next; },
};
const agentService = {
  mode: "mock", modelId: "fake",
  release() {},
  async review(context) { agentCalls.push({ role: "review", context: structuredClone(context) }); return { summary: "", sharedStrengths: [], improvementPriorities: [], perspectiveDifferences: [], practiceDrill: [], evidenceRefs: [], sourceRefs: [], dataLimits: [] }; },
  async assess(role, context) {
    agentCalls.push({ role, context: structuredClone(context) });
    if (context.task === "opening") return { agentId: role, candidateQuestion: "你好，可以先用一分鐘簡單介紹一下自己嗎？", questionFocus: "introduction", dialogueAction: "opening", sourceRefs: [], relevance: 1 };
    return { agentId: role, candidateQuestion: "你剛才提到資料庫，當時怎麼確認查詢結果是對的？", questionFocus: "verification", dialogueAction: "follow_up", sourceRefs: [], relevance: 1 };
  },
};
const speechAdapter = { status: () => ({ available: true, provider: "fake", processingLocation: "local", ttsLocation: "cloud" }), async synthesize() { return { buffer: Buffer.from("wav"), mimeType: "audio/wav", provider: "fake" }; } };
function backend(endpoint, connectTimeoutMs = 400) {
  const liveVoice = new LiveVoiceService({ apiKey: "test-key", model: "gemini-3.8-live", voice: "Kore", endpoint, connectTimeoutMs, attachTimeoutMs: 300 });
  const orchestrator = new InterviewOrchestrator({
    store, agentService, coordinator: new PanelCoordinator(), speechAdapter, liveVoice,
    reportRepository: { approvedSources: async () => [] },
    interviewHistoryRepository: { recordConsent: (record) => consents.push(record) },
    getProfile: () => ({ id: "p", version: 1, school: "逢甲大學", department: "資訊工程學系", academicYear: 115, admissionRoute: "個人申請", officialFacts: [], unknowns: [], profileStatus: "official", sources: [] }),
    config: { ...config, maxAnswerLength: 8000 },
  });
  return { liveVoice, orchestrator };
}
const authService = { resolveContext: () => ({ isGuest: true, guestOwnerHash: "guest" }), ownsInterviewSession: (context, session) => Boolean(session) };
let current;
const appServer = createServer((request, response) => response.writeHead(404).end());
appServer.on("upgrade", (request, socket, head) => createUpgradeHandler({ authService, store, orchestrator: current.orchestrator })(request, socket, head));
const appPort = await listen(appServer);
const liveEndpoint = `ws://127.0.0.1:${livePort}/ws/live`;

const sessionInput = { profileId: "p", panelIds: ["portfolio"], durationMinutes: 5, mode: "voice", liveVoice: true, confirmedClaims: [{ text: "我在借閱系統專題負責資料庫設計。" }], consent: { modelProcessing: true, audioProcessing: true, liveVoice: true, speechRecognition: "browser" } };
function browser(sessionId, ticket, origin = `http://127.0.0.1:${appPort}`) {
  const ws = new WebSocket(`ws://127.0.0.1:${appPort}/api/sessions/${sessionId}/live?ticket=${encodeURIComponent(ticket)}`, { headers: { origin } });
  ws.binaryType = "arraybuffer";
  const client = { ws, messages: [], audio: [], closed: false };
  ws.onmessage = (event) => { if (typeof event.data === "string") client.messages.push(JSON.parse(event.data)); else client.audio.push(Buffer.from(event.data)); };
  ws.onclose = () => { client.closed = true; };
  ws.onerror = () => {};
  return client;
}
async function startLive(endpoint = liveEndpoint) {
  current = backend(endpoint);
  const created = await current.orchestrator.createSession(structuredClone(sessionInput), { guestOwnerHash: "guest" });
  return { ...created, sessionId: created.session.sessionId, session: sessions.get(created.session.sessionId) };
}
const liveConnection = () => fake.connections.at(-1);
const sessionEvents = (sessionId, type) => events.filter((event) => event.sessionId === sessionId && (!type || event.type === type));

// The consent receipt version used for Live has a registered notice that names free-tier data use.
{
  const database = new AppDatabase(":memory:");
  const notice = database.connection.prepare("SELECT notice_text FROM consent_policy_versions WHERE purpose = ? AND version = ?").get("speech_processing", "speech-processing-v4");
  const paidNotice = database.connection.prepare("SELECT notice_text FROM consent_policy_versions WHERE purpose = ? AND version = ?").get("speech_processing", "speech-processing-v5");
  database.close();
  assert.match(paidNotice?.notice_text || "", /付費層/, "speech-processing-v5 (paid tier) must be registered");
  assert.doesNotMatch(paidNotice.notice_text, /免費層/);
  assert.ok(notice, "speech-processing-v4 must be registered, or recording the Live consent throws");
  assert.match(notice.notice_text, /Gemini Live/);
  assert.match(notice.notice_text, /免費層/);
}

// 0. Close reasons map to fallback reasons; quota is recognised before anything else.
assert.equal(classifyLiveClose(1011, "RESOURCE_EXHAUSTED: You exceeded your current quota"), "quota");
assert.equal(classifyLiveClose(1007, "API key not valid. Please pass a valid API key."), "auth");
assert.equal(classifyLiveClose(1006, ""), "unavailable");

// 1. A successful Live warm-up writes both sides into session.turns.
fake.onSetup = (conn) => ready(conn);
fake.onClient = (conn, message) => { if (message.clientContent?.turnComplete && /面試開始/.test(message.clientContent.turns[0].parts[0].text)) say(conn, "你好，可以先簡單介紹一下自己嗎？"); };
{
  current = backend(liveEndpoint);
  assert.equal((await current.liveVoice.probe()).available, true, "The device-page probe succeeds when Live answers setup");
  const { sessionId, session, live, event } = await startLive();
  assert.equal(event, null, "Live speaks its own opening; no Agent question or TTS is made first");
  assert.ok(live.ticket, "Session creation hands the browser a single-use socket ticket");
  assert.equal(session.consentSnapshot.liveVoice, true);
  assert.equal(consents.find((item) => item.sessionId === sessionId && item.purpose === "speech_processing").version, config.geminiPaidTierConfirmed ? "speech-processing-v5" : "speech-processing-v4", "Live consent follows the confirmed Gemini tier");
  assert.equal(agentCalls.length, 0);

  // The socket needs the same origin and the ticket, which works once.
  const rejected = browser(sessionId, live.ticket, "http://evil.example");
  await until(() => rejected.closed, "cross-site socket rejection");
  const client = browser(sessionId, live.ticket);
  await until(() => client.messages.some((message) => message.type === "ready"), "Live ready");
  const replay = browser(sessionId, live.ticket);
  await until(() => replay.closed, "reused ticket rejection");

  const conn = liveConnection();
  assert.equal(conn.key, "test-key", "The API key travels only from backend to Live, in a header");
  assert.ok(!conn.url.includes("test-key"), "The key is not in the URL");
  const instruction = conn.setup.systemInstruction.parts[0].text;
  for (const guide of [interviewGuide, anonymityGuide, speechTranscriptGuide]) assert.ok(instruction.includes(guide), "Live instruction reuses the professor Agent guides");
  assert.match(instruction, /暖身對談/);
  assert.match(instruction, /最後一個問題/);
  assert.match(instruction, /借閱系統專題/, "Confirmed claims are in the instruction");
  assert.deepEqual(conn.setup.inputAudioTranscription.languageCodes, ["zh-TW", "en-US"], "Answers are transcribed as Taiwanese Mandarin");
  assert.deepEqual(conn.setup.outputAudioTranscription, {});
  assert.deepEqual(conn.setup.sessionResumption, {});
  assert.equal(conn.setup.model, "models/gemini-3.8-live");

  await until(() => sessionEvents(sessionId, "interview.event").length === 1, "opening question event");
  assert.ok(client.audio.length > 0, "Professor audio is relayed to the browser");
  const opening = session.turns[0];
  assert.equal(opening.questionText, "你好，可以先簡單介紹一下自己嗎？");
  assert.equal(sessionEvents(sessionId, "interview.event")[0].live, true);

  // Student audio goes to Live as 16 kHz PCM.
  const pcm = Buffer.alloc(3200);
  for (let index = 0; index < 1600; index++) pcm.writeInt16LE(index % 2 ? 6000 : -6000, index * 2);
  client.ws.send(pcm);
  await until(() => conn.received.some((message) => message.realtimeInput), "relayed microphone audio");
  const audio = conn.received.find((message) => message.realtimeInput).realtimeInput.audio;
  assert.equal(audio.mimeType, "audio/pcm;rate=16000");
  assert.deepEqual(Buffer.from(audio.data, "base64"), pcm);

  hear(conn, "我是高三學生，");
  hear(conn, "平常喜歡寫程式。");
  await until(() => client.messages.some((message) => message.type === "input" && message.text === "我是高三學生，平常喜歡寫程式。"), "student transcript");
  assert.equal(opening.answerText, "", "The answer is written only when the professor responds");
  say(conn, "你剛才說喜歡寫程式，最早是怎麼開始的？");
  await until(() => session.turns.length === 2, "second Live question");
  assert.equal(opening.answerText, "我是高三學生，平常喜歡寫程式。");
  assert.equal(opening.answerFromSpeech, true);
  assert.equal(session.turns[1].questionText, "你剛才說喜歡寫程式，最早是怎麼開始的？");
  assert.ok(session.timings.some((timing) => timing.stage === "live_relay_response"), "The backend times speech end to professor audio");
  client.ws.send(JSON.stringify({ type: "latency", ms: 1234 }));
  await until(() => session.timings.some((timing) => timing.stage === "live_response" && timing.durationMs === 1234), "browser latency timing");

  // A silent pause asks Live to rephrase; the rephrase is a follow-up on the same turn.
  client.ws.send(JSON.stringify({ type: "nudge" }));
  await until(() => textsFrom(conn).some((item) => /換個方式問/.test(item.text) && item.turnComplete), "rephrase request");
  say(conn, "還是我換個方式問：你第一次寫的程式是什麼？");
  await until(() => session.turns[1].followUps.length === 1, "rephrase follow-up");
  assert.equal(session.turns.length, 2);

  // Typed answers also reach Live.
  client.ws.send(JSON.stringify({ type: "text", text: "國中時用 Scratch 做小遊戲。" }));
  await until(() => textsFrom(conn).some((item) => /文字回答：國中時用 Scratch/.test(item.text)), "typed answer relayed");
  say(conn, "做小遊戲時，最難的地方是什麼？");
  await until(() => session.turns.length === 3, "third Live question");
  assert.equal(session.turns[1].answerText, "國中時用 Scratch 做小遊戲。");
  assert.equal(session.turns[1].answerFromSpeech, undefined, "Typed answers are not marked as speech");

  // Anonymity: a school in the answer is counted and masked for the Agents; a
  // question about the student's school is not recorded and Live asks again.
  hear(conn, "我在建國中學的社團裡學會先寫測試。");
  say(conn, "你是哪間高中的？");
  await until(() => client.messages.filter((message) => message.type === "anonymity").length === 2, "anonymity notices");
  assert.equal(session.turns[2].schoolMentionRedacted, true);
  assert.equal(session.anonymity.answerMentions, 1);
  assert.equal(session.turns.length, 3, "A violating question never becomes a turn");
  assert.equal(session.anonymity.liveQuestionViolations, 1);
  assert.ok(textsFrom(conn).some((item) => /匿名規則/.test(item.text) && item.turnComplete));
  say(conn, "這題先跳過。你怎麼安排除錯的時間？");
  await until(() => session.turns.length === 4, "replacement question");
  assert.ok(!session.turns.some((turn) => /哪間高中/.test(turn.questionText + turn.followUps.join(""))));

  // Practice time: the final-question cue goes in without asking Live to speak, then the farewell closes.
  client.ws.send(JSON.stringify({ type: "progress", elapsedSeconds: 260 }));
  await until(() => textsFrom(conn).some((item) => /最後一個問題/.test(item.text) && item.turnComplete === false), "final-question cue");
  hear(conn, "因為比賽時被 bug 卡過。");
  say(conn, "最後一個問題：進大學後最想學什麼？");
  await until(() => session.turns.length === 5, "final question");
  assert.equal(session.turns[4].finalQuestion, true);
  hear(conn, "我想學作業系統。");
  say(conn, "好，謝謝你的分享，今天就到這裡。");
  await until(() => sessionEvents(sessionId, "interview.closing").length === 1, "Live closing");
  const closing = sessionEvents(sessionId, "interview.closing")[0];
  assert.equal(closing.live, true);
  await until(() => client.messages.some((message) => message.type === "ended"), "ended reaches the browser");
  assert.equal(client.messages.at(-1).type === "ended" && client.messages.at(-2).type !== "turn", true, "No student turn is announced after the farewell");
  assert.equal(closing.utterance, "好，謝謝你的分享，今天就到這裡。");
  assert.equal(session.turns[4].answerText, "我想學作業系統。");
  await until(() => client.closed && conn.closed, "Live and browser sockets closed");
  assert.equal(session.audioBySequence.size, 0, "A Live farewell is not synthesized again");
  assert.ok(!session.turns.some((turn) => /［|[(（]/.test(turn.questionText)), "No placeholders or stage directions in questions");

  // The review sees the Live transcript like any other interview.
  await current.orchestrator.finish(sessionId, "completed");
  const review = agentCalls.find((call) => call.role === "review");
  assert.equal(review.context.turns.length, 5);
  assert.ok(review.context.turns[0].answerFromSpeech);
  assert.match(review.context.turns[2].answerText, /［學校名稱］/, "The review sees the answer with the school masked");
  assert.equal(session.status, "completed");
}

// 1b. A stage direction is not a question, and a final answer without a spoken
// farewell closes with the synthesized turn-based line.
fake.onClient = (conn, message) => { if (/面試開始/.test(message.clientContent?.turns?.[0]?.parts?.[0]?.text || "")) say(conn, "（看著資料）你好，可以先介紹自己嗎？"); };
{
  const { sessionId, session, live } = await startLive();
  const client = browser(sessionId, live.ticket);
  await until(() => session.turns.length === 1, "opening");
  assert.equal(session.turns[0].questionText, "你好，可以先介紹自己嗎？");
  const conn = liveConnection();
  client.ws.send(JSON.stringify({ type: "progress", elapsedSeconds: 290 }));
  await until(() => textsFrom(conn).some((item) => /時間到了/.test(item.text) && item.turnComplete === false), "time-up cue");
  hear(conn, "我喜歡寫程式。");
  say(conn, "(等待學生回答動機問題)");
  const closing = await until(() => sessionEvents(sessionId, "interview.closing")[0], "closing without farewell");
  assert.equal(closing.live, undefined);
  assert.match(closing.utterance, /面試就到這裡/);
  await until(() => sessionEvents(sessionId, "interview.audio.ready").length === 1, "synthesized farewell");
  assert.equal(session.turns[0].answerText, "我喜歡寫程式。");
}

// 2. Live unreachable: the probe fails and an attached session opens turn-based.
{
  current = backend(`ws://127.0.0.1:1/ws/live`);
  const probe = await current.liveVoice.probe();
  assert.equal(probe.available, false);
  assert.equal(probe.reason, "unavailable");
  const { sessionId, session, live } = await startLive(`ws://127.0.0.1:1/ws/live`);
  const client = browser(sessionId, live.ticket);
  await until(() => client.messages.some((message) => message.type === "fallback"), "fallback notice");
  await until(() => sessionEvents(sessionId, "interview.event").length === 1, "turn-based opening");
  const opening = sessionEvents(sessionId, "interview.event")[0];
  assert.equal(opening.live, undefined);
  assert.equal(opening.liveFallback.reason, "unavailable");
  assert.equal(opening.utterance, "同學你好，我是陳教授。先請你用一分鐘簡單自我介紹，姓名和就讀學校不用說。");
  assert.equal(session.live.state, "fallback");
  assert.equal(agentCalls.filter((call) => call.context.sessionId === sessionId && call.context.task === "opening").length, 0, "The greeting opening needs no model call");
  await until(() => sessionEvents(sessionId, "interview.audio.ready").length === 1, "turn-based TTS for the opening");
}

// 3. Setup never completes: a 400 ms test timeout (5 s in production) reports timeout.
{
  fake.onSetup = () => {};
  current = backend(liveEndpoint, 400);
  const started = Date.now();
  const probe = await current.liveVoice.probe();
  assert.equal(probe.reason, "timeout");
  assert.ok(Date.now() - started < 1500);
}

// 4. Quota exhausted (429) before the interview: the probe says quota, and so does a fallback.
{
  fake.onSetup = (conn) => conn.ws.close(1011, "RESOURCE_EXHAUSTED: You exceeded your current quota (429)");
  current = backend(liveEndpoint);
  const probe = await current.liveVoice.probe();
  assert.deepEqual([probe.available, probe.reason], [false, "quota"]);
  assert.match(probe.message, /額度/);
  const { sessionId, live } = await startLive();
  const client = browser(sessionId, live.ticket);
  await until(() => client.messages.some((message) => message.type === "fallback" && message.reason === "quota"), "quota fallback");
  await until(() => sessionEvents(sessionId, "interview.event").length === 1, "turn-based opening after quota");
}

// 5. Quota exhausted mid-interview, after a complete answer: no resumption, and the
// professor Agent asks next on the same topic from the Live transcript.
{
  fake.onSetup = (conn) => ready(conn);
  fake.onClient = (conn, message) => { if (/面試開始/.test(message.clientContent?.turns?.[0]?.parts?.[0]?.text || "")) say(conn, "可以先聊聊你在借閱系統專題做了什麼嗎？"); };
  const { sessionId, session, live } = await startLive();
  session.openingPlan = { id: "personal_contribution", roleId: "portfolio", instruction: "從借閱系統專題切入。", claim: session.claims[0] };
  const client = browser(sessionId, live.ticket);
  await until(() => session.turns.length === 1, "first Live question");
  const conn = liveConnection();
  const connectionsBefore = fake.connections.length;
  hear(conn, "我負責資料庫設計，也寫了搜尋功能。");
  send(conn, { serverContent: { outputTranscription: { text: "你剛才說" } } });
  conn.ws.close(1011, "RESOURCE_EXHAUSTED: quota exceeded");
  await until(() => client.messages.some((message) => message.type === "fallback" && message.reason === "quota"), "mid-interview quota fallback");
  await until(() => sessionEvents(sessionId, "interview.event").length === 2, "turn-based next question");
  assert.equal(fake.connections.length, connectionsBefore, "Quota errors are not retried with the resumption handle");
  assert.equal(session.turns[0].answerText, "我負責資料庫設計，也寫了搜尋功能。");
  assert.ok(sessionEvents(sessionId, "answer.received").length === 1);
  const call = agentCalls.filter((item) => item.context.sessionId === sessionId).at(-1);
  assert.equal(call.context.task, "assessment", "Same thread: the Agent may follow up rather than switch");
  assert.equal(call.context.previousQuestion, "可以先聊聊你在借閱系統專題做了什麼嗎？");
  assert.equal(call.context.answer, "我負責資料庫設計，也寫了搜尋功能。");
  assert.equal(session.turns[1].threadId, session.turns[0].threadId, "The turn-based question continues the Live topic thread");
  assert.ok(!session.turns.some((turn) => /你剛才說$/.test(turn.questionText)), "A half-spoken Live question is dropped");
}

// 6. Dropped mid-answer and resumption fails: the words so far stay in the answer
// box, the question is not asked again, and the next answer continues turn-based.
{
  let resumeFailIndex = -1;
  fake.onSetup = (conn) => { if (fake.connections.indexOf(conn) === resumeFailIndex) conn.ws.close(1011, "Internal error"); else ready(conn); };
  const { sessionId, session, live } = await startLive();
  const client = browser(sessionId, live.ticket);
  await until(() => session.turns.length === 1, "first Live question");
  const conn = liveConnection();
  const liveClient = current.liveVoice.active(sessionId).connection;
  resumeFailIndex = fake.connections.length;
  hear(conn, "我負責資料庫");
  await until(() => client.messages.some((message) => message.type === "input"), "partial transcript");
  conn.ws.terminate();
  await until(() => client.messages.some((message) => message.type === "fallback"), "fallback after drop");
  assert.equal(fake.connections.length, resumeFailIndex + 1, "A dropped connection is resumed once before falling back");
  assert.equal(fake.connections.at(-1).setup.sessionResumption.handle, `handle-${resumeFailIndex - 1}`);
  const fallback = client.messages.find((message) => message.type === "fallback");
  assert.equal(fallback.draftText, "我負責資料庫");
  const event = await until(() => sessionEvents(sessionId, "interview.event").find((item) => item.liveFallback), "fallback question event");
  assert.equal(event.alreadySpoken, true, "The professor does not say the same question again");
  assert.equal(event.turnId, session.turns[0].turnId);
  assert.equal(event.liveFallback.draftText, "我負責資料庫");
  assert.equal(session.audioBySequence.size, 0);
  // Late Live messages after the fallback cannot touch the turn-based question.
  liveClient.onmessage({ serverContent: { inputTranscription: { text: "斷線後的遲到字" } } });
  liveClient.onmessage({ serverContent: { outputTranscription: { text: "斷線後的遲到問題？" }, turnComplete: true } });
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].answerText, "");
  await current.orchestrator.submitAnswer(sessionId, { turnId: event.turnId, eventSeq: event.seq, text: "我負責資料庫和搜尋功能。", speechInput: "browser-stream" });
  await until(() => sessionEvents(sessionId, "interview.event").length === 3, "turn-based follow-up");
  const call = agentCalls.filter((item) => item.context.sessionId === sessionId).at(-1);
  assert.equal(call.context.previousQuestion, session.turns[0].questionText);
}

// 7. GoAway: the backend resumes with the handle; late messages on the old
// connection never reach the new question.
{
  fake.onSetup = (conn) => ready(conn);
  const { sessionId, session, live } = await startLive();
  const client = browser(sessionId, live.ticket);
  await until(() => session.turns.length === 1, "first Live question");
  const old = liveConnection();
  const oldClient = current.liveVoice.active(sessionId).connection;
  const count = fake.connections.length;
  hear(old, "我先");
  send(old, { goAway: { timeLeft: "5s" } });
  // Microphone audio during the reconnect is held and sent on the new connection.
  client.ws.send(Buffer.alloc(3200, 9));
  await until(() => client.messages.some((message) => message.type === "resumed"), "resumed after GoAway");
  await until(() => fake.connections[count]?.received.some((message) => message.realtimeInput), "held audio on the resumed connection");
  const fresh = fake.connections[count];
  assert.equal(fresh.setup.sessionResumption.handle, `handle-${count - 1}`);
  await until(() => old.closed, "old connection closed after the switch");
  // Deliver late messages through the replaced connection's handlers, as a slow socket would.
  oldClient.onmessage({ serverContent: { inputTranscription: { text: "舊連線的遲到字" } } });
  oldClient.onmessage({ serverContent: { outputTranscription: { text: "舊連線的遲到問題？" }, turnComplete: true } });
  oldClient.onclose(new Error("late close"));
  hear(fresh, "說明新的回答。");
  say(fresh, "那你怎麼分工？");
  await until(() => session.turns.length === 2, "question on the resumed connection");
  assert.equal(session.turns[0].answerText, "我先說明新的回答。", "Words before the switch are kept; nothing from after it");
  assert.equal(session.turns[1].questionText, "那你怎麼分工？");
  assert.ok(!JSON.stringify(session.turns).includes("遲到"), "Stale Live messages are ignored");
  assert.equal(session.live.resumptions, 1);
  // A turn-based answer ends Live first, so both flows never run at once.
  await current.orchestrator.submitAnswer(sessionId, { turnId: session.turns[1].turnId, text: "我負責後端。" });
  await until(() => fresh.closed && client.closed, "Live closed by a turn-based answer");
  assert.equal(session.live.state, "ended");
}

// 8. The browser never connects: the interview starts turn-based on its own.
{
  fake.onSetup = (conn) => ready(conn);
  const { sessionId, session } = await startLive();
  await until(() => sessionEvents(sessionId, "interview.event").length === 1, "turn-based opening without a browser");
  assert.equal(session.live.fallbackReason, "client_timeout");
  const instruction = buildLiveInstruction({ durationMinutes: 3, claims: [], portfolioEvidence: [], profileSnapshot: {}, openingPlan: { instruction: "邀請自我介紹" } });
  assert.match(instruction, /3 分鐘/);
  assert.match(instruction, /最多追問 1 層/, "Short sessions keep the topic-thread cap");
}

current.liveVoice.close();
liveServer.close();
appServer.close();
console.log("Gemini Live warm-up checks passed");
process.exit(0);
