import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { driveImportStatus, driveProcessingBlock } from "../server/drive-import.js";
import { createHttpHandler } from "../server/http-api.js";
import { DRIVE_FILE_SCOPE, DriveImportCancelled, createDriveImporter } from "../src/drive-import.js";
import { PORTFOLIO_PARSER_VERSION, librarySnapshot, portfolioFileHash } from "../src/portfolio-library.js";

// ---- 1. Status: the feature is off unless OAuth and a paid Gemini API are both in place.
const ready = { agentMode: "gemini-api", geminiApiKey: "gemini-secret", liveVoiceApiKey: "gemini-secret", geminiPaidTierConfirmed: true, driveClientId: "123-abc.apps.googleusercontent.com", drivePickerApiKey: "picker-public", driveAppId: "123" };
const status = (overrides) => driveImportStatus({ ...ready, ...overrides });
assert.deepEqual(status({}), { enabled: true, processingAllowed: true, clientId: ready.driveClientId, apiKey: ready.drivePickerApiKey, appId: "123" });
for (const [overrides, reason] of [
  [{ driveClientId: "" }, "not-configured"],
  [{ drivePickerApiKey: "" }, "not-configured"],
  [{ driveAppId: "" }, "not-configured"],
  [{ driveAppId: "my-project-id" }, "invalid-app-id"],
  [{ drivePickerApiKey: "gemini-secret" }, "picker-key-reused"],
  [{ liveVoiceApiKey: "other", drivePickerApiKey: "other" }, "picker-key-reused"],
  [{ agentMode: "cli" }, "agent-mode"],
  [{ agentMode: "mock" }, "agent-mode"],
  [{ geminiApiKey: "" }, "gemini-key-missing"],
  [{ geminiPaidTierConfirmed: false }, "paid-tier-unconfirmed"],
]) {
  const result = status(overrides);
  assert.equal(result.enabled, false, reason);
  assert.equal(result.reason, reason);
  assert.ok(result.message, reason + " needs a visible explanation");
  for (const field of ["clientId", "apiKey", "appId"]) assert.equal(result[field], undefined, `${reason} must not expose ${field}`);
}
assert.equal(status({ driveClientId: "" }).processingAllowed, true, "Claims already imported stay usable when only OAuth is removed");
assert.equal(status({ geminiPaidTierConfirmed: false }).processingAllowed, false);
assert.ok(!JSON.stringify(status({})).includes("gemini-secret"), "A Gemini key must never be exposed");

