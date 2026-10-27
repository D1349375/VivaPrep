import assert from "node:assert/strict";
import { AgentService } from "../server/agent-service.js";
import { AgentError } from "../server/agent-provider.js";
import { structuredTextOutput } from "../server/structured-output.js";
import { portfolioBatchScope } from "../server/http-api.js";

const batch = "12345678-1234-1234-1234-123456789abc";
assert.notEqual(portfolioBatchScope(batch,{userId:"first-user"}),portfolioBatchScope(batch,{userId:"second-user"}));
assert.notEqual(portfolioBatchScope(batch,{guestOwnerHash:"first-guest"}),portfolioBatchScope(batch,{guestOwnerHash:"second-guest"}));
assert.equal(portfolioBatchScope(batch,{}),null);
assert.equal(portfolioBatchScope("invalid",{userId:"first-user"}),null);

const schema = { required: ["claims"], properties: { claims: { type: "array" } } };
const output = { claims: [{ text: '說明含有 {括號} 與 "引號" 的內容' }] };
assert.deepEqual(structuredTextOutput("```json\n" + JSON.stringify(output) + "\n```", schema), output);
assert.deepEqual(structuredTextOutput('格式範例 {"claims":[]}\n本次結果：' + JSON.stringify(output), schema), output);
assert.equal(structuredTextOutput('{"claims":[', schema), null);
assert.equal(structuredTextOutput('{"claims":"not an array"}', schema), null);

function pdf(text) {
  const content = "BT /F1 12 Tf 50 750 Td (" + text.replace(/[()\\]/g, "\\$&") + ") Tj ET";
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600000 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let document = "%PDF-1.7\n"; const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10,"0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}
const calls = [], releases = [];
let failFirst = true;
const provider = {
  mode: "cli", modelId: "medium", liveModelId: "low",
  async generate(input) {
    calls.push(input);
    if (failFirst) { failFirst = false; throw new AgentError("AGENT_INVALID_OUTPUT", "synthetic malformed output"); }
    const match = input.prompt.match(/【PDF 第 (\d+) 頁】\n([^\n]+)/);
    return { claims: [{ text: "合成測試的個人實作", sourcePage: Number(match[1]), evidenceQuote: match[2].slice(0, 70), claimType: "contribution", confidence: "high" }] };
  },
  release(scope) { releases.push(scope); },
};
const service = new AgentService(provider);
const first = await service.parsePortfolioPdf(pdf("I implemented the search feature and checked the results. ".repeat(600)), { school: "Do not use this school to filter reusable evidence" });
assert.ok(first.chunkCount > 1);
assert.equal(first.retries, 1);
assert.equal(calls.length, first.chunkCount + 1, "Retry only the failed chunk");
assert.ok(calls.every((input) => input.effort === "low" && input.scopeId === calls[0].scopeId));
assert.ok(calls.every((input) => !input.prompt.includes("Do not use this school")));
assert.equal(releases.length, 1);
assert.ok(first.claims.length);
const second = await service.parsePortfolioPdf(pdf("I learned dynamic programming and compared two solutions."), {});
assert.notEqual(calls.at(-1).scopeId, calls[0].scopeId, "Different documents cannot reuse each other's model history");
assert.equal(second.modelId, "low");
assert.ok(second.claims.length);
provider.generate = async () => { throw new AgentError("AGENT_INVALID_OUTPUT", "always malformed"); };
await assert.rejects(service.parsePortfolioPdf(pdf("I implemented a test."), {}), {code:"AGENT_INVALID_OUTPUT"});
assert.equal(releases.length, 3, "Release model history even on failure");
console.log("PASS: fenced/current JSON, truncated response rejection, neutral extraction, quick model, chunk retry, document isolation and cleanup");
