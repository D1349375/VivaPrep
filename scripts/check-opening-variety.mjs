import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.VIVAPREP_CHECK_URL || "http://127.0.0.1:4173";
const response = await fetch(base + "/api/auth/session");
const auth = await response.json();
const headers = { "content-type": "application/json", "x-csrf-token": auth.csrfToken, cookie: response.headers.getSetCookie()[0].split(";", 1)[0] };
const results = [];
for (const withClaims of [true, true, true, false, false]) {
  let id;
  try {
    const started = performance.now();
    const created = await fetch(base + "/api/sessions", {
      method: "POST", headers, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ profileId: "fcu-general", panelIds: ["portfolio", "technical", "logic"], durationMinutes: 5, mode: "text", seed: 260926,
        confirmedClaims: withClaims ? [{ text: "合成測試：我用 Python 實作借閱系統的搜尋功能，並用測試資料驗證結果。", documentId: "test-one", sourceFilename: "one.pdf", sourcePage: 1, evidenceQuote: "我用 Python 實作搜尋功能" }, { text: "合成測試：我自學動態規劃，嘗試比較不同演算法的解題步驟。", documentId: "test-two", sourceFilename: "two.pdf", sourcePage: 1, evidenceQuote: "我自學動態規劃" }] : [],
        retentionMode: "ephemeral", consent: { modelProcessing: true, audioProcessing: false } }),
    });
    const payload = await created.json();
    assert.ok(created.ok, JSON.stringify(payload));
    id = payload.session.sessionId;
    const item = { withClaims, question: payload.event.utterance, speaker: payload.event.speakerId, durationMs: Math.round(performance.now() - started) };
    results.push(item);
    console.log(JSON.stringify(item));
  } finally {
    if (id) { const deleted = await fetch(base + "/api/sessions/" + id, { method: "DELETE", headers }); assert.equal(deleted.status, 204); }
  }
}
assert.equal(new Set(results.filter((item) => item.withClaims).map((item) => item.question)).size, 3);
assert.notEqual(results[3].question, results[4].question);
await mkdir(new URL("../.data/verification/", import.meta.url), { recursive: true });
await writeFile(new URL("../.data/verification/openings.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("PASS: five real Gemini openings, same profile and animation seed, varied questions with and without portfolio claims");