// ---- 2. API: Drive data is refused before any model call; local upload is unaffected.
const pdfBase64 = Buffer.from("%PDF-1.7 synthetic").toString("base64");
const parseCalls = [], sessionCalls = [];
const apiConfig = { ...ready, maxRequestBytes: 12 * 1024 * 1024, maxPdfBytes: 8 * 1024 * 1024 };
const server = createServer(createHttpHandler({
  root: ".",
  config: apiConfig,
  orchestrator: { createSession: async (input) => { sessionCalls.push(input); return { session: { sessionId: "s1" } }; }, speechStatus: () => ({ available: false }) },
  agentService: { parsePortfolioPdf: async () => { parseCalls.push(1); return { claims: [], parsingMode: "extracted-text" }; }, release() {} },
  store: { get: () => null, list: () => [] },
  getProfiles: () => [{ id: "p1" }],
  reportRepository: {},
  authService: { resolveContext: () => ({ guestOwnerHash: "guest", cookiesToSet: [] }), assertCsrf() {}, rateLimit() {} },
  emailDelivery: {},
  interviewHistoryRepository: {},
}));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body) => { const response = await fetch(base + path, { method: "POST", body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
const parseBody = (extra = {}) => ({ profileId: "p1", filename: "a.pdf", pdfBase64, consent: true, ...extra });

apiConfig.geminiPaidTierConfirmed = false;
let result = await post("/api/portfolio/parse", parseBody({ source: "drive", driveConsent: true }));
assert.equal(result.status, 409);
assert.equal(result.body.error.code, "DRIVE_PROCESSING_BLOCKED");
assert.equal(parseCalls.length, 0, "Free tier: Drive PDF must not reach the model");
result = await post("/api/portfolio/parse", parseBody());
assert.equal(result.status, 200, "Free tier: local upload keeps working");
assert.equal(parseCalls.length, 1);

Object.assign(apiConfig, { geminiPaidTierConfirmed: true, agentMode: "cli" });
result = await post("/api/portfolio/parse", parseBody({ source: "drive", driveConsent: true }));
assert.equal(result.status, 409, "CLI mode must refuse Drive data");
assert.equal(parseCalls.length, 1);
result = await post("/api/sessions", { driveDerived: true });
assert.equal(result.status, 409, "CLI mode must refuse an interview using Drive claims");
assert.equal(sessionCalls.length, 0);
result = await post("/api/sessions", { driveDerived: false });
assert.equal(result.status, 201, "An interview without Drive claims is unaffected");
assert.equal(sessionCalls.length, 1);

apiConfig.agentMode = "gemini-api";
result = await post("/api/portfolio/parse", parseBody({ source: "drive" }));
assert.equal(result.status, 400);
assert.equal(result.body.error.code, "DRIVE_CONSENT_REQUIRED");
assert.equal(parseCalls.length, 1, "Drive PDF needs its own consent");
result = await post("/api/portfolio/parse", parseBody({ source: "drive", driveConsent: true }));
assert.equal(result.status, 200);
assert.equal(parseCalls.length, 2);
result = await post("/api/sessions", { driveDerived: true });
assert.equal(result.status, 201);

const health = await fetch(base + "/api/health").then((response) => response.json());
assert.equal(health.driveImport.enabled, true);
assert.equal(health.driveImport.apiKey, "picker-public");
assert.ok(!JSON.stringify(health).includes("gemini-secret"), "Health must not expose a Gemini key");
await new Promise((resolve) => server.close(resolve));

// ---- 3. Browser flow with fake Google services: only drive.file, token only sent to Drive.
const pdfBytes = new TextEncoder().encode("%PDF-1.7 synthetic drive pdf");
function fakeGoogle({ tokenResponse = { access_token: "token-1" }, tokenError = null, granted = true, pickerResponse } = {}) {
  const seen = { scopes: [], tokenClients: 0, picker: {}, gapiLoads: [] };
  const Document = { ID: "id", NAME: "name" };
  const picker = {
    ViewId: { DOCS: "all" }, Feature: { MULTISELECT_ENABLED: "multi" }, Response: { ACTION: "action", DOCUMENTS: "docs" }, Action: { PICKED: "picked", CANCEL: "cancel" }, Document,
    DocsView: class { constructor(id) { seen.picker.viewId = id; } setMimeTypes(value) { seen.picker.mimeTypes = value; return this; } setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } },
    PickerBuilder: class {
      addView() { return this; } enableFeature(value) { seen.picker.feature = value; return this; }
      setOAuthToken(value) { seen.picker.token = value; return this; } setDeveloperKey(value) { seen.picker.apiKey = value; return this; } setAppId(value) { seen.picker.appId = value; return this; }
      setOrigin(value) { seen.picker.origin = value; return this; } setLocale() { return this; } setMaxItems(value) { seen.picker.maxItems = value; return this; }
      setCallback(value) { this.callback = value; return this; }
      build() { return { setVisible: () => { seen.picker.visible = true; this.callback({ action: "loaded" }); this.callback(pickerResponse); } }; }
    },
  };
  const scope = {
    location: { origin: "http://localhost:4173" },
    gapi: { load(name, options) { seen.gapiLoads.push(name); options.callback(); } },
    google: { picker, accounts: { oauth2: {
      hasGrantedAllScopes: () => granted,
      initTokenClient(config) {
        seen.tokenClients++; seen.scopes.push(config.scope); seen.tokenConfig = config;
        return { requestAccessToken() { if (tokenError) config.error_callback(tokenError); else config.callback(tokenResponse); } };
      },
    } } },
  };
  return { scope, seen };
}
function fakeDrive(files) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, authorization: options?.headers?.Authorization });
    const parsed = new URL(url);
    const id = decodeURIComponent(parsed.pathname.split("/").at(-1));
    const file = files[id];
    if (!file) return { ok: false, status: 404 };
    if (parsed.searchParams.get("alt") === "media") return { ok: true, status: 200, arrayBuffer: async () => (file.bytes || pdfBytes).buffer };
    return { ok: true, status: 200, json: async () => file.meta };
  };
  return { fetchImpl, calls };
}
const config = { clientId: "client", apiKey: "picker-public", appId: "123" };
const importer = (fake, drive, loadScript = async () => {}) => createDriveImporter(config, { scope: fake.scope, fetchImpl: drive.fetchImpl, loadScript });
const picked = (...docs) => ({ action: "picked", docs });

