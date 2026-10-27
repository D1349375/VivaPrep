import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { SpeechAdapter } from "../server/speech-adapter.js";

const base = process.env.VIVAPREP_CHECK_URL || "http://127.0.0.1:4173";
const label = process.env.VIVAPREP_CHECK_LABEL || "after";
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
const measurements = [];
function note(stage, data) { const row = { stage, ...data }; measurements.push(row); console.log(JSON.stringify(row)); }
const speech = new SpeechAdapter({ mode: "windows-sapi", maxAudioBytes: 8 * 1024 * 1024 });
const samples = [
  "我負責搜尋功能，用關鍵字找出書籍。我先建立測試資料，確認每次搜尋能找到正確的書，並修正錯誤紀錄。",
  "我用 Python 寫伺服器，建立資料庫查詢。我測試空白輸入和找不到書名的情況，遇到錯誤就檢查程式的紀錄。",
];
const clips = [];
await mkdir(new URL("../.data/performance/", import.meta.url), { recursive: true });
for (let i = 0; i < samples.length; i++) {
  const wav = await speech.synthesize(samples[i]);
  const webm = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg.exe", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-f", "webm", "pipe:1"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = []; child.stdout.on("data", chunk => chunks.push(chunk)); child.stderr.resume(); child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("audio conversion failed"))); child.stdin.end(wav.buffer);
  });
  await writeFile(new URL(`../.data/performance/synthetic-${i}.webm`, import.meta.url), webm);
  clips.push(webm);
}
let sessionId;
async function waitFor(predicate) {
  const deadline = Date.now() + 140000;
  while (Date.now() < deadline) {
    const snapshot = await call(`/api/sessions/${sessionId}`);
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for next question/audio");
}
try {
  const started = performance.now();
  const initial = await call("/api/sessions", { profileId: "fcu-general", panelIds: ["portfolio", "technical", "logic"], durationMinutes: 5, mode: "voice", confirmedClaims: [{text:"合成測試：我在校園借閱系統專題負責搜尋功能，用 Python 寫伺服器和資料庫查詢。"}], retentionMode: "ephemeral", consent: { modelProcessing:true, audioProcessing:true } });
  sessionId = initial.session.sessionId;
  let event = initial.event;
  note("opening", { durationMs:Math.round(performance.now()-started), question:event.utterance, speech:initial.speech.provider });
  const audioStarted = performance.now();
  await waitFor(s => Boolean(s.currentEvent.audioUrl));
  note("opening_synthesis", {durationMs:Math.round(performance.now()-audioStarted)});
  for (let i=0; i<clips.length; i++) {
    const submitted = performance.now();
    const voice = await call(`/api/sessions/${sessionId}/audio-answers`, Buffer.from(clips[i]), {"content-type":"audio/webm;codecs=opus", "x-vivaprep-turn":event.turnId,"x-vivaprep-event-seq":String(event.seq)});
    const transcribed = performance.now();
    note("transcription", {sample:i,durationMs:Math.round(transcribed-submitted), expected:samples[i],transcript:voice.transcript});
    const next = await waitFor(s => s.currentEvent.turnId !== event.turnId);
    note("next_question", {sample:i,durationMs:Math.round(performance.now()-transcribed),question:next.currentEvent.utterance,timings:next.timings});
    event=next.currentEvent;
    const generated=performance.now();
    await waitFor(s => Boolean(s.currentEvent.audioUrl));
    note("synthesis", {sample:i,durationMs:Math.round(performance.now()-generated)});
  }
} finally {
  if (sessionId) await fetch(`${base}/api/sessions/${sessionId}`, {method:"DELETE",headers});
  await writeFile(new URL(`../.data/performance/${label}.json`, import.meta.url), JSON.stringify(measurements,null,2));
}