assert.equal(DRIVE_FILE_SCOPE, "https://www.googleapis.com/auth/drive.file");
let fake = fakeGoogle({ pickerResponse: picked({ id: "a/b", name: "one" }, { id: "big", name: "big.pdf" }, { id: "sheet", name: "sheet" }, { id: "fake", name: "fake.pdf" }, { id: "locked", name: "locked.pdf" }, { id: "gone", name: "gone.pdf" }) });
let drive = fakeDrive({
  "a/b": { meta: { name: "folder/備審", mimeType: "application/pdf", size: String(pdfBytes.length), modifiedTime: "2026-10-01T00:00:00Z" } },
  big: { meta: { name: "big.pdf", mimeType: "application/pdf", size: String(9 * 1024 * 1024) } },
  sheet: { meta: { name: "sheet", mimeType: "application/vnd.google-apps.spreadsheet", size: "10" } },
  fake: { meta: { name: "fake.pdf", mimeType: "application/pdf", size: "4" }, bytes: new TextEncoder().encode("nope") },
  locked: { meta: { name: "locked.pdf", mimeType: "application/pdf", size: "4", capabilities: { canDownload: false } } },
});
const loaded = [];
let outcome = await importer(fake, drive, async (url) => { loaded.push(url); }).importPdfs({ maxFiles: 6 });
assert.deepEqual(fake.seen.scopes, [DRIVE_FILE_SCOPE], "Only drive.file may be requested");
assert.equal(fake.seen.tokenConfig.include_granted_scopes, false);
assert.deepEqual(loaded, ["https://accounts.google.com/gsi/client", "https://apis.google.com/js/api.js"]);
assert.deepEqual(fake.seen.gapiLoads, ["picker"]);
assert.equal(fake.seen.picker.mimeTypes, "application/pdf");
assert.equal(fake.seen.picker.token, "token-1");
assert.equal(fake.seen.picker.apiKey, "picker-public");
assert.equal(fake.seen.picker.appId, "123");
assert.equal(fake.seen.picker.maxItems, 6);
assert.equal(outcome.files.length, 1, "A bad file must not stop the good one");
assert.equal(outcome.files[0].name, "備審.pdf", "Names get a .pdf suffix and lose path parts");
assert.equal(outcome.files[0].type, "application/pdf");
assert.equal(outcome.files[0].lastModified, Date.parse("2026-10-01T00:00:00Z"));
assert.equal(outcome.errors.length, 5);
for (const [index, text] of ["big.pdf：PDF 不可大於 8 MB", "sheet：只能匯入 PDF", "fake.pdf：這個檔案不是有效的 PDF", "locked.pdf：檔案擁有者不允許", "gone.pdf：找不到這個檔案"].entries()) assert.ok(outcome.errors[index].startsWith(text), outcome.errors[index]);
assert.ok(drive.calls.every((call) => call.url.startsWith("https://www.googleapis.com/drive/v3/files/") && call.authorization === "Bearer token-1"), "The token only goes to the Drive API");
assert.ok(!drive.calls.some((call) => new URL(call.url).searchParams.get("alt") === "media" && /big|sheet|locked/.test(call.url)), "Rejected files are not downloaded");
assert.ok(!JSON.stringify(outcome.files.map((file) => file.name)).includes("token-1"));

fake = fakeGoogle({ pickerResponse: picked({ id: "a", name: "a" }, { id: "b", name: "b" }) });
drive = fakeDrive({ a: { meta: { name: "a.pdf", mimeType: "application/pdf", size: "4" } }, b: { meta: { name: "b.pdf", mimeType: "application/pdf", size: "4" } } });
outcome = await importer(fake, drive).importPdfs({ maxFiles: 1 });
assert.equal(outcome.files.length, 1);
assert.match(outcome.errors[0], /最多再加入 1 份/);

for (const [options, expected] of [
  [{ pickerResponse: { action: "cancel" } }, DriveImportCancelled],
  [{ tokenError: { type: "popup_closed" } }, DriveImportCancelled],
  [{ tokenResponse: { error: "access_denied" } }, DriveImportCancelled],
  [{ tokenError: { type: "popup_failed_to_open" } }, /彈出式視窗/],
  [{ tokenError: { type: "unknown" } }, /授權失敗/],
  [{ tokenResponse: { error: "server_error" } }, /授權失敗/],
  [{ granted: false, pickerResponse: picked() }, /需要勾選/],
]) {
  drive = fakeDrive({});
  await assert.rejects(importer(fakeGoogle(options), drive).importPdfs({ maxFiles: 5 }), expected);
  assert.equal(drive.calls.length, 0, "No Drive call without a grant and a selection");
}
let attempts = 0;
fake = fakeGoogle({ pickerResponse: picked() });
const retrying = createDriveImporter(config, { scope: fake.scope, fetchImpl: fakeDrive({}).fetchImpl, loadScript: async () => { attempts++; if (attempts === 1) throw new Error("無法載入 Google 服務"); } });
await assert.rejects(retrying.importPdfs({ maxFiles: 5 }), /無法載入/);
assert.deepEqual(await retrying.importPdfs({ maxFiles: 5 }), { files: [], errors: [] }, "A failed script load can be retried");

// ---- 4. Source scan: no wider Drive scope anywhere, no token storage or upload.
const sources = [];
for (const directory of ["src", "server"]) for (const name of await readdir(new URL(`../${directory}/`, import.meta.url))) {
  if (/\.(js|mjs)$/.test(name)) sources.push([`${directory}/${name}`, await readFile(new URL(`../${directory}/${name}`, import.meta.url), "utf8")]);
}
for (const [path, text] of sources) {
  assert.ok(!/auth\/drive(?!\.file)/.test(text), `${path} must not request a Drive scope other than drive.file`);
  assert.ok(!/drive\.(readonly|metadata|appdata|photos)/.test(text), `${path} must not mention a wider Drive scope`);
  if (path !== "src/drive-import.js") assert.ok(!/access_token|setOAuthToken/.test(text), `${path} must not touch the Drive access token`);
  if (path.startsWith("server/")) assert.ok(!/googleapis\.com\/drive/.test(text), `${path} must not call the Drive API; the browser downloads the file`);
}
const moduleSource = sources.find(([path]) => path === "src/drive-import.js")[1];
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(moduleSource), "The token must not be stored");

// ---- 5. UI: Drive off keeps local upload; consent and source flow through the real app code.
const requests = [];
const element = { innerHTML: "", textContent: "", style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector() { return null; } };
const noop = () => {};
const importedFiles = [];
let importerConfig = null;
class FakeCancelled extends Error {}
const sandbox = vm.createContext({
  console, Blob, Buffer, URL, Uint8Array, Date, crypto: webcrypto, btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  PORTFOLIO_PARSER_VERSION, librarySnapshot, portfolioFileHash, readPortfolioLibrary: async () => null, writePortfolioLibrary: async () => {}, deletePortfolioLibrary: async () => {},
  DriveImportCancelled: FakeCancelled,
  createDriveImporter: (value) => { importerConfig = value; return { prepare: async () => {}, importPdfs: async () => ({ files: importedFiles.splice(0), errors: [] }) }; },
  InterviewTiming: class { pause() {} }, createCameraAnalyzer: () => ({}), buildPostureFeedback: () => ({}), VoiceActivityDetector: class {}, percent: (value) => value * 100,
  EventSource: class { addEventListener() {} close() {} },
  document: { getElementById: () => element, querySelector: () => null, body: { classList: element.classList } },
  window: { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener: noop, scrollTo: noop },
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop, navigator: {},
  fetch: async (path, options) => {
    requests.push({ path, body: options?.body ? JSON.parse(options.body) : null });
    if (path === "/api/portfolio/parse") return { ok: true, status: 200, json: async () => ({ claims: [{ text: "主張", sourcePage: 1, evidenceQuote: "摘錄" }] }) };
    return { ok: true, status: 200, json: async () => ({ released: true }) };
  },
});
let source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
source = source.replace(/^import .*;\r?\n/gm, "").replace(/render\(\);\r?\nasync function initializeApp/, "async function initializeApp").replace(/initializeApp\(\);\s*$/, "");
source += "\nrender = () => {}; globalThis.exercise = { state, settingsPage, portfolioUploadHtml, selectPortfolioFiles, parsePortfolioPdf, importFromDrive, startRestriction, driveClaimsInUse, dropPendingDriveFiles, loadPreferences };";
vm.runInContext(source, sandbox);
const e = sandbox.exercise;
Object.assign(e.state, { page: "library", agentMode: "gemini-api", authReady: true, preferencesReady: true, libraryReady: true, csrfToken: "test", consentModel: true, resumeConsent: true, driveConsent: true, profileId: "fcu-general" });

const off = { enabled: false, processingAllowed: false, reason: "not-configured", message: "伺服器尚未設定 Google Drive 匯入（OAuth 用戶端、Picker API key 與專案編號）。" };
e.state.health = { portfolioParsingAvailable: true, driveImport: off };
let html = e.portfolioUploadHtml(true, "", "");
assert.match(html, /data-action="drive-import" disabled/, "Without OAuth the button is disabled");
assert.ok(html.includes(off.message) && html.includes("本機上傳不受影響"), "The reason is shown");
assert.match(html, /id="resume-file" type="file"(?![^>]*disabled)/, "Local upload stays enabled");
assert.match(e.settingsPage(), /data-preference="driveConsent"[^>]*disabled/);
assert.equal(importerConfig, null);
await e.importFromDrive();
assert.equal(e.state.portfolioFiles.length, 0);
e.selectPortfolioFiles([new File([pdfBytes], "local.pdf", { type: "application/pdf" })]);
assert.equal(e.state.portfolioFiles[0].source, undefined);
await e.parsePortfolioPdf();
let sent = requests.find((request) => request.path === "/api/portfolio/parse").body;
assert.equal(sent.source, undefined, "Local PDFs are not labelled as Drive");
assert.equal(sent.driveConsent, undefined);
assert.equal(e.state.portfolioFiles[0].status, "done", "Local parsing works with Drive off");

requests.length = 0;
Object.assign(e.state, { portfolioFiles: [], claims: [], claimsOrigin: "manual", resumeParseMessage: "" });
e.state.health.driveImport = { enabled: true, processingAllowed: true, clientId: "client", apiKey: "picker-public", appId: "123" };
e.state.driveConsent = false;
assert.match(e.portfolioUploadHtml(true, "", ""), /data-action="drive-import" disabled/, "Without the Drive consent the button is disabled");
assert.match(e.settingsPage(), /drive\.file/, "The Drive consent copy names the scope");
assert.match(e.settingsPage(), /付費層/, "The Drive consent copy names the paid tier");
assert.match(e.settingsPage(), /訓練或改進通用 AI 模型/, "The Drive consent copy covers the Workspace policy");
await e.importFromDrive();
assert.equal(importerConfig, null, "No Google contact without consent");

e.state.driveConsent = true;
assert.match(e.portfolioUploadHtml(true, "", ""), /data-action="drive-import" (?!disabled)/);
importedFiles.push(new File([pdfBytes], "drive.pdf", { type: "application/pdf" }));
await e.importFromDrive();
assert.equal(importerConfig.clientId, "client");
assert.equal(e.state.portfolioFiles[0].source, "drive");
assert.equal(e.state.portfolioFiles[0].status, "pending", "Import alone does not send the PDF anywhere");
assert.equal(requests.length, 0);
assert.match(e.state.portfolioFiles[0].message, /Google Drive/);

e.state.driveConsent = false;
e.dropPendingDriveFiles();
assert.equal(e.state.portfolioFiles.length, 0, "Withdrawing consent drops a Drive PDF not yet sent");
e.state.driveConsent = true;
importedFiles.push(new File([pdfBytes], "drive.pdf", { type: "application/pdf" }));
await e.importFromDrive();
await e.parsePortfolioPdf();
sent = requests.find((request) => request.path === "/api/portfolio/parse").body;
assert.equal(sent.source, "drive");
assert.equal(sent.driveConsent, true);
assert.equal(e.state.portfolioFiles[0].status, "done");
assert.equal(e.state.portfolioFiles[0].file, null, "The PDF is released after parsing");
assert.equal(e.state.claims[0].documentId, e.state.portfolioFiles[0].id);
assert.equal(librarySnapshot(e.state.portfolioFiles, e.state.claims, "portfolio").documents[0].source, "drive", "The saved library remembers the source");
assert.ok(!JSON.stringify(librarySnapshot(e.state.portfolioFiles, e.state.claims, "portfolio")).includes("token"), "The saved library holds no token");

e.state.confirmClaims = true;
assert.equal(e.driveClaimsInUse(), true);
assert.ok(!/Google Drive/.test(e.startRestriction() || ""), "An interview may use Drive claims on the paid tier");
e.state.health.driveImport = { ...off, processingAllowed: false };
assert.match(e.startRestriction(), /Google Drive/, "Drive claims block the interview once the tier is no longer confirmed");
e.state.portfolioFiles[0].selected = false;
assert.equal(e.driveClaimsInUse(), false);
assert.ok(!/Google Drive/.test(e.startRestriction() || ""), "Unticking the Drive document clears the block");

console.log("PASS: Drive status matrix, free-tier and CLI refusal before any model call, separate consent, drive.file only, token stays in the browser, cancel/popup/size/type errors, local upload unaffected with Drive off");
