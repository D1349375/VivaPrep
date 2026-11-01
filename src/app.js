import { createCameraAnalyzer, percent } from "./camera-analysis.js";
import { createPoseOverlay, liveBadges } from "./pose-overlay.js";
import { InterviewTiming } from "./interview-timing.js";
import { buildPostureFeedback } from "./posture-feedback.js";
import { VoiceActivityDetector } from "./voice-activity.js";
import { LiveAudioLink } from "./live-audio.js";
import { PORTFOLIO_PARSER_VERSION, librarySnapshot, readPortfolioLibrary, writePortfolioLibrary, deletePortfolioLibrary, portfolioFileHash } from "./portfolio-library.js";

const app = document.getElementById("app");
const toast = document.getElementById("toast");
let profiles = [
  { id: "fcu-general", school: "逢甲大學", dept: "資訊工程學系", route: "個人申請・一般組", tag: "資訊工程", confidence: "115 學年度官方來源", icon: "⌘" },
  { id: "fcu-apcs", school: "逢甲大學", dept: "資訊工程學系", route: "個人申請・APCS 組", tag: "APCS", confidence: "示範情境", icon: "⌘" },
  { id: "ncu-eecs", school: "中央大學", dept: "資訊電機工程學系", route: "個人申請・一般模擬", tag: "資訊電機", confidence: "一般模擬", icon: "◌" },
];
const interviewers = {
  technical: { id: "technical", name: "林教授", role: "專題與工程實作", trait: "精準、重視你實際做過什麼", cue: "翻看專題紀錄", image: "/assets/interviewers/technical-poses.png", color: "copper" },
  portfolio: { id: "portfolio", name: "陳教授", role: "備審與學習歷程", trait: "耐心、會從你的經歷找到線索", cue: "翻閱備審資料", image: "/assets/interviewers/portfolio-poses.png", color: "sage" },
  logic: { id: "logic", name: "周教授", role: "邏輯、動機與反思", trait: "好奇、喜歡沿著想法多問一步", cue: "提出延伸追問", image: "/assets/interviewers/logic-poses.png", color: "blue" },
};
const panels = [
  { id: "balanced", title: "完整評估團", subtitle: "作品 × 學科 × 動機", count: "3 位", desc: "三種角度輪流提問，適合完整模擬。", people: ["technical", "portfolio", "logic"], icon: "✳" },
  { id: "technical-pair", title: "技術追問組", subtitle: "專題 × 邏輯", count: "2 位", desc: "集中練習作品細節、推理與概念追問。", people: ["technical", "logic"], icon: "⌘" },
  { id: "warmup", title: "暖身對談", subtitle: "備審 × 動機", count: "1 位", desc: "先和一位考官練自我介紹與選系動機。", people: ["portfolio"], icon: "◒" },
];
const steps = [
  ["profile", "選擇校系", "面試情境"], ["resume", "選用備審", "主張確認"],
  ["setup", "設定練習", "考官與流程"], ["device", "設備檢查", "開始前準備"],
  ["interview", "模擬面試", "進入面試室"], ["review", "逐題復盤", "下一輪練習"],
];
const state = {
  page: "home", profileId: "fcu-general", customProfiles: [], customProfileOpen: false, portfolioFiles: [], claimsOrigin: "sample", resumeConsent: false, resumeParsing: false, resumeParseMessage: "", resumeParseError: false,
  claims: [
    { id: "c1", text: "我在校園借閱系統專題中負責資料處理與搜尋功能。" },
    { id: "c2", text: "我透過自學演算法，嘗試用動態規劃改善問題解法。" },
  ],
  config: { duration: 5, mode: "voice", captions: true },
  panel: "balanced", people: [...panels[0].people], seed: 260926,
  q: 0, answers: [], followUps: [], draft: "", elapsed: 0, remaining: 300,
  muted: false, followUp: "", lastActivityAt: 0, audioReady: false,
  confirmEnd: false, stream: null, deviceReady: false, toastTimer: null,
  microphoneId: "", microphones: [], microphoneError: "", microphoneName: "", microphoneHeard: false, deviceChecking: false, cameraError: "",
  cameraAnalysisConsent: false, cameraMetricsConsent: false, cameraAnalysisActive: false, cameraAnalysisSummary: null, cameraPhase: "unclassified",
  sessionId: null, currentEvent: null, eventSource: null, eventSequence: 0,
  backendTurns: [], review: null, reviewError: null, agentMode: "unknown", speechStatus: { available: false },
  consentModel: false, consentAudio: false, confirmClaims: false, voiceEnabled: false, waitingForAgent: false, sessionStarting: false, nudgePending: false, health: null,
  preferencesReady: false, preferencesKey: "", preferencesMessage: "", settingsReturnPage: "home", closing: false, reviewStarting: false,
  savePortfolio: false, libraryScope: "", libraryReady: false, libraryMessage: "", libraryReturnPage: "home",
  recorder: null, recordedChunks: [], recording: false, settingsSaving: false, recognitionMode: "browser", liveTranscript: "",
  voiceDetected: false, voiceRetryRequired: false, transcribing: false, playbackBlocked: false,
  finishing: false, liveVoiceConsent: false, liveProbe: { status: "idle", at: 0 }, liveNotice: "", liveCaption: "",
  csrfToken: "", auth: null, authReady: false, authMode: "login", authBusy: false, authMessage: "", authActionUrl: "", authEmail: "",
  account: null, accountHistory: [], accountSessions: [], accountMfa: null, accountLoading: false, selectedHistory: null,
  mfaSecret: "", mfaRecoveryCodes: [], pendingReports: null, pendingPrivacyRequests: null, sharePolicy: null, sharePreview: null, shareResult: null, shareBusy: false,
  shareWithdrawalMessage: "", shareDraft: null, saveHistory: false,
};
const cameraAnalyzer = createCameraAnalyzer(updateCameraHud, { onOverlay: (points) => poseOverlay?.update(points) });
// Bottom-right demo view with the landmark overlay, for recordings; off during normal practice.
const CAMERA_DEMO_KEY = "vivaprep.cameraDemo.v1";
let poseOverlay = null;
const interviewTiming = new InterviewTiming();
let questionAudio = null;
let audioPreparationTimer = null;
let closingTimer = null;
let audioPlayedSequence = null;
let candidateActivitySequence = null;
const voiceActivity = new VoiceActivityDetector();
// Long noisy recordings made local Whisper time out; answers rarely need more.
const MAX_ANSWER_RECORDING_MS = 60000;
let lastAudioSampleAt = 0;
let microphoneLevel = 0;
let voiceRequestGeneration = 0;
let voiceCapture = null;
let voiceSubmissionPromise = null;
// Chrome's Web Speech API streams the answer to Google and returns text while
// the student talks, so an answer is ready about a second after they stop
// instead of after a 17-20 s local Whisper pass. Whisper stays the fallback.
const SpeechRecognitionClass = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
// An answer ends only when the microphone has been quiet for 1.6 s and the
// recognizer has returned no new words for 1.2 s (words lag the audio). Either
// signal alone cut students off: a soft voice dips under the level threshold,
// and Chrome finalizes a phrase at every breath, then takes over a second to
// send the next words.
const STREAM_PAUSE_MS = 1600;
const STREAM_WORDS_QUIET_MS = 1200;
// If the level never drops (a fan starting mid-answer), this long without new words still ends it.
const STREAM_WORDS_ONLY_END_MS = 6000;
// No Whisper timeout to protect here, so allow long answers, counted from the first word.
const MAX_STREAM_ANSWER_MS = 180000;
// stop() asks the service to finalize pending words; never wait longer than this.
const STREAM_FLUSH_MS = 700;
let streamingRecognitionFailure = "";
const voiceLatencies = [];
let cameraTrialGeneration = 0;
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const usesExternalAgent = () => state.agentMode === "cli" || state.agentMode === "gemini-api";
const agentLabel = () => state.agentMode === "gemini-api" ? "Gemini API" : state.agentMode === "cli" ? "Gemini" : state.agentMode === "mock" ? "本機示範" : "服務連線中";
const portfolioParsingAvailable = () => state.health?.portfolioParsingAvailable === true;
const preferenceFields = ["consentModel", "consentAudio", "liveVoiceConsent", "resumeConsent", "confirmClaims", "cameraAnalysisConsent", "cameraMetricsConsent", "saveHistory", "savePortfolio"];
const portfolioScope = () => "portfolio." + (state.auth?.user?.userId || "guest");
let libraryLoadGeneration = 0;
async function loadPortfolioLibrary() {
  const generation = ++libraryLoadGeneration;
  const scope = portfolioScope();
  const switching = state.libraryScope && state.libraryScope !== scope;
  state.libraryScope = scope;
  state.libraryReady = false;
  if (switching) {
    state.portfolioFiles = []; state.claims = []; state.claimsOrigin = "manual";
    state.resumeParseMessage = ""; state.resumeParseError = false;
  }
  try {
    const saved = state.savePortfolio ? await readPortfolioLibrary(scope) : null;
    if (generation !== libraryLoadGeneration) return;
    if (saved) {
      state.portfolioFiles = saved.documents;
      state.claims = saved.claims;
      state.claimsOrigin = saved.origin;
      state.libraryMessage = "已載入此瀏覽器保存的主張與摘錄，可以直接選用。";
    } else state.libraryMessage = state.savePortfolio ? "整理完成與編輯後會自動保存到此瀏覽器。" : "尚未啟用保存；重新整理或關閉頁面後，需重新匯入。";
  } catch { state.libraryMessage = "無法讀取本機資料庫，請確認瀏覽器允許儲存。"; }
  finally { if (generation === libraryLoadGeneration) { state.libraryReady = true; if (state.page !== "interview") render(); } }
}
async function persistPortfolioLibrary() {
  if (!state.savePortfolio || !state.libraryReady) return;
  const scope = state.libraryScope || portfolioScope();
  const snapshot = librarySnapshot(state.portfolioFiles, state.claims, state.claimsOrigin);
  try {
    await writePortfolioLibrary(scope, snapshot);
    if (scope === state.libraryScope && state.savePortfolio) { state.libraryMessage = "主張與摘錄已保存在此瀏覽器；原始 PDF 不保存。"; const label = app.querySelector(".library-status"); if (label) label.textContent = state.libraryMessage; }
  } catch { if (scope === state.libraryScope) { state.libraryMessage = "保存失敗，關閉頁面前請保留原 PDF；目前主張仍可使用。"; notify(state.libraryMessage); } }
}
async function forgetSavedPortfolio() {
  ++libraryLoadGeneration;
  state.libraryReady = true;
  try { await deletePortfolioLibrary(state.libraryScope || portfolioScope()); state.libraryMessage = "已刪除此瀏覽器保存的主張與摘錄；畫面中的資料僅保留到關閉頁面。"; }
  catch { state.libraryMessage = "無法刪除本機資料庫，請在瀏覽器網站資料中清除此網站的儲存資料。"; notify(state.libraryMessage); }
}
function selectedPortfolioClaims() {
  const selected = new Set(state.portfolioFiles.filter((item) => item.selected !== false && item.status === "done").map((item) => item.id));
  return state.claims.filter((claim) => !claim.documentId || selected.has(claim.documentId));
}
const streamingRecognitionSupported = () => Boolean(SpeechRecognitionClass());
const usesStreamingRecognition = () => state.recognitionMode === "browser" && streamingRecognitionSupported() && !streamingRecognitionFailure;
const serverRecognitionLabel = () => state.speechStatus?.processingLocation === "local" ? "本機 Whisper" : "後端語音服務";
// Gemini Live real-time voice: warm-up panel only, when the server enables it.
const liveVoiceModel = () => state.health?.liveVoice?.enabled ? state.health.liveVoice.model || "gemini-live" : "off";
const liveEligible = () => state.panel === "warmup" && state.people.length === 1 && state.people[0] === "portfolio" && state.config.mode === "voice" && liveVoiceModel() !== "off";
const liveConsented = () => state.liveVoiceConsent && state.consentAudio && state.consentModel;
const plansLive = () => liveEligible() && liveConsented() && state.liveProbe.status === "ok";
// Where answer audio is recognized: part of the consent signature, like TTS.
function recognitionLocation() {
  return state.recognitionMode === "browser" && streamingRecognitionSupported() ? "browser-google" : state.speechStatus?.processingLocation || "none";
}
function preferenceScope() {
  return JSON.stringify({ version: 1, agent: state.agentMode, audio: state.speechStatus?.provider || "none", location: state.speechStatus?.processingLocation || "none", tts: state.speechStatus?.ttsLocation || "none", stt: recognitionLocation(), live: liveVoiceModel() });
}
function loadPreferences() {
  const key = "vivaprep.permissions.v1." + (state.auth?.user?.userId || "guest");
  preferenceFields.forEach((field) => { state[field] = false; });
  state.preferencesKey = key;
  state.preferencesMessage = "";
  state.recognitionMode = "browser";
  try {
    const saved = JSON.parse(window.localStorage?.getItem(key) || "null");
    if (["browser", "server"].includes(saved?.recognition)) state.recognitionMode = saved.recognition;
    if (saved?.scope === preferenceScope()) {
      preferenceFields.forEach((field) => { state[field] = saved.values?.[field] === true; });
      state.preferencesMessage = "已載入這個瀏覽器先前保存的設定。";
    }
    else if (saved) state.preferencesMessage = "資料處理服務已變更，請在設定重新選擇授權。";
  } catch { state.preferencesMessage = "瀏覽器無法讀取設定，請重新選擇授權。"; }
  if (!state.consentModel) { state.resumeConsent = false; state.cameraMetricsConsent = false; }
  if (!state.consentModel || !state.consentAudio) state.liveVoiceConsent = false;
  if (!state.cameraAnalysisConsent) state.cameraMetricsConsent = false;
  if (!state.auth?.authenticated) state.saveHistory = false;
  state.preferencesReady = true;
}
function persistPreferences() {
  try {
    if (!window.localStorage) throw new Error("storage unavailable");
    window.localStorage.setItem(state.preferencesKey || "vivaprep.permissions.v1.guest", JSON.stringify({ scope: preferenceScope(), recognition: state.recognitionMode, values: Object.fromEntries(preferenceFields.map((field) => [field, state[field] === true])), updatedAt: new Date().toISOString() }));
    state.preferencesMessage = "設定已儲存在這個瀏覽器，下次練習會沿用。";
  } catch { state.preferencesMessage = "目前無法保存設定；關閉頁面後需要重新選擇。"; }
}
function startRestriction() {
  if (!state.authReady || !state.preferencesReady || !["mock", "cli", "gemini-api"].includes(state.agentMode)) return "正在確認服務與設定，請稍候。";
  if (usesExternalAgent() && !state.consentModel) return "尚未允許 Agent 處理對話，請先到設定開啟。";
  if (state.agentMode === "gemini-api" && !state.health?.geminiApiConfigured) return "Gemini 服務尚未設定完成。";
  if (state.config.mode === "voice" && !state.consentAudio) return "尚未允許語音處理，請到設定開啟，或改用文字回答。";
  if (state.config.mode === "voice" && !state.speechStatus?.available) return "語音服務尚未準備好，請改用文字回答。";
  return "";
}
function permissionSummary() {
  return `<div class="permission-summary"><strong>沿用資料使用設定</strong><p>Agent ${state.consentModel ? "已允許" : "未允許"}・語音 ${state.consentAudio ? "已允許" : "未允許"}・備審 ${state.confirmClaims ? "會使用目前編輯的主張" : "不使用，練習通用問題"}・鏡頭 ${state.cameraAnalysisConsent ? "本機分析" : "不分析"}・${state.saveHistory && state.auth?.authenticated ? "保存私人歷史" : "不保存私人歷史"}</p>${startRestriction() ? `<p class="permission-warning" role="status">${esc(startRestriction())}</p>` : ""}<button class="button button-outline" data-action="settings">調整資料使用設定</button></div>`;
}
function settingsPage() {
  const modelCopy = state.agentMode === "cli" ? "對話、目前編輯的主張與短摘錄會交給 Google Gemini 處理。" : state.agentMode === "gemini-api" ? "對話、目前編輯的主張與短摘錄會交給 Google Gemini API 處理。" : "目前使用本機示範；切換外部模型後會重新確認授權。";
  const ttsCopy = state.speechStatus?.ttsLocation === "cloud" ? "教授提問文字會送 Google Gemini TTS 產生語音；連線失敗時改用本機聲音。" : "";
  const serverCopy = state.speechStatus?.processingLocation === "local" ? "錄音送至面試後端進行語音辨識；辨識文字會交給教授 Agent。" : "錄音送交已設定的雲端語音服務辨識，辨識文字交給教授 Agent。";
  const audioCopy = (recognitionLocation() === "browser-google" ? `回答時由瀏覽器把音訊即時送 Google 語音服務辨識（Chrome Web Speech API），辨識文字交給教授 Agent；服務無法使用時改由面試後端辨識（${serverRecognitionLabel()}）。` : serverCopy) + ttsCopy;
  const localLabel = state.speechStatus?.processingLocation === "local" ? "本機 Whisper（較慢，不外傳）" : "後端語音服務（較慢）";
  const liveCopy = liveVoiceModel() === "off"
    ? "伺服器目前未啟用即時對談；暖身對談使用回合制。"
    : `只用於「暖身對談」。面試中麥克風音訊會持續經 VivaPrep 後端即時送到 Google Gemini Live API（${esc(liveVoiceModel())}），由它聽你的回答並直接說出教授的下一句，延遲約 1～2 秒；教授指示含校系情境與你確認的備審主張，雙方逐字稿存入本場紀錄供復盤。使用 Gemini API 免費層時，Google 會用送出的內容（含語音與逐字稿）改進其產品，並可能由人工審閱，請不要說出姓名、就讀學校或其他個人資料。需同時允許 Agent 與語音；連不上、額度用完或中途斷線時自動改用回合制。`;
  const choice = (value, title, copy, disabled = false) => `<label class="recognition-option"><input type="radio" name="recognitionMode" value="${value}" data-recognition ${state.recognitionMode === value ? "checked" : ""} ${disabled || !state.preferencesReady ? "disabled" : ""} /><span><strong>${title}</strong><small>${copy}</small></span></label>`;
  const recognitionChoice = `<fieldset class="recognition-choice"><legend>語音辨識位置</legend>${choice("browser", "瀏覽器串流辨識（較快，音訊送 Google）", streamingRecognitionSupported() ? "停頓後約 1～2 秒送出，不用等整段上傳。" : "此瀏覽器不支援串流辨識（建議使用 Chrome），會改用後端辨識。")}${choice("server", localLabel, "說完後上傳整段錄音辨識，一句話約需 15～20 秒。")}<small>更換辨識位置後，需要重新允許語音辨識。</small></fieldset>`;
  const row = (field, title, copy, disabled = false) => `<label class="toggle-row"><span><strong>${title}</strong><small>${copy}</small></span><input type="checkbox" data-preference="${field}" ${state[field] ? "checked" : ""} ${disabled || !state.preferencesReady ? "disabled" : ""} /><i></i></label>`;
  return `<div class="step-intro"><div class="eyebrow accent">PREFERENCES</div><h1>資料使用設定</h1><p>選擇一次，之後在這個瀏覽器沿用。訪客與不同帳號各自記住偏好；不會保存備審原檔或回答到瀏覽器設定中。你可以隨時關閉授權。</p></div><section class="setting-card permission-settings">
  ${row("consentModel", "允許 Agent 處理練習內容", modelCopy + " 未允許時無法開始 Gemini 面試。")}
  ${recognitionChoice}
  ${row("consentAudio", "允許語音辨識與教授語音", audioCopy + " 未允許時只能使用文字回答。")}
  ${row("liveVoiceConsent", "暖身對談使用 Gemini Live 即時對談", liveCopy, liveVoiceModel() === "off" || !state.consentAudio || !state.consentModel)}
  ${row("resumeConsent", "允許整理我選擇的備審 PDF", (state.agentMode === "cli" ? "PDF 送至面試後端，由 Google Gemini 整理成附頁碼的候選主張。" : "PDF 送至 Google Gemini API 整理。") + " 每次按整理才會傳送；需同時允許 Agent。未允許時可手動編輯主張。", !state.consentModel)}
  ${row("confirmClaims", "允許面試使用目前編輯的備審主張", "開始前請回查主張、檔名、頁碼與摘錄。啟用後使用當時畫面中的主張；關閉後只練習校系與通用問題。")}
  ${row("savePortfolio", "在此瀏覽器保存備審資料庫", "只保存檔名、主張、頁碼與短摘錄，不保存原始 PDF。下次可直接選用；訪客與帳號分開保存，不會同步其他裝置。共用電腦不建議啟用。關閉後會刪除已保存的資料。")}
  ${row("cameraAnalysisConsent", "啟用本機鏡頭分析（選用）", "只在此電腦即時分析，原始畫面、逐影格資料與臉部特徵不會上傳或保存。")}
  ${row("cameraMetricsConsent", "允許 Agent 使用鏡頭衍生摘要復盤", "只傳逐題涵蓋率、頭部方向與上半身位移摘要，不含畫面。需同時啟用鏡頭分析與 Agent；保存歷史時摘要也會存入私人紀錄。", !state.cameraAnalysisConsent || !state.consentModel)}
  ${row("saveHistory", "保存之後的練習到私人帳號歷史", state.auth?.authenticated ? "預計保留 24 個月，可在帳號頁匯出或刪除。匿名分享仍由每篇內容預覽後送出。" : "登入後才能啟用；訪客場次只加密暫存。", !state.auth?.authenticated)}
  </section><p class="settings-save-message" role="status">${esc(state.preferencesMessage || "目前尚未保存授權選擇。")}</p><div class="permission-summary"><strong>功能限制</strong><p>PDF 與鏡頭摘要需要 Agent 授權；語音未授權可改用文字。設備權限仍由瀏覽器管理。更換模型接入方式或語音處理服務時會重新確認。</p></div><div class="form-footer"><button class="button button-quiet" data-action="reset-permissions">關閉所有授權</button><button class="button button-primary" data-action="settings-done">返回練習流程 →</button></div>`;
}
function selectPortfolioFiles(files) {
  if (!state.libraryReady) return notify("正在載入備審資料庫，請稍候。");
  if (state.resumeParsing) return notify("PDF 正在解析，完成後再加入檔案。");
  const errors = [];
  for (const file of Array.from(files || [])) {
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 8 * 1024 * 1024) { errors.push(`${file.name}：需為非空白 PDF，每份不超過 8 MB。`); continue; }
    if (state.portfolioFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified && (item.file || item.parserVersion === PORTFOLIO_PARSER_VERSION))) continue;
    if (state.portfolioFiles.length >= 5 || state.portfolioFiles.reduce((sum, item) => sum + item.size, 0) + file.size > 24 * 1024 * 1024) { errors.push("最多 5 份 PDF，合計不超過 24 MB。"); continue; }
    state.portfolioFiles.push({ id: crypto.randomUUID(), name: file.name, size: file.size, lastModified: file.lastModified, file, selected: true, status: "pending", message: "尚未傳送" });
  }
  state.resumeParseMessage = errors.join(" ") || "新增檔案仍留在此瀏覽器；同意並按下解析後才會傳送。";
  state.resumeParseError = errors.length > 0;
  render();
}
function removePortfolioFile(id) {
  if (state.resumeParsing) return;
  state.portfolioFiles = state.portfolioFiles.filter((item) => item.id !== id);
  state.claims = state.claims.filter((claim) => claim.documentId !== id);
  void persistPortfolioLibrary();
  render();
}
function fileToBase64(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  });
}
async function parsePortfolioPdf() {
  const pending = state.portfolioFiles.filter((item) => item.file && item.status !== "done");
  if (state.resumeParsing || !pending.length || !state.libraryReady) return;
  if (!portfolioParsingAvailable()) return notify("目前無法連線 Gemini 服務，請稍後再試；你仍可手動新增主張。");
  if (!state.resumeConsent || !state.consentModel) return notify("請先在資料使用設定允許 Agent 與 PDF 整理。");
  const selectedProfile = profile();
  state.resumeParsing = true;
  state.resumeParseMessage = `依序整理 ${pending.length} 份 PDF…`;
  state.resumeParseError = false;
  render();
  let successes = 0;
  const scope = portfolioScope();
  const batchId = crypto.randomUUID();
  for (const item of pending) {
    if (scope !== portfolioScope()) break;
    item.status = "parsing";
    item.message = `第 ${pending.indexOf(item) + 1}／${pending.length} 份・正在抽取文字與整理…`;
    render();
    try {
    item.hash = await portfolioFileHash(item.file);
    const cached = state.portfolioFiles.find((other) => other.id !== item.id && other.status === "done" && other.hash === item.hash && other.parserVersion === PORTFOLIO_PARSER_VERSION);
    if (cached) {
      cached.selected = true;
      state.portfolioFiles = state.portfolioFiles.filter((other) => other.id !== item.id);
      item.file = null;
      successes++;
      state.resumeParseMessage = `${item.name} 與「${cached.name}」內容相同，已直接沿用。`;
      await persistPortfolioLibrary(); render();
      continue;
    }
    const result = await api("/api/portfolio/parse", {
      method: "POST",
      body: JSON.stringify({
        profileId: selectedProfile.id,
        customProfile: selectedProfile.customProfile || undefined,
        filename: item.name.split(/[\\/]/).at(-1).slice(0, 120),
        pdfBase64: await fileToBase64(item.file),
        consent: true,
        batchId,
      }),
    });
    if (scope !== portfolioScope()) { item.file = null; break; }
    if (state.claimsOrigin === "sample") state.claims = [];
    state.claimsOrigin = "portfolio";
    state.claims.push(...(result.claims || []).map((claim, index) => ({ ...claim, id: item.id + "-" + index, documentId: item.id, sourceFilename: item.name.split(/[\\/]/).at(-1).slice(0, 120) })));
    item.file = null;
    item.status = "done";
    item.parserVersion = result.parserVersion || PORTFOLIO_PARSER_VERSION;
    item.analyzedAt = new Date().toISOString();
    item.message = (result.claims?.length ? `已整理 ${result.claims.length} 個主張・原檔已釋放` : "未找到可核對的主張・可手動新增") + (Number.isFinite(result.elapsedMs) ? `・${(result.elapsedMs / 1000).toFixed(1)} 秒` : "");
    successes++;
    await persistPortfolioLibrary();
  } catch (error) {
    item.status = "error";
    item.message = error.message;
  }
    render();
  }
  await api("/api/portfolio/release", { method: "POST", body: JSON.stringify({ batchId }) }).catch(() => {});
  state.resumeParsing = false;
  state.resumeParseError = successes < pending.length;
  state.resumeParseMessage = `${successes}／${pending.length} 份完成。${successes < pending.length ? "成功的主張已保留；可重試未完成的檔案。" : "請依檔名、頁碼與摘錄回查原 PDF。"}`;
  render();
}
function normalizeProfile(item) {
  const official = item.profileStatus === "official_115";
  return {
    ...item,
    dept: item.department || item.dept || "",
    route: item.routeLabel || item.route || "一般模擬",
    tag: item.displayName || item.tag || item.department || item.dept || "校系情境",
    confidence: official ? `${item.academicYear || ""} 學年度官方來源` : "一般模擬・非官方資料",
    icon: item.schoolId === "fcu" ? "⌘" : "◌",
  };
}
function allProfiles() { return [...profiles, ...state.customProfiles]; }
const profile = () => allProfiles().find((p) => p.id === state.profileId) || allProfiles()[0];
const activePeople = () => state.people.map((id) => interviewers[id]).filter(Boolean);
const currentQuestion = () => state.currentEvent
  ? { topic: state.currentEvent.topic || "面試追問", role: state.currentEvent.speakerId === "logic" ? "logic" : state.currentEvent.speakerId, text: state.currentEvent.utterance || "" }
  : { topic: "準備中", role: state.people[0] || "portfolio", text: "正在準備第一個問題…" };
const elapsedText = () => Math.floor(state.elapsed / 60).toString().padStart(2, "0") + ":" + (state.elapsed % 60).toString().padStart(2, "0");
// Matches practiceBudget() in server/interview-guide.js.
const closingWindowSeconds = () => Math.max(40, Math.min(90, Math.ceil(Number(state.config.duration) * 60 * 0.15)));
const remainingText = () => Math.floor(state.remaining / 60).toString().padStart(2, "0") + ":" + (state.remaining % 60).toString().padStart(2, "0");
function notify(message) {
  toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2500);
}
async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.body instanceof Blob ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) };
  const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
  if (path !== "/api/auth/session" && !state.authReady) await refreshAuth();
  if (mutating && !state.csrfToken) await refreshAuth();
  if (mutating && state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  let response = await fetch(path, { credentials: "same-origin", ...options, headers });
  if (response.status === 204) return null;
  let result = await response.json().catch(() => ({}));
  if (mutating && response.status === 403 && result?.error?.code === "CSRF_REJECTED") {
    const session = await refreshAuth();
    headers["X-CSRF-Token"] = session.csrfToken || "";
    response = await fetch(path, { credentials: "same-origin", ...options, headers });
    if (response.status === 204) return null;
    result = await response.json().catch(() => ({}));
  }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || "服務暫時無法完成要求。"), { code: result?.error?.code || null });
  return result;
}
let authSessionRequest = null;
async function refreshAuth() {
  if (!authSessionRequest) {
    const request = fetch("/api/auth/session", { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error?.message || "無法確認登入狀態。");
        return result;
      });
    authSessionRequest = request.finally(() => { authSessionRequest = null; });
  }
  const result = await authSessionRequest;
  state.csrfToken = result.csrfToken || "";
  state.auth = result;
  state.authReady = true;
  if (state.preferencesReady && state.page !== "interview") { loadPreferences(); if (state.libraryScope !== portfolioScope()) await loadPortfolioLibrary(); }
  if (state.page !== "interview") render();
  return result;
}
async function loadAccountData() {
  if (!state.auth?.authenticated) return;
  state.accountLoading = true;
  render();
  try {
    const [account, history, sessions, mfa] = await Promise.all([
      api("/api/account"), api("/api/account/practice-sessions"), api("/api/account/sessions"), api("/api/account/mfa").catch(() => null),
    ]);
    state.account = account.account;
    state.accountHistory = history.sessions || [];
    state.accountSessions = sessions.sessions || [];
    state.accountMfa = mfa;
  } catch (error) { state.authMessage = error.message; }
  finally { state.accountLoading = false; if (state.page === "account") render(); }
}
async function openAccount() {
  if (state.resumeParsing) return notify("請等備審整理完成後再切換帳號。");
  if (state.page === "interview") { stopMedia(); stopEventStream(); }
  state.page = "account";
  state.authMessage = "";
  render();
  if (state.auth?.authenticated) await loadAccountData();
}
async function openShare() {
  if (state.page === "interview") { stopMedia(); stopEventStream(); }
  state.page = "share";
  state.sharePreview = null;
  state.shareResult = null;
  state.shareWithdrawalMessage = "";
  state.shareDraft = null;
  try { state.sharePolicy = (await api("/api/reports/share-policy")).policy; }
  catch (error) { state.authMessage = error.message; }
  render();
}
async function loadProfiles() {
  try {
    const result = await api("/api/profiles");
    if (!Array.isArray(result.profiles) || !result.profiles.length) throw new Error("伺服器目前沒有可用的校系情境。");
    profiles = result.profiles.map(normalizeProfile);
    if (!allProfiles().some((item) => item.id === state.profileId)) state.profileId = profiles[0].id;
    if (state.page !== "interview") render();
  } catch (error) {
    state.profileLoadError = error.message;
    if (state.page === "profile") notify("校系清單尚未從伺服器載入，請稍後重試。");
  }
}
async function selectProfile(id) {
  const custom = state.customProfiles.find((item) => item.id === id);
  if (custom) { state.profileId = id; render(); return; }
  try {
    const result = await api("/api/profiles/" + encodeURIComponent(id));
    const detail = normalizeProfile(result.profile);
    profiles = profiles.map((item) => item.id === id ? detail : item);
    state.profileId = id;
    render();
  } catch (error) {
    notify(error.message);
  }
}
async function submitCustomProfile(form) {
  const fields = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "建立中…";
  try {
    const result = await api("/api/profiles/custom", { method: "POST", body: JSON.stringify(fields) });
    const custom = normalizeProfile(result.profile);
    custom.customProfile = { school: custom.school, department: custom.dept, routeLabel: custom.route };
    state.customProfiles.push(custom);
    state.profileId = custom.id;
    state.customProfileOpen = false;
    render();
    notify("已建立一般模擬情境；沒有套用校系官方資料。");
  } catch (error) {
    submit.disabled = false;
    submit.textContent = "建立模擬情境";
    notify(error.message);
  }
}
function stopEventStream() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
}
function acceptInterviewEvent(event) {
  if (!event || (event.seq && event.seq <= state.eventSequence)) return;
  if (event.seq) state.eventSequence = event.seq;
  if (event.type === "interview.closing") {
    showInterviewClosing(event);
  } else if (event.type === "interview.event") {
    if (event.live && liveLink) { acceptLiveQuestion(event); return; }
    if (liveLink) leaveLiveMode(event.liveFallback ? "即時對談中斷，改用回合制繼續。" : "");
    if (state.finishing || state.closing) return;
    stopQuestionAudio();
    discardRecording();
    state.currentEvent = event;
    state.cameraPhase = event.phase === "follow_up" ? "follow_up_visible_window" : "question_visible_window";
    state.waitingForAgent = false;
    state.transcribing = false;
    state.nudgePending = false;
    state.followUp = event.phase === "follow_up" ? event.utterance : "";
    const turnIndex = state.backendTurns.findIndex((turn) => turn.turnId === event.turnId);
    if (turnIndex >= 0) state.q = turnIndex;
    else if (state.backendTurns.length === 0 || state.backendTurns.at(-1)?.turnId !== event.turnId) {
      state.backendTurns.push({ turnId: event.turnId, roleId: event.roleId, speakerId: event.speakerId, questionText: event.utterance, answerText: "", followUps: [] });
      state.q = state.backendTurns.length - 1;
    }
    if (event.phase === "follow_up") {
      const turn = state.backendTurns.find((item) => item.turnId === event.turnId);
      if (turn && !turn.followUps.includes(event.utterance)) turn.followUps.push(event.utterance);
    }
    // Words recognized before Live dropped stay in the answer box.
    if (event.liveFallback?.draftText && !state.draft.trim()) state.draft = event.liveFallback.draftText;
    prepareQuestion(event);
    if (state.page === "interview") render();
    if (event.audioUrl && state.voiceEnabled) playAudio(event.audioUrl, event.seq);
  } else if (event.type === "answer.received") {
    if (liveLink) leaveLiveMode("即時對談中斷，教授改用回合制接著問。");
    stopQuestionAudio();
    discardRecording();
    interviewTiming.pause("thinking");
    state.waitingForAgent = true;
    if (event.schoolMentionRedacted) notify("提醒：正式面試通常不宜透露就讀學校。這段回答中的校名已在送給教授 Agent 前遮蔽。");
    if (state.page === "interview") render();
  } else if (event.type === "interview.audio.ready") {
    if (state.voiceEnabled && event.audioUrl && event.eventSeq === state.currentEvent?.seq) playAudio(event.audioUrl, event.eventSeq);
  } else if (event.type === "review.ready") {
    state.review = event.review;
    state.reviewError = null;
    state.waitingForAgent = false;
    stopEventStream();
    if (state.page === "review") render();
  } else if (event.type === "review.failed") {
    state.waitingForAgent = false;
    state.reviewError = event.message || "復盤暫時無法完成，請重試。";
    notify(event.message || "復盤暫時無法完成。");
    if (state.page === "review") render();
  } else if (event.type === "error" || event.type === "speech.warning") {
    if (event.type === "speech.warning" && event.eventSeq !== state.currentEvent?.seq) return;
    state.waitingForAgent = false;
    if (event.type === "error" && event.recoverable && state.currentEvent) {
      const turn = state.backendTurns.find((item) => item.turnId === state.currentEvent.turnId);
      if (turn?.answerText) { state.draft = turn.answerText; turn.answerText = ""; }
    }
    if (event.type === "speech.warning" && state.closing) { void completeInterviewReview(); return; }
    if (state.finishing || state.closing) return;
    if (event.type === "speech.warning") beginListening(state.currentEvent?.seq);
    else { interviewTiming.listen(); state.voiceRetryRequired = true; }
    notify(event.message || "服務暫時無法完成要求。");
    if (state.page === "interview") render();
  }
}
function connectEventStream() {
  stopEventStream();
  if (!state.sessionId) return;
  const source = new EventSource("/api/sessions/" + encodeURIComponent(state.sessionId) + "/events?after=" + state.eventSequence);
  state.eventSource = source;
  source.onmessage = (message) => {
    try { acceptInterviewEvent(JSON.parse(message.data)); } catch { /* Ignore malformed server events. */ }
  };
  source.onerror = () => {
    if (state.page === "interview" && state.sessionId) notify("連線中斷，正在重新連接面試事件。");
  };
}
function stopQuestionAudio() {
  clearTimeout(audioPreparationTimer);
  audioPreparationTimer = null;
  if (questionAudio) { questionAudio.pause(); questionAudio.src = ""; }
  questionAudio = null;
  state.playbackBlocked = false;
}
function prepareQuestion(event) {
  audioPlayedSequence = null;
  candidateActivitySequence = null;
  state.voiceRetryRequired = false;
  // A question Live already said is not synthesized again.
  const spoken = Boolean(event.alreadySpoken || event.live);
  interviewTiming.question(event, state.voiceEnabled && !spoken);
  if (state.voiceEnabled && !spoken) {
    audioPreparationTimer = setTimeout(() => {
      if (state.currentEvent?.seq !== event.seq || interviewTiming.phase !== "preparing") return;
      audioPlayedSequence = event.seq;
      notify("語音尚未就緒，可先閱讀字幕並回答。");
      beginListening(event.seq);
    }, 20000);
  } else beginListening(event.seq);
}
function beginListening(sequence) {
  if (state.page !== "interview" || state.finishing || state.closing || state.waitingForAgent || !interviewTiming.listen(sequence)) return;
  state.playbackBlocked = false;
  state.cameraPhase = "question_response_transition";
  if (state.voiceEnabled && !state.muted && !state.voiceRetryRequired && !state.draft.trim()) startVoiceCapture();
  updateConversationHud();
}
function playAudio(url, sequence) {
  if (state.closing && state.currentEvent?.seq === sequence) { playClosingAudio(url, sequence); return; }
  if (state.page !== "interview" || state.waitingForAgent || state.currentEvent?.seq !== sequence || audioPlayedSequence === sequence || state.voiceDetected || state.draft.trim()) return;
  stopQuestionAudio();
  discardRecording();
  audioPlayedSequence = sequence;
  const event = state.currentEvent;
  const audio = new Audio(url);
  questionAudio = audio;
  interviewTiming.pause("preparing");
  audio.addEventListener("play", () => {
    if (questionAudio !== audio || state.currentEvent?.seq !== sequence) return;
    interviewTiming.speaking(sequence);
    state.playbackBlocked = false;
    state.cameraPhase = event.phase === "follow_up" ? "follow_up_listening" : "question_listening";
    updateConversationHud();
  });
  audio.addEventListener("ended", () => {
    if (questionAudio !== audio || state.currentEvent?.seq !== sequence) return;
    questionAudio = null;
    beginListening(sequence);
  }, { once: true });
  audio.addEventListener("error", () => {
    if (questionAudio !== audio) return;
    questionAudio = null;
    notify("這段語音無法播放，請閱讀字幕回答。");
    beginListening(sequence);
  }, { once: true });
  void tryQuestionPlayback(audio, sequence);
}
async function tryQuestionPlayback(audio = questionAudio, sequence = state.currentEvent?.seq) {
  if (!audio) return;
  try { await audio.play(); }
  catch {
    if (questionAudio !== audio || state.currentEvent?.seq !== sequence) return;
    state.playbackBlocked = true;
    if (state.closing) clearTimeout(closingTimer);
    interviewTiming.pause("playback_blocked");
    render();
  }
}

function showInterviewClosing(event) {
  if (state.page !== "interview" || state.currentEvent?.type === "interview.closing") return;
  // A Live farewell was already received; let its audio finish before the review.
  if (liveLink) leaveLiveMode("", { drain: Boolean(event.live) });
  const liveFarewellMs = event.live ? Math.max(0, liveDrainUntil - Date.now()) : 0;
  stopQuestionAudio(); discardRecording(); stopAudioMonitor();
  state.closing = true; state.finishing = true; state.confirmEnd = false;
  state.currentEvent = event; state.followUp = ""; state.draft = "";
  state.endReason = event.reason || "completed";
  state.waitingForAgent = true; state.nudgePending = false;
  state.cameraPhase = "agent_transition";
  interviewTiming.pause("closing"); audioPlayedSequence = null;
  render();
  // Wait for speech readiness. The visible courtesy text remains usable if TTS fails.
  clearTimeout(closingTimer);
  closingTimer = setTimeout(() => { void completeInterviewReview(); }, event.live ? liveFarewellMs + 1200 : state.voiceEnabled ? 10000 : 2800);
  if (event.audioUrl && state.voiceEnabled) playClosingAudio(event.audioUrl, event.seq);
}
function playClosingAudio(url, sequence) {
  if (!state.closing || state.page !== "interview" || state.currentEvent?.seq !== sequence || audioPlayedSequence === sequence) return;
  stopQuestionAudio(); audioPlayedSequence = sequence;
  const audio = new Audio(url); questionAudio = audio;
  audio.addEventListener("play", () => {
    if (questionAudio !== audio || state.currentEvent?.seq !== sequence) return;
    clearTimeout(closingTimer);
    closingTimer = setTimeout(() => { void completeInterviewReview(); }, 20000);
    state.playbackBlocked = false; interviewTiming.pause("closing"); updateConversationHud();
  });
  audio.addEventListener("ended", () => {
    if (questionAudio !== audio || state.currentEvent?.seq !== sequence) return;
    questionAudio = null; void completeInterviewReview();
  }, { once: true });
  audio.addEventListener("error", () => {
    if (questionAudio !== audio) return;
    questionAudio = null; void completeInterviewReview();
  }, { once: true });
  void tryQuestionPlayback(audio, sequence);
}

function cameraContext() {
  return {
    turnId: state.currentEvent?.turnId || null,
    speakerId: state.currentEvent?.speakerId || null,
    phase: state.cameraPhase || "unclassified",
  };
}

function ensureCameraPanel() {
  let panel = document.getElementById("camera-trial-panel");
  if (panel) return panel;
  panel = document.createElement("aside");
  panel.id = "camera-trial-panel";
  panel.className = "camera-trial-panel is-collapsed";
  panel.setAttribute("aria-label", "本機鏡頭試測");
  panel.innerHTML = '<div class="camera-trial-heading"><span><i></i>本機鏡頭試測</span><div class="camera-trial-actions"><button type="button" data-camera-demo aria-pressed="false" title="右下角放大鏡頭並畫出追蹤點，錄製展示影片用">展示</button><button type="button" data-camera-panel-toggle aria-expanded="false">展開</button><button type="button" data-camera-stop aria-label="停止本機鏡頭試測">停止</button></div></div><div class="camera-trial-content"><div class="camera-trial-stage"><video id="camera-trial-video" autoplay playsinline muted></video><canvas class="camera-pose-overlay" aria-hidden="true"></canvas><span class="camera-demo-tag"><i></i>MediaPipe 即時追蹤</span><div class="camera-demo-badges" aria-live="polite"><span data-badge="gaze">視線<strong>—</strong></span><span data-badge="posture">坐姿<strong>—</strong></span></div></div><small class="camera-demo-caption">臉部 478 點＋上半身骨架・本機分析，畫面不上傳</small><div class="camera-trial-status" id="camera-trial-status">正在準備模型…</div><div class="camera-trial-metrics"><span>臉部可用<strong id="camera-face-quality">—</strong></span><span>肩部可用<strong id="camera-pose-quality">—</strong></span><span>視線<strong id="camera-head-direction">—</strong></span><span>坐姿<strong id="camera-posture">—</strong></span><span>上半身移動<strong id="camera-body-motion">—</strong></span></div><button type="button" class="camera-recalibrate" data-camera-recalibrate>重新校正</button><div class="camera-trial-phase" id="camera-trial-phase">等候面試事件</div><small>畫面與數值僅留在此瀏覽器・不保存</small></div>';
  const toggle = panel.querySelector("[data-camera-panel-toggle]");
  toggle.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("is-collapsed");
    toggle.textContent = collapsed ? "展開" : "縮小";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });
  panel.querySelector("[data-camera-stop]").addEventListener("click", () => stopCameraTrial());
  panel.querySelector("[data-camera-recalibrate]").addEventListener("click", () => cameraAnalyzer?.recalibrate?.());
  panel.querySelector("[data-camera-demo]").addEventListener("click", () => setCameraDemo(!panel.classList.contains("is-demo")));
  document.body.appendChild(panel);
  let remembered = false;
  try { remembered = window.localStorage?.getItem(CAMERA_DEMO_KEY) === "on"; } catch {}
  if (remembered) setCameraDemo(true, { remember: false });
  return panel;
}

function setCameraDemo(enabled, { remember = true } = {}) {
  const panel = document.getElementById("camera-trial-panel");
  if (!panel) return;
  panel.classList.toggle("is-demo", enabled);
  const button = panel.querySelector("[data-camera-demo]");
  button.setAttribute("aria-pressed", String(enabled));
  button.textContent = enabled ? "一般" : "展示";
  if (enabled && panel.classList.contains("is-collapsed")) panel.querySelector("[data-camera-panel-toggle]").click();
  poseOverlay ||= createPoseOverlay(panel.querySelector(".camera-pose-overlay"), panel.querySelector("video"));
  if (enabled) poseOverlay.start(); else poseOverlay.stop();
  cameraAnalyzer.setOverlay?.(enabled);
  if (!remember) return;
  try { window.localStorage?.setItem(CAMERA_DEMO_KEY, enabled ? "on" : "off"); } catch {}
}

function updateCameraHud(summary) {
  state.cameraAnalysisSummary = summary;
  const panel = document.getElementById("camera-trial-panel");
  if (!panel) return;
  panel.dataset.status = summary.status;
  const labels = {
    loading: "載入模型中…",
    "loading-model": "載入本機視覺模型中…",
    calibrating: "校正中：請坐正、看著考官約 3 秒",
    measuring: "正在量測・本機處理",
    unavailable: summary.errorMessage || "模型無法使用",
    stopped: "試測已停止",
  };
  panel.querySelector("#camera-trial-status").textContent = labels[summary.status] || labels.loading;
  const matching = summary.segments.find((item) => item.turnId === state.currentEvent?.turnId && item.phase === state.cameraPhase);
  const latest = summary.latest;
  panel.querySelector("#camera-face-quality").textContent = matching ? percent(matching.faceCoverage) : latest?.faceValid ? "有效" : "等待";
  panel.querySelector("#camera-pose-quality").textContent = matching ? percent(matching.poseCoverage) : latest?.poseValid ? "有效" : "等待";
  const badges = liveBadges(summary);
  panel.querySelector("#camera-head-direction").textContent = badges.gaze.value;
  panel.querySelector("#camera-posture").textContent = badges.posture.value;
  Object.entries(badges).forEach(([key, badge]) => {
    const chip = panel.querySelector(`[data-badge="${key}"]`);
    chip.dataset.tone = badge.tone;
    chip.querySelector("strong").textContent = badge.value;
  });
  const motion = latest?.torsoDisplacementPerSecond;
  panel.querySelector("#camera-body-motion").textContent = Number.isFinite(motion) ? `${motion.toFixed(2)} 肩寬/秒` : "累積中";
  const phaseLabels = {
    question_listening: "教授實際語音播放",
    follow_up_listening: "追問語音播放",
    question_visible_window: "題目顯示期間（非實際發話）",
    follow_up_visible_window: "追問文字顯示期間",
    candidate_answer: "回答輸入／作答期間",
    question_response_transition: "題目與回答轉換",
    agent_transition: "教授準備下一題",
    unclassified: "未分類時段",
  };
  panel.querySelector("#camera-trial-phase").textContent = `${state.currentEvent ? `${interviewers[state.currentEvent.speakerId]?.name || "考官"}・` : ""}${phaseLabels[state.cameraPhase] || state.cameraPhase}・${summary.actualFps.toFixed(1)} FPS`;
}

async function startCameraTrial() {
  const videoTrack = state.stream?.getVideoTracks().find((track) => track.readyState === "live");
  if (!videoTrack) return notify("本場鏡頭試測需要先在設備檢查頁啟用攝影機。你仍可略過鏡頭完成面試。");
  if (state.cameraAnalysisActive) return;
  const generation = ++cameraTrialGeneration;
  const panel = ensureCameraPanel();
  panel.hidden = false;
  const video = panel.querySelector("video");
  const previewStream = new MediaStream([videoTrack]);
  video.pause();
  video.srcObject = null;
  video.srcObject = previewStream;
  videoTrack.addEventListener("ended", () => { if (state.cameraAnalysisActive) stopCameraTrial(); }, { once: true });
  state.cameraAnalysisActive = true;
  try {
    await video.play();
    if (generation !== cameraTrialGeneration || !state.cameraAnalysisActive || video.srcObject !== previewStream) return;
    await cameraAnalyzer.start({ video, getContext: cameraContext });
  } catch (error) {
    if (generation !== cameraTrialGeneration || !state.cameraAnalysisActive || video.srcObject !== previewStream) return;
    if (error.message === "鏡頭試測已停止。") return;
    const failedSummary = cameraAnalyzer.stop();
    const errorMessage = error.name === "AbortError"
      ? "鏡頭預覽剛重新載入，面試不受影響；可重新啟動試測。"
      : error.name === "NotAllowedError"
        ? "瀏覽器未允許播放鏡頭預覽，請確認此網站的鏡頭權限。"
        : error.message || failedSummary.errorMessage || "鏡頭試測無法啟動。";
    state.cameraAnalysisSummary = { ...failedSummary, status: "unavailable", errorMessage };
    state.cameraAnalysisActive = false;
    state.stream?.getVideoTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    panel.querySelector("#camera-trial-status").textContent = errorMessage;
    if (state.page === "interview") notify("鏡頭試測目前無法啟動；面試仍可繼續。請確認網路可載入本機視覺模型。");
  }
}

function stopCameraTrial() {
  cameraTrialGeneration++;
  if (state.cameraAnalysisActive) state.cameraAnalysisSummary = cameraAnalyzer.stop();
  state.cameraAnalysisActive = false;
  poseOverlay?.update(null);
  state.stream?.getVideoTracks().forEach((track) => track.stop());
  const panel = document.getElementById("camera-trial-panel");
  if (panel) {
    const video = panel.querySelector("video");
    video?.pause();
    if (video) video.srcObject = null;
    panel.hidden = true;
  }
  if (state.page === "interview") notify("鏡頭試測已停止，鏡頭畫面已關閉。");
}

let liveLink = null;
let liveProbePromise = null;
let liveDrainUntil = 0;
const liveVoiceActivity = new VoiceActivityDetector();
let liveVoiceAt = 0;
let liveProfessorTurn = false;
let liveNudges = 0;
let liveNudgeTimer = null;
// After the student stops, Live replies in about 1-3 s; until then it is not the student's turn.
let liveAwaitingReply = false;
let liveReplyTimer = null;
// One short Live connection on the device page; a failure keeps this session turn-based until "再試一次".
function maybeProbeLive(force = false) {
  if (liveProbePromise) return liveProbePromise;
  if (!liveEligible() || !liveConsented()) return null;
  const probe = state.liveProbe;
  if (!force && !(probe.status === "idle" || (probe.status === "ok" && Date.now() - probe.at > 60000))) return null;
  state.liveProbe = { status: "checking", at: Date.now() };
  liveProbePromise = api("/api/live/probe", { method: "POST", body: "{}" })
    .then((result) => { state.liveProbe = result.available ? { status: "ok", at: Date.now(), latencyMs: result.latencyMs } : { status: "failed", at: Date.now(), reason: result.reason, message: result.message }; })
    .catch((error) => { state.liveProbe = { status: "failed", at: Date.now(), reason: "unavailable", message: error.message }; })
    .finally(() => { liveProbePromise = null; if (state.page === "device" && !state.sessionStarting) render(); });
  return liveProbePromise;
}
async function startLiveConversation(ticket) {
  const sessionId = state.sessionId;
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/sessions/" + encodeURIComponent(sessionId) + "/live?ticket=" + encodeURIComponent(ticket);
  liveVoiceActivity.reset(); liveVoiceAt = 0; liveProfessorTurn = false; liveNudges = 0;
  const link = new LiveAudioLink({
    url, stream: state.stream,
    onMessage: (message) => { if (liveLink === link) onLiveMessage(message); },
    onClose: () => { if (liveLink === link) leaveLiveMode("即時對談連線中斷，改用回合制繼續。"); },
    onPlaybackStart: (startsAt) => { if (liveLink === link) onLivePlaybackStart(startsAt); },
    onPlaybackIdle: () => { if (liveLink === link) onLivePlaybackIdle(); },
    onChunk: (rms, now, playing) => { if (liveLink === link) onLiveChunk(rms, now, playing); },
  });
  liveLink = link;
  try { await link.start(); }
  catch (error) {
    // The server sees the closed socket and continues turn-based.
    if (liveLink === link) leaveLiveMode(error.message + " 改用回合制繼續。");
  }
}
function leaveLiveMode(message = "", { drain = false, rerender = true } = {}) {
  const link = liveLink;
  if (!link) return;
  liveLink = null;
  liveDrainUntil = drain ? Date.now() + link.remainingPlaybackMs() : 0;
  clearTimeout(liveNudgeTimer);
  clearTimeout(liveReplyTimer);
  liveAwaitingReply = false;
  link.close({ drain });
  state.nudgePending = false;
  state.liveCaption = "";
  liveVoiceActivity.reset();
  if (message) { state.liveNotice = "已改用回合制"; notify(message); }
  if (state.page !== "interview") return;
  if (!state.closing && !state.finishing && ["speaking", "preparing", "capturing", "nudge"].includes(interviewTiming.phase)) interviewTiming.pause("thinking");
  if (rerender) render();
}
function liveListen() {
  if (state.closing || state.finishing || !liveLink) return;
  interviewTiming.listen();
  state.cameraPhase = "question_response_transition";
  updateConversationHud();
}
function acceptLiveQuestion(event) {
  if (state.finishing || state.closing) return;
  state.currentEvent = event;
  state.waitingForAgent = false;
  state.nudgePending = false;
  clearTimeout(liveNudgeTimer);
  state.followUp = event.phase === "follow_up" ? event.utterance : "";
  state.liveCaption = "";
  if (event.phase !== "follow_up") liveNudges = 0;
  const turnIndex = state.backendTurns.findIndex((turn) => turn.turnId === event.turnId);
  if (turnIndex >= 0) state.q = turnIndex;
  else {
    state.backendTurns.push({ turnId: event.turnId, roleId: event.roleId, speakerId: event.speakerId, questionText: event.utterance, answerText: "", followUps: [] });
    state.q = state.backendTurns.length - 1;
  }
  if (event.phase === "follow_up") {
    const turn = state.backendTurns.find((item) => item.turnId === event.turnId);
    if (turn && !turn.followUps.includes(event.utterance)) turn.followUps.push(event.utterance);
  }
  interviewTiming.question(event, true);
  if (liveLink.audioQueued) interviewTiming.pause("speaking"); else liveListen();
  if (state.page === "interview") render();
}
function onLiveMessage(message) {
  if (message.type === "ready") { state.liveNotice = ""; render(); }
  else if (message.type === "output") {
    liveProfessorTurn = true;
    state.liveCaption = message.text;
    const caption = app.querySelector(".caption-bubble p");
    if (caption) caption.textContent = message.text;
  } else if (message.type === "input") showLiveTranscript(message.text);
  else if (message.type === "turn") {
    liveProfessorTurn = message.speaker === "professor";
    liveAwaitingReply = false;
    clearTimeout(liveReplyTimer);
    if (liveProfessorTurn) {
      clearTimeout(liveNudgeTimer);
      state.nudgePending = false;
      clearLiveTranscript();
      if (interviewTiming.phase !== "speaking") interviewTiming.pause("thinking");
    } else if (!liveLink.audioQueued) liveListen();
    updateConversationHud();
  } else if (message.type === "interrupted") liveLink.flush();
  else if (message.type === "anonymity") notify(message.message);
  else if (message.type === "fallback") {
    if (message.draftText && !state.draft.trim()) state.draft = message.draftText;
    leaveLiveMode(message.message || "即時對談中斷，改用回合制繼續。");
  } else if (message.type === "ended") leaveLiveMode("", { drain: true });
  else if (message.type === "resumed") console.info("[VivaPrep] Gemini Live 已重新連線");
}
// Measured from the last moment the student's voice was above speech level to
// when the professor's first audio actually starts playing.
function onLivePlaybackStart(startsAt) {
  if (liveVoiceAt) {
    const ms = Math.max(0, Math.round(startsAt - liveVoiceAt));
    liveVoiceAt = 0;
    liveLink.send({ type: "latency", ms });
    voiceLatencies.push({ liveResponseMs: ms });
    if (voiceLatencies.length > 20) voiceLatencies.shift();
    console.info(`[VivaPrep] Gemini Live：說完到教授開口 ${ms} ms`);
  }
  interviewTiming.pause("speaking");
  state.cameraPhase = "question_listening";
  updateConversationHud();
}
function onLivePlaybackIdle() {
  if (state.closing) return;
  // Audio arrives faster than real time; a gap mid-turn is not the end of the question.
  if (liveProfessorTurn) interviewTiming.pause("thinking");
  else liveListen();
  updateConversationHud();
}
function onLiveChunk(rms, now, playing) {
  microphoneLevel = rms;
  const listening = !playing && !liveProfessorTurn && (liveAwaitingReply || ["listening", "capturing", "nudge"].includes(interviewTiming.phase));
  const transition = liveVoiceActivity.update(rms, now, 100, { listening });
  if (!listening) return;
  if (transition === "start") { liveAwaitingReply = false; clearTimeout(liveReplyTimer); interviewTiming.pause("capturing"); state.cameraPhase = "candidate_answer"; reportCandidateActivity(); updateConversationHud(); }
  // The raw chunk level, not the smoothed one, so the end of speech is not reported late.
  if (liveVoiceActivity.speaking && rms >= liveVoiceActivity.continueThreshold) { liveVoiceAt = now; interviewTiming.activity(); }
  if (transition === "end") {
    // Speaking again keeps the answer going; no reply within 6 s hands the turn back.
    liveAwaitingReply = true;
    interviewTiming.pause("thinking");
    clearTimeout(liveReplyTimer);
    liveReplyTimer = setTimeout(() => { if (liveAwaitingReply && !liveProfessorTurn) { liveAwaitingReply = false; liveListen(); } }, 6000);
    updateConversationHud();
  }
}
function stopMedia() {
  if (liveLink) leaveLiveMode("", { rerender: false });
  clearTimeout(closingTimer);
  interviewTiming.pause("ended");
  stopQuestionAudio();
  discardRecording();
  voiceRequestGeneration++;
  stopAudioMonitor();
  cameraTrialGeneration++;
  if (state.cameraAnalysisActive) state.cameraAnalysisSummary = cameraAnalyzer.stop();
  state.cameraAnalysisActive = false;
  poseOverlay?.update(null);
  const cameraPanel = document.getElementById("camera-trial-panel");
  if (cameraPanel) {
    const video = cameraPanel.querySelector("video");
    video?.pause();
    if (video) video.srcObject = null;
    cameraPanel.hidden = true;
  }
  if (state.recorder?.state === "recording") {
    state.recorder.onstop = null;
    state.recorder.stop();
  }
  state.recorder = null; state.recordedChunks = []; state.recording = false;
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null; state.deviceReady = false; state.audioReady = false;
}
function go(page) {
  if (state.resumeParsing && ["profile", "resume", "setup", "device", "interview", "account"].includes(page)) return notify("備審正在整理，請完成後再開始面試或切換帳號。");
  if (state.sessionStarting) return;
  if (state.page === "interview" && page !== "interview") { stopMedia(); stopEventStream(); }
  if (state.page === "device" && page !== "device") stopMedia();
  if (page !== "review" && (state.page === "review" || state.page === "interview")) {
    state.cameraAnalysisSummary = null;

  }
  state.page = page; state.confirmEnd = false; render(); window.scrollTo({ top: 0, behavior: "smooth" });
}
function sideNav() {
  const current = steps.findIndex((s) => s[0] === state.page);
  const providerLabel = agentLabel();
  return `<aside class="sidebar"><a class="brand-lockup" href="#" data-action="home"><span class="brand-mark">V</span><span><strong>VivaPrep</strong><small>面試練習室</small></span></a>
  <div class="sidebar-label">我的練習</div><button class="nav-home ${state.page === "home" ? "is-active" : ""}" data-action="home"><span class="nav-home-icon">⌂</span>練習總覽<span class="nav-chevron">›</span></button><button class="nav-home ${state.page === "library" ? "is-active" : ""}" data-action="library"><span class="nav-home-icon">▤</span>備審資料庫<span class="nav-chevron">›</span></button><div class="sidebar-label sidebar-label-spaced">準備流程</div>
  <ol class="workflow-nav">${steps.map((s, i) => { const done = current > i || state.page === "review", here = state.page === s[0]; return `<li class="${here ? "is-current" : ""} ${done ? "is-done" : ""}"><button data-action="step" data-page="${s[0]}" ${done || here ? "" : "disabled"}><span class="step-number">${done ? "✓" : String(i + 1).padStart(2, "0")}</span><span class="step-copy"><strong>${s[1]}</strong><small>${s[2]}</small></span></button></li>`; }).join("")}</ol>
  <div class="sidebar-label sidebar-label-spaced">帳號與分享</div><button class="nav-home ${state.page === "account" ? "is-active" : ""}" data-action="account"><span class="nav-home-icon">◎</span>帳號與練習歷史<span class="nav-chevron">›</span></button><button class="nav-home ${state.page === "settings" ? "is-active" : ""}" data-action="settings"><span class="nav-home-icon">⚙</span>資料使用設定<span class="nav-chevron">›</span></button><button class="nav-home ${state.page === "share" ? "is-active" : ""}" data-action="share"><span class="nav-home-icon">↗</span>匿名分享心得<span class="nav-chevron">›</span></button>
  <div class="sidebar-spacer"></div><div class="privacy-note"><span class="privacy-mark">◈</span><div><strong>練習資料加密暫存</strong><p>依資料使用設定處理與保存；可以在設定隨時關閉。</p></div></div><div class="sidebar-footer"><span class="status-dot"></span> ${providerLabel}・情境來源依學年度標示</div></aside>`;
}
function header() {
  const index = steps.findIndex((s) => s[0] === state.page);
  const title = { home: "個人申請・練習工作台", profile: "選擇校系情境", resume: "選用備審內容", library: "備審資料庫", setup: "設定面試情境", device: "設備檢查", review: "面試復盤", account: "帳號與隱私", share: "匿名分享心得", settings: "資料使用設定" }[state.page] || "VivaPrep";
  const accountLabel = state.auth?.authenticated ? (state.auth.user?.displayName || "我的帳號") : "訪客・登入";
  return `<header class="topbar"><div class="topbar-left">${state.page === "home" ? `<span class="eyebrow">${title}</span>` : `<button class="back-link" data-action="back">← <span>返回</span></button><span class="topbar-divider"></span><span class="eyebrow">${title}</span>`}</div><div class="topbar-right">${index >= 0 ? `<div class="progress-pill"><span>準備進度</span><strong>${Math.max(1, index + 1)} <i>/ 6</i></strong></div>` : ""}<button class="button button-quiet settings-shortcut" data-action="settings">⚙ 設定</button><button class="profile-chip" data-action="account"><span class="profile-avatar">${state.auth?.authenticated ? esc((state.auth.user?.displayName || "U").slice(0, 1)) : "訪"}</span><span>${esc(accountLabel)}</span></button></div></header>`;
}
function shell(content, klass = "") {
  document.body.classList.remove("is-interview");
  return `<div class="app-shell">${sideNav()}<main class="main-column ${klass}">${header()}<div class="page-content">${content}</div></main></div>`;
}
function intro(n, title, desc) {
  return `<div class="step-intro"><div class="eyebrow accent">STEP 0${n + 1} / 06</div><h1>${title}</h1><p>${desc}</p><div class="step-progress">${[0,1,2,3].map((i) => `<span class="${i <= n ? "is-filled" : ""}"></span>`).join("")}</div></div>`;
}
function homePage() {
  const p = profile();
  return `<section class="welcome-row"><div><div class="eyebrow accent">星期一・練習計畫</div><h1>把準備過的經歷，<br /><em>說成清楚的回答。</em></h1><p>先整理備審中的主張，再練習教授可能如何追問。</p><button class="button button-primary button-large" data-action="step" data-page="profile">開始一場模擬 <span>→</span></button></div><div class="welcome-illustration"><div class="sun-disc"></div><div class="arch"></div><div class="table-line"></div><div class="plant plant-one">✳</div><div class="plant plant-two">✳</div><div class="illustration-caption"><span>01</span><span>一步一步，練習自己的故事</span></div></div></section>
  <div class="section-heading"><div><span class="eyebrow">YOUR NEXT STEP</span><h2>準備好開始了嗎？</h2></div><button class="text-link" data-action="step" data-page="profile">查看完整流程 <span>→</span></button></div>
  <section class="dashboard-grid"><button class="next-card" data-action="step" data-page="profile"><span class="card-icon card-icon-warm">↗</span><span class="card-meta">預計 3 分鐘</span><strong>挑選練習校系</strong><small>從目標校系開始，建立適合你的提問情境。</small><span class="card-arrow">→</span></button><article class="last-session-card"><div class="section-heading small-heading"><div><span class="eyebrow">練習設定</span><h3>目前的情境</h3></div><span class="session-dot"></span></div><div class="mini-profile"><span class="mini-school-mark">F</span><div><strong>${p.school}・${p.dept}</strong><small>${p.route}</small></div></div><div class="session-foot"><span>語音練習</span><span>·</span><span>三位考官</span><button data-action="step" data-page="profile">›</button></div></article><button class="next-card" data-action="account"><span class="card-icon card-icon-warm">◎</span><span class="card-meta">資料管理</span><strong>${state.auth?.authenticated ? "查看我的練習歷史" : "登入後保存練習"}</strong><small>帳號資料、練習歷史、匯出與刪除設定都在這裡。</small><span class="card-arrow">→</span></button><button class="next-card" data-action="share"><span class="card-icon card-icon-warm">✳</span><span class="card-meta">自願參與・匿名分享</span><strong>分享面試心得</strong><small>先預覽去識別內容，獨立同意後送交審核。</small><span class="card-arrow">→</span></button><button class="next-card" data-action="library"><span class="card-icon card-icon-warm">▤</span><span class="card-meta">整理一次・重複選用</span><strong>我的備審資料庫</strong><small>匯入與核對主張，下一場面試直接選用。</small><span class="card-arrow">→</span></button><article class="trust-card"><span class="trust-star">✳</span><div><strong>練習，不是預測</strong><p>VivaPrep 幫你準備表達，不預測錄取結果，也不代表校系官方流程。</p></div></article></section>
  <section class="approach-row"><div><span class="eyebrow">VIVAPREP METHOD</span><h2>不是背題庫，<br />而是練習回答自己的故事。</h2></div><div class="approach-steps"><div><span>01</span><strong>準備</strong><small>整理備審主張</small></div><i>→</i><div><span>02</span><strong>練習</strong><small>回應有根據的追問</small></div><i>→</i><div><span>03</span><strong>復盤</strong><small>帶著下一步再練</small></div></div></section>`;
}
function customProfileForm() {
  return `<form class="custom-profile-form" data-form="custom-profile"><div><strong>自訂一般模擬情境</strong><small>資料會送到本機伺服器建立本場情境，不會標示為官方資訊。</small></div><label>學校名稱<input name="school" maxlength="80" required placeholder="例如：國立○○大學" /></label><label>科系名稱<input name="department" maxlength="80" required placeholder="例如：資訊工程學系" /></label><label>申請管道<input name="routeLabel" maxlength="80" required value="個人申請・一般模擬" /></label><div class="custom-profile-actions"><button class="button button-quiet" type="button" data-action="cancel-custom-profile">取消</button><button class="button button-primary" type="submit">建立模擬情境</button></div></form>`;
}
function profilePage() {
  const p = profile();
  const currentProfiles = allProfiles();
  const cards = currentProfiles.map((item) => `<button class="profile-card ${p.id === item.id ? "is-selected" : ""}" data-action="profile" data-id="${esc(item.id)}"><span class="school-monogram">${esc(item.icon)}</span><span class="profile-card-copy"><span class="profile-tag">${esc(item.tag)}</span><strong>${esc(item.school)}</strong><b>${esc(item.dept)}</b><small>${esc(item.route)}</small></span><span class="radio-mark">${p.id === item.id ? "✓" : ""}</span></button>`).join("");
  const officialFacts = (p.officialFacts || []).filter(Boolean);
  const contextText = officialFacts.length ? officialFacts.join(" ") : (p.unknowns || []).join(" ") || p.interviewFormat || "一般模擬情境，尚未載入校系官方資料。";
  const statusText = p.profileStatus === "official_115" ? `${p.sourceCount || officialFacts.length} 筆官方來源` : "一般模擬・非官方資料";
  return intro(0, "先選一個想練習的校系", "逢甲資工一般組與 APCS 組依 115 學年度官方指引建立；各情境會清楚標示資料狀態。") +
  `<div class="two-column-layout"><div class="profile-list">${cards}${state.customProfileOpen ? customProfileForm() : `<button class="profile-add-card" data-action="custom-profile"><span>＋</span><span><strong>找不到你的校系？</strong><small>建立一個一般模擬情境</small></span><i>↗</i></button>`}</div><aside class="profile-detail-card"><div class="detail-top"><span class="detail-kicker">情境摘要</span><span class="confidence-chip">${esc(p.confidence)}</span></div><h3>${esc(p.school)}<br /><em>${esc(p.dept)}</em></h3><div class="detail-route"><span>招生管道</span><strong>${esc(p.route)}</strong></div><div class="detail-route"><span>面試形式</span><strong>${esc(p.interviewFormat || "一般 panel 模擬")}</strong></div><div class="detail-rule"><span>✳</span><p>依目前可用來源與備審主張練習作品追問和學科概念。</p></div><div class="source-note"><span class="source-dot"></span><div><strong>資料狀態：${esc(statusText)}</strong><small>${esc(contextText)}</small></div></div><div class="detail-footer">最後核對 <strong>${esc(p.lastVerifiedAt || "尚未核對")}</strong></div></aside></div>
  <div class="form-footer"><button class="button button-quiet" data-action="home">← 返回總覽</button><button class="button button-primary" data-action="step" data-page="resume">下一步：整理備審 <span>→</span></button></div>`;
}
function portfolioUploadHtml(parseAvailable, consentCopy, unavailableCopy) {
  const pending = state.portfolioFiles.filter((item) => item.file && item.status !== "done");
  const sizes = (size) => size < 1048576 ? Math.max(1, Math.round(size / 1024)) + " KB" : (size / 1048576).toFixed(1) + " MB";
  return `<section class="upload-panel"><div class="panel-heading"><span class="eyebrow">YOUR PORTFOLIO</span><span class="secure-tag">◈ 原檔不保存</span></div><h3>匯入備審 PDF</h3>
    <label class="drop-zone" for="resume-file"><input id="resume-file" type="file" accept=".pdf,application/pdf" multiple ${state.resumeParsing || !state.libraryReady ? "disabled" : ""} /><span class="upload-icon">↑</span><strong>一次選擇或拖放多份 PDF</strong><small>最多 5 份，每份 8 MB，合計 24 MB</small><span class="button button-outline">${state.portfolioFiles.length ? "加入 PDF" : "選擇 PDF"}</span></label>
    <ul class="portfolio-files">${state.portfolioFiles.map((item) => `<li><div><strong>${esc(item.name)}</strong><small>${sizes(item.size)}・${esc(item.message)}</small></div><button class="claim-remove" data-action="remove-portfolio" data-id="${esc(item.id)}" aria-label="移除 ${esc(item.name)} 與其主張" ${state.resumeParsing ? "disabled" : ""}>×</button></li>`).join("")}</ul>
    <div class="upload-safety"><span>◈</span><p>${pending.length ? "新增檔案目前只在瀏覽器；同意解析後才會依序傳送。成功的原檔會釋放，失敗的檔案保留供重試。" : "每份 PDF 各自保留檔名、頁碼與摘錄供回查；也可直接手動整理主張。"}</p></div>
    ${pending.length ? `<div class="pdf-permission-status"><small>${state.resumeConsent && state.consentModel ? "沿用設定中的 PDF 與 Agent 授權。" : "PDF 尚未授權，請先到設定開啟。"}</small><button class="text-link" data-action="settings">資料使用設定 →</button></div><button class="button button-primary full-button" data-action="parse-portfolio" ${!parseAvailable || !state.resumeConsent || !state.consentModel || state.resumeParsing ? "disabled" : ""}>${state.resumeParsing ? "Gemini 正在依序整理…" : `整理 ${pending.length} 份未完成的 PDF`}</button>` : ""}
    ${!parseAvailable ? `<p class="pdf-parser-unavailable">${esc(unavailableCopy)}</p>` : ""}${state.resumeParseMessage ? `<p class="pdf-parse-message ${state.resumeParseError ? "is-error" : ""}" role="status">${esc(state.resumeParseMessage)}</p>` : ""}
    ${!state.portfolioFiles.length && state.claimsOrigin === "sample" ? `<button class="sample-link" data-action="sample" ${state.resumeParsing ? "disabled" : ""}>改用示範內容練習 <span>→</span></button>` : ""}</section>`;
}
function microphoneControlsHtml() {
  return `<div class="device-status-row"><span class="device-symbol">♩</span><span><strong>麥克風</strong><small>${esc(state.audioReady ? state.microphoneName : "尚未連接")}</small></span><span class="status-pill ${state.audioReady ? "is-ready" : ""}">${state.audioReady ? "已連接" : "待檢查"}</span></div>
    <div class="microphone-check"><button class="button button-outline full-button" data-action="devices" ${state.deviceChecking || state.sessionStarting ? "disabled" : ""}>${state.deviceChecking ? "連接中…" : state.audioReady ? "重新檢查麥克風" : "連接並測試麥克風"}</button>
    ${state.microphones.length ? `<label for="microphone-device">輸入裝置</label><select id="microphone-device" data-microphone ${state.deviceChecking || state.sessionStarting ? "disabled" : ""}><option value="">系統預設</option>${state.microphones.filter((item) => item.deviceId !== "default").map((item, index) => `<option value="${esc(item.deviceId)}" ${state.microphoneId === item.deviceId ? "selected" : ""}>${esc(item.label || `麥克風 ${index + 1}`)}</option>`).join("")}</select>` : ""}
    <div class="microphone-meter" aria-label="麥克風輸入音量"><span id="device-mic-level"></span></div><small id="device-mic-signal">${state.audioReady ? "請說一句話測試；若音量表不動，請換一個輸入裝置。" : "檢查只在本機顯示音量，不會錄製或傳送聲音。"}</small>
    ${state.microphoneError ? `<p class="pdf-parse-message is-error" role="alert">${esc(state.microphoneError)}</p>` : ""}</div>`;
}
function interviewMicrophoneHtml() {
  if (!state.voiceEnabled || !state.microphones.length) return "";
  return `<div class="interview-microphone"><label for="interview-microphone-device">輸入裝置</label><select id="interview-microphone-device" data-microphone ${state.deviceChecking || state.waitingForAgent || state.transcribing ? "disabled" : ""}><option value="">系統預設</option>${state.microphones.filter((item) => item.deviceId !== "default").map((item, index) => `<option value="${esc(item.deviceId)}" ${state.microphoneId === item.deviceId ? "selected" : ""}>${esc(item.label || `麥克風 ${index + 1}`)}</option>`).join("")}</select>${state.microphoneError ? `<small role="alert">${esc(state.microphoneError)}</small>` : ""}</div>`;
}
function claimsHtml(claims = state.claims) {
  return claims.map((c, i) => `<div class="claim-item"><span class="claim-index">${String(i + 1).padStart(2, "0")}</span><div class="claim-copy"><textarea data-claim="${esc(c.id)}" rows="2" aria-label="備審主張 ${i + 1}" maxlength="500" ${state.resumeParsing ? "disabled" : ""}>${esc(c.text)}</textarea>${c.sourcePage ? `<small class="claim-source">${esc(c.sourceFilename || "PDF")}・第 ${Number(c.sourcePage)} 頁・${esc(({ high: "高", medium: "中", low: "低" })[c.confidence] || "需核對")}信心</small>` : ""}${c.evidenceQuote ? `<small class="claim-quote">原文摘錄：「${esc(c.evidenceQuote)}」</small>` : ""}</div><button class="claim-remove" data-action="remove-claim" data-id="${esc(c.id)}" aria-label="移除主張" ${state.resumeParsing ? "disabled" : ""}>×</button></div>`).join("");
}
function libraryStatusHtml() {
  return `<div class="permission-summary"><strong>${state.savePortfolio ? "保存在此瀏覽器" : "目前只保留在這次開啟的頁面"}</strong><p class="library-status" role="status">${esc(state.libraryReady ? state.libraryMessage : "正在載入備審資料庫…")}</p><button class="text-link" data-action="settings">${state.savePortfolio ? "管理保存設定" : "啟用下次直接選用"} →</button></div>`;
}
function claimsPanelHtml(claims) {
  return `<section class="claims-panel"><div class="claims-heading"><div><span class="eyebrow">CLAIMS TO PRACTICE</span><h3>${state.page === "library" ? "整理與核對主張" : "本場使用的主張"}</h3></div><span class="mock-label">${claims.length} 個主張</span></div><p class="subtle-copy">可逐條修改。頁碼與摘錄供回查原 PDF，Gemini 不會查證經歷真實性；面試是否使用由資料使用設定決定。修改會更新資料庫中的主張。</p><div class="claim-list">${claimsHtml(claims) || `<p class="subtle-copy">尚無主張，可以選用文件或手動新增。</p>`}</div><button class="add-claim-button" data-action="add-claim" ${state.resumeParsing ? "disabled" : ""}>＋ 新增一個主張</button><div class="claim-tip"><span>✳</span><span>只寫你能進一步解釋的事情，面試會從這些內容延伸。</span></div></section>`;
}
function libraryPage() {
  const parseAvailable = portfolioParsingAvailable();
  const parserUnavailableCopy = state.agentMode === "gemini-api"
    ? "伺服器尚未設定 Gemini API key，PDF 解析目前不可用。"
    : state.agentMode === "cli"
      ? "Gemini 服務目前不可用；你仍可手動編輯或新增主張。"
      : "請先啟用 Gemini 服務，才可整理 PDF。你仍可手動編輯或新增主張。";
  const pdfConsentCopy = state.agentMode === "cli"
    ? "我同意將所選 PDF 傳送至 VivaPrep 伺服器，並交由 Google Gemini 整理候選主張。請勿上傳含身分證號、住址等不必要敏感資料的文件。"
    : "我同意將所選 PDF 傳送至 Google Gemini API，抽取備審候選主張。請勿上傳含身分證號、住址等不必要敏感資料的文件。";
  return `<div class="step-intro"><div class="eyebrow accent">MY PORTFOLIO</div><h1>整理一次，每場直接選用</h1><p>在這裡匯入與核對備審。開始面試時只需選資料，換校系也能沿用。更新文件可先刪除舊版再匯入新版。</p></div>${libraryStatusHtml()}` +
  `<div class="resume-grid">${portfolioUploadHtml(parseAvailable, pdfConsentCopy, parserUnavailableCopy)}
  ${claimsPanelHtml(state.claims)}</div><div class="form-footer"><button class="button button-quiet" data-action="library-return" ${state.resumeParsing ? "disabled" : ""}>← 返回</button><button class="button button-primary" data-action="step" data-page="resume" ${state.resumeParsing || !state.libraryReady ? "disabled" : ""}>選用資料，開始準備 →</button></div>`;
}
function resumePage() {
  const choices = state.portfolioFiles.map((item) => {
    const count = state.claims.filter((claim) => claim.documentId === item.id).length;
    return `<label class="portfolio-choice"><input type="checkbox" data-portfolio-selection="${esc(item.id)}" ${item.selected !== false && item.status === "done" ? "checked" : ""} ${item.status !== "done" ? "disabled" : ""}><span><strong>${esc(item.name)}</strong><small>${item.status === "done" ? `${count} 個主張・已整理，可直接使用` : esc(item.message)}</small></span></label>`;
  }).join("");
  return intro(1, "選擇這場要用的備審資料", "已整理的資料可以直接沿用，不會重新傳送 PDF 或重新分析。確認下方主張後繼續。") + `${libraryStatusHtml()}<div class="resume-grid"><section class="upload-panel"><div class="panel-heading"><span class="eyebrow">CHOOSE DOCUMENTS</span><span class="secure-tag">本場參考</span></div><h3>從我的資料庫選用</h3><div class="portfolio-choices">${choices || `<p class="subtle-copy">尚未匯入 PDF；目前可使用手動或示範主張。</p>`}</div><button class="button button-outline full-button" data-action="library">匯入或管理備審資料 →</button><div class="upload-safety"><span>◈</span><p>勾選的文件主張與手動主張會帶入本場。沒有授權使用主張時，仍可練習通用問題。</p></div></section>${claimsPanelHtml(selectedPortfolioClaims())}</div><div class="form-footer"><button class="button button-quiet" data-action="step" data-page="profile">← 上一步</button><button class="button button-primary" data-action="step" data-page="setup" ${!state.libraryReady ? "disabled" : ""}>主張確認，繼續設定 →</button></div>`;
}
function personPick(person) {
  const checked = state.people.includes(person.id);
  return `<button class="interviewer-pick ${checked ? "is-checked" : ""}" data-action="person" data-id="${person.id}" aria-pressed="${checked}"><span class="pick-check">${checked ? "✓" : "+"}</span><span class="pick-portrait"><span class="pick-portrait-image" role="img" aria-label="${person.name}" style="--pick-sheet:url('${person.image}')"></span></span><span class="pick-copy"><strong>${person.name}<small>${person.role}</small></strong><span class="trait-line">${person.trait}</span><span class="signature-line">專屬動作・${person.cue}</span></span></button>`;
}
function setupPage() {
  const localSpeech = state.speechStatus?.processingLocation === "local";
  const speechSetupCopy = localSpeech
    ? "繁中語音辨識・教授語音提問"
    : state.speechStatus?.available
      ? "語音辨識與教授語音已連線"
      : "可錄音辨識・需啟用語音服務";
  return intro(2, "安排一場適合自己的練習", "選擇考官陣容、練習長度和互動方式。逢甲資工 115 正式面試是 5 分鐘；3 分鐘適合快速練習，8 分鐘是延伸練習。") +
  `<section class="panel-choice-section"><div class="section-heading compact-heading"><div><span class="eyebrow">INTERVIEW PANEL</span><h2>選一組考官</h2></div><span class="muted-count">三種面試組合</span></div><div class="panel-options">${panels.map((x) => `<button class="panel-option ${state.panel === x.id ? "is-selected" : ""}" data-action="panel" data-id="${x.id}"><span class="panel-option-top"><span class="panel-glyph">${x.icon}</span><span class="panel-count">${x.count}</span></span><strong>${x.title}</strong><small>${x.subtitle}</small><p>${x.desc}</p><span class="panel-option-check">${state.panel === x.id ? "已選擇 ✓" : "選擇陣容 →"}</span></button>`).join("")}</div></section>
  <section class="customize-panel"><div class="customize-heading"><div><span class="eyebrow">CHARACTER ROSTER</span><h3>調整考官角色</h3><p>保留 1–3 位考官；點擊角色卡即可替換陣容。</p></div><span class="roster-count"><strong>${state.people.length}</strong> / 3 位</span></div><div class="interviewer-picks">${Object.values(interviewers).map(personPick).join("")}</div><div class="roster-hint">目前陣容：${activePeople().map((x) => x.name).join("・") || "請至少選一位考官"}</div></section>
  <section class="settings-grid"><div class="setting-card"><div class="setting-label"><span class="setting-icon">◷</span><div><strong>練習時間</strong><small>用來安排節奏，不是評分</small></div></div><div class="segmented-control">${[3,5,8].map((n) => `<button class="${Number(state.config.duration) === n ? "is-active" : ""}" data-action="duration" data-value="${n}">${n}<small> 分鐘</small></button>`).join("")}</div></div>
  <div class="setting-card"><div class="setting-label"><span class="setting-icon">◉</span><div><strong>回答方式</strong><small>計時與停頓偵測在本機執行</small></div></div><div class="mode-options"><button class="${state.config.mode === "voice" ? "is-active" : ""}" data-action="mode" data-value="voice"><span>♩</span><strong>語音情境</strong><small>${speechSetupCopy}</small></button><button class="${state.config.mode === "text" ? "is-active" : ""}" data-action="mode" data-value="text"><span>⌁</span><strong>文字情境</strong><small>依輸入停頓觸發考官接話</small></button></div></div>
  <div class="setting-card setting-card-wide"><div class="setting-label"><span class="setting-icon">▤</span><div><strong>畫面與對話節奏</strong><small>全場倒數期間，停頓過久時考官會自然接話</small></div></div><label class="toggle-row"><span><strong>顯示即時字幕</strong><small>預設開啟</small></span><input type="checkbox" data-config="captions" ${state.config.captions ? "checked" : ""} /><i></i></label><div class="setting-explainer"><span class="pause-symbol">8s</span><span><strong>約 8 秒沒有回應</strong><small>教授說完後才開始等回答；第一次停頓會換個方式問，再沒有回應就換話題。</small></span></div></div></section>
  ${permissionSummary()}
  <div class="seed-row"><span>動作排程種子</span><input type="number" min="1" max="999999" data-seed value="${state.seed}" /><small>相同種子可重播同一組角色動作。</small><button data-action="new-seed">換一組動作 ↻</button></div>
  <div class="form-footer"><button class="button button-quiet" data-action="step" data-page="resume">← 上一步</button><button class="button button-primary" data-action="step" data-page="device">下一步：設備檢查 <span>→</span></button></div>`;
}
function devicePage() {
  const localSpeech = state.speechStatus?.processingLocation === "local";
  const agentDisclosure = state.agentMode === "gemini-api"
    ? "Gemini API 教授 Agent 會收到確認主張和面試對話"
    : state.agentMode === "cli"
      ? "Gemini 教授 Agent 會收到確認主張和面試對話"
      : "本機示範 Agent 不會外傳對話";
  const recognitionDisclosure = usesStreamingRecognition()
    ? `回答語音由瀏覽器即時送 Google 語音服務辨識（無法使用時改用${serverRecognitionLabel()}）`
    : localSpeech ? "錄音送至面試後端進行語音辨識" : "錄音會送至 Google 語音服務辨識";
  const ttsDisclosure = localSpeech ? (state.speechStatus?.ttsLocation === "cloud" ? "教授提問文字送 Google Gemini TTS 朗讀" : "教授提問以本機語音朗讀") : "教授提問由雲端合成";
  const speechDisclosure = localSpeech || state.speechStatus?.provider === "gemini" ? `${recognitionDisclosure}，${ttsDisclosure}` : "語音服務尚未啟用；可改用文字回答";
  const pdfEvidenceDisclosure = usesExternalAgent() && state.claims.some((claim) => claim.sourcePage || claim.evidenceQuote)
    ? "；若使用 PDF 抽取主張，已確認主張的檔名、頁碼與短摘錄也會一併傳送"
    : "";
  const liveDisclosure = liveEligible() && liveConsented() && state.liveProbe.status !== "failed"
    ? "；暖身對談使用 Gemini Live：麥克風音訊經面試後端即時送 Google Gemini Live API，教授語音也由它產生（免費層的內容會被 Google 用來改進產品），連不上時改用上述回合制"
    : "";
  const processingCopy = `${agentDisclosure}${pdfEvidenceDisclosure}；${speechDisclosure}${liveDisclosure}。原始鏡頭畫面不會上傳。`;
  return intro(3, "先確認設備，再進入面試室", `回答會送到面試後端加密暫存；${state.saveHistory ? "本場已選擇保存到登入帳號，預計保留 24 個月，可在帳號頁匯出或刪除。" : "本場預設不保存為個人歷史，結束後依暫存期限清除。"}${processingCopy}`) +
  `<div class="device-grid"><section class="device-preview-card"><div class="device-preview-top"><span class="eyebrow">CAMERA PREVIEW</span><span class="local-only">◈ 僅此裝置</span></div><div class="video-preview ${state.deviceReady ? "has-video" : ""}"><video id="device-video" autoplay playsinline muted></video><div class="camera-framing-guide" aria-hidden="true"><span class="camera-framing-head"></span><span class="camera-framing-upper-body"></span><small>頭部與雙肩保持在框內</small></div><div class="preview-placeholder"><span class="camera-orbit">◉</span><strong>${state.deviceReady ? "鏡頭已準備好" : "鏡頭預覽尚未開啟"}</strong><small>${state.deviceReady ? "離開此頁後會停止鏡頭" : "按下檢查按鈕後，瀏覽器會詢問鏡頭權限"}</small></div><span class="preview-corner">設備檢查</span></div><button class="button button-primary full-button" data-action="camera-device">${state.deviceReady ? "重新檢查鏡頭" : "開啟鏡頭預覽（選用）"} <span>→</span></button>${state.cameraError ? `<p class="pdf-parse-message is-error">${esc(state.cameraError)}</p>` : ""}<button class="skip-check" data-action="skip-devices">略過設備檢查，以文字方式繼續</button></section>
  <section class="device-status-card"><span class="eyebrow">DEVICE STATUS</span><h3>設備與資料使用</h3>${microphoneControlsHtml()}${liveStatusHtml()}<label class="toggle-row device-camera-toggle"><span><strong>面試中分析姿態與視線（MediaPipe）</strong><small>選用，只在此電腦分析，畫面不上傳。需先開啟鏡頭預覽；進面試室後，按右上角鏡頭面板的「展示」可放大並顯示追蹤點。</small></span><input type="checkbox" data-preference="cameraAnalysisConsent" ${state.cameraAnalysisConsent ? "checked" : ""} ${state.preferencesReady ? "" : "disabled"} /><i></i></label>
  ${permissionSummary()}
  <div class="device-info-note"><span>i</span><p>${state.agentMode === "gemini-api" ? (state.health?.geminiApiConfigured ? `教授與復盤使用 ${esc(state.health.model || "Gemini API")}。` : "Gemini API key 尚未設定；面試與 PDF 解析目前無法呼叫模型。") : state.agentMode === "cli" ? "教授與復盤使用 Google Gemini。" : "目前使用本機示範 Agent。"}${localSpeech ? "繁中語音辨識與教授語音已就緒。" : state.speechStatus?.provider === "gemini" ? "語音服務使用 Gemini API。" : "語音辨識／合成未啟用時仍可使用文字回答。"}</p></div><div class="device-profile-summary"><span class="mini-school-mark">F</span><div><strong>${profile().school}・${profile().dept}</strong><small>${activePeople().map((x) => x.name).join("・")} ・ ${state.config.duration} 分鐘</small></div><button data-action="step" data-page="setup">編輯</button></div></section></div>
  <div class="form-footer"><button class="button button-quiet" data-action="step" data-page="setup" ${state.sessionStarting ? "disabled" : ""}>← 返回設定</button><button class="button button-primary" data-action="step" data-page="interview" ${state.sessionStarting ? "disabled aria-busy=\"true\"" : startRestriction() ? "disabled" : ""}>${state.sessionStarting ? "正在準備面試室…" : "進入面試室"} ${state.sessionStarting ? "" : "<span>→</span>"}</button></div>`;
}
function liveStatusHtml() {
  if (!liveEligible()) return "";
  const probe = state.liveProbe;
  const [pill, copy] = !liveConsented() ? ["回合制", "未允許即時對談，暖身對談使用回合制；可到資料使用設定開啟。"]
    : probe.status === "ok" ? ["即時", `已試連 Gemini Live（${probe.latencyMs} ms），暖身對談會即時對答。`]
    : probe.status === "failed" ? ["回合制", `即時對談無法使用，改用回合制（${probe.message || "連線失敗"}）。`]
    : ["試連中", "正在試連 Gemini Live…"];
  return `<div class="device-status-row live-status is-${probe.status}" role="status"><span class="device-symbol">◎</span><span><strong>即時對談</strong><small>${esc(copy)}${probe.status === "failed" && liveConsented() ? ' <button class="text-link" data-action="live-probe">再試一次</button>' : ""}</small></span><span class="status-pill">${pill}</span></div>`;
}
function actor(person, index, total, event) {
  const seats = total === 1 ? [50] : total === 2 ? [23, 77] : [23, 50, 77];
  const restingPoses = ["listening", "reading_notes", "thinking"];
  const activeAction = (state.closing && questionAudio) || interviewTiming.phase === "speaking" ? "speaking" : ["preparing", "thinking", "transcribing", "nudge"].includes(interviewTiming.phase) ? "thinking" : "listening";
  const action = person.id === event.speaker ? activeAction : person.id === event.reader ? "reading_notes" : restingPoses[(event.turn + index + event.seed) % restingPoses.length];
  const followUpLabel = usesExternalAgent() ? "自然接話" : "示範追問";
  const labels = { speaking: state.closing ? "面試收尾" : state.followUp ? followUpLabel : "正在提問", listening: "聆聽中", reading_notes: person.cue, thinking: "思考中" };
  const speaking = action === "speaking";
  return `<div class="actor actor-${person.id} state-${action} ${speaking ? "is-active-speaker" : ""}" data-person="${person.id}" data-state="${action}" style="--seat-x:${seats[index]}%;--pose-sheet:url('/assets/interviewers/${person.id}-poses.png')"><div class="actor-portrait pose-${action}" role="img" aria-label="${person.name}，${labels[action]}"></div><div class="actor-nameplate ${person.color}"><span class="actor-state-dot"></span><strong>${person.name}</strong><small>${labels[action]}</small></div></div>`;
}
function interviewPage() {
  document.body.classList.add("is-interview");
  const p = profile(), q = currentQuestion(), people = activePeople();
  const event = { speaker: state.currentEvent?.speakerId || people[0]?.id || "portfolio", reader: state.currentEvent?.readerId || "", turn: state.q, seed: Number(state.seed) || 0 };
  const speaker = interviewers[event.speaker] || interviewers[people[0]?.id] || interviewers.portfolio;
  const timer = '<span class="interview-timer' + (state.remaining <= 60 ? " is-urgent" : "") + '"><span id="practice-timer-label">練習倒數</span><strong id="remaining-time">' + remainingText() + "</strong></span>";
  const captionText = state.liveCaption || state.followUp || q.text;
  const caption = state.config.captions || state.closing ? '<div class="caption-bubble" aria-live="polite"><span class="caption-speaker">' + speaker.name + (state.followUp ? "・追問" : "") + "</span><p>" + esc(captionText) + "</p></div>" : "";
  const progressCount = Math.max(state.backendTurns.length, 1);
  const stageNotice = state.closing ? "面試收尾" : state.currentEvent?.finalQuestion ? "最後一個問題・回答後結束" : state.remaining <= closingWindowSeconds() ? "即將結束・請簡短完成目前回答" : "";
  const progress = Array.from({ length: progressCount }, (_, i) => '<i class="' + (i === state.q ? "is-current" : i < state.q ? "is-past" : "") + '"></i>').join("");
  const modal = state.confirmEnd ? '<div class="modal-scrim"><div class="confirm-modal" role="dialog" aria-modal="true"><span class="modal-icon">↗</span><h2>要結束這次練習嗎？</h2><p>已提交的回答會用於這次復盤；面試結束後會移除本機記憶體中的場次。</p><div><button class="button button-quiet" data-action="continue">繼續練習</button><button class="button button-primary" data-action="confirm-end">結束並看復盤</button></div></div></div>' : "";
  return `<main class="interview-screen">
  <header class="interview-topline"><a class="interview-brand" href="#" data-action="home"><span class="brand-mark">V</span><span><strong>VivaPrep</strong><small>模擬面試</small></span></a><div class="interview-context"><span class="context-dot"></span><span>${p.school}・${p.dept}</span><i>·</i><span>${p.route}</span><b>示範情境</b></div><div class="interview-top-actions">${timer}<button class="exit-link" data-action="end" ${state.finishing ? "disabled" : ""}>結束面試 <span>↗</span></button></div></header>
  <div class="room-caption-top"><span class="room-status"><i></i> ${liveLink ? "Gemini Live 即時對談" : usesExternalAgent() ? `${esc(agentLabel())} 教授 Agent` : "本機示範 Agent"}</span>${state.liveNotice ? `<span class="live-notice" role="status">${esc(state.liveNotice)}</span>` : ""}<span class="room-phase">${stageNotice || q.topic}　·　${String(state.q + 1).padStart(2, "0")} / ${Math.max(state.backendTurns.length, 1)}</span><div class="silence-meter"><div><span>停頓時考官會接話</span><strong id="silence-value">08 秒</strong></div><span class="silence-track"><i id="silence-progress"></i></span></div></div>
  <section class="room-stage" data-count="${people.length}" aria-label="平面面試室；教授會依談話狀態切換圖片"><div class="room-backdrop" aria-hidden="true"></div><div class="room-wash" aria-hidden="true"></div>${people.map((x, i) => actor(x, i, people.length, event)).join("")}<div class="room-desk-front" aria-hidden="true"></div><div class="speaker-cue ${state.followUp ? "is-follow-up" : ""}"><span class="cue-pulse"></span><span><small>${state.closing ? "面試收尾" : state.followUp ? (usesExternalAgent() ? "教授自然接話" : "本機示範追問") : "目前發問"}</small><strong>${speaker.name}・${speaker.role}</strong></span><span class="cue-chevron">›</span></div></section>
  <div class="interview-bottom">${caption}<div class="voice-status" role="status"><span id="voice-status-text">${state.voiceEnabled ? "教授說完後可直接回答" : "閱讀題目後輸入回答"}</span>${state.voiceEnabled ? '<span class="microphone-level-track" aria-label="麥克風音量"><i id="microphone-level"></i></span>' : ""}${state.closing ? `<button data-action="closing-review">閱讀後看復盤 →</button>${state.playbackBlocked ? '<button data-action="play-question">播放收尾</button>' : ""}` : state.playbackBlocked ? '<button data-action="play-question">播放問題</button><button data-action="skip-question-audio">閱讀字幕回答</button>' : ""}</div>${state.closing ? "" : interviewMicrophoneHtml()}<form class="answer-composer" data-form="answer"><div class="composer-context"><span class="composer-wave">${state.config.mode === "voice" ? "♩" : "⌁"}</span><span>${state.config.mode === "voice" ? "語音情境" : "文字練習"}<small>${state.voiceEnabled ? (liveLink ? "Gemini Live 即時對談" : usesStreamingRecognition() ? "瀏覽器串流辨識" : state.speechStatus?.processingLocation === "local" ? "語音在本機辨識" : "語音送交辨識服務") : "回答以文字送交教授"}</small></span></div><textarea name="answer" rows="2" class="${!state.draft && state.liveTranscript ? "is-live-transcript" : ""}" ${state.waitingForAgent ? "disabled" : ""} placeholder="${state.voiceEnabled ? "教授說完後直接說話，或在這裡輸入回答…" : "輸入你的回答，考官會依節奏繼續…"}" aria-label="輸入模擬回答">${esc(state.draft || state.liveTranscript)}</textarea><button class="send-answer" ${state.waitingForAgent ? "disabled" : ""} type="submit" aria-label="送出回答，讓面試繼續">↑</button></form></div>
  <footer class="interview-dock"><div class="dock-group"><button class="dock-control ${state.muted ? "is-muted" : ""}" data-action="mic" ${state.finishing ? "disabled" : ""}><span>${state.muted ? "×" : "♩"}</span><small>${!state.voiceEnabled ? "啟用語音回答" : !state.audioReady ? "連接麥克風" : state.voiceRetryRequired ? "重試收音" : state.muted ? "開啟麥克風" : "暫停麥克風"}</small></button>${state.voiceEnabled ? '<button class="dock-control" data-action="send-voice" disabled><span>↑</span><small>說完了，送出</small></button>' : ""}<div class="dock-control is-camera" aria-label="鏡頭預覽已隱藏"><span>▣</span><small>鏡頭預覽已隱藏</small></div><button class="dock-control ${state.config.captions ? "is-on" : ""}" data-action="captions" ${state.settingsSaving || state.closing ? "disabled aria-busy=\"true\"" : ""}><span>CC</span><small>字幕 ${state.config.captions ? "開啟" : "關閉"}</small></button></div><div class="dock-center"><span class="question-progress">${progress}</span><span>${String(state.q + 1).padStart(2, "0")} / ${String(Math.max(state.backendTurns.length, 1)).padStart(2, "0")} 題</span></div><div class="dock-right"><span class="seed-badge">SEED ${esc(state.seed)}</span><span class="dock-hint">${state.closing ? "面試結束，稍後整理復盤" : liveLink ? "直接說話，教授即時接話" : state.voiceEnabled ? "直接回答，停頓後自動送出" : "送出回答後，考官自然接續"}</span></div></footer>${modal}</main>`;
}
function cameraTrialReviewCard() {
  const summary = state.cameraAnalysisSummary;
  if (!state.cameraAnalysisConsent || !summary) return "";
  const phaseLabels = {
    question_listening: "教授語音提問",
    follow_up_listening: "教授語音追問",
    question_visible_window: "題目顯示期間",
    follow_up_visible_window: "追問顯示期間",
    candidate_answer: "回答期間",
    question_response_transition: "題目與回答轉換",
    agent_transition: "教授準備下一題",
    unclassified: "未分類時段",
  };
  const rows = summary.segments.map((item) => {
    const interviewer = interviewers[item.speakerId]?.name || "考官未辨識";
    const zones = item.headOrientationRatios;
    const movement = Number.isFinite(item.averageTorsoDisplacementPerSecond) ? `${item.averageTorsoDisplacementPerSecond.toFixed(2)} 肩寬／秒` : "有效樣本不足";
    return `<article class="camera-result-row"><strong>${esc(interviewer)}・${esc(phaseLabels[item.phase] || item.phase)}</strong><span>頭部方向代理：左 ${percent(zones.left)}／正面 ${percent(zones.center)}／右 ${percent(zones.right)}／未知 ${percent(item.unknownRatio)}</span><span>臉部涵蓋 ${percent(item.faceCoverage)}・肩部涵蓋 ${percent(item.poseCoverage)}・平均位移 ${esc(movement)}</span><small>${item.samples} 個推論結果・約 ${Math.round(item.observedMs / 1000)} 秒有時間涵蓋</small></article>`;
  }).join("");
  const calibration = ["camera-baseline-calibrated", "head-pose-proxy-calibrated"].includes(summary.calibration) ? "完成個人基線校正" : "未完成基線校正";
  const handling = state.cameraMetricsConsent
    ? `本場只把衍生摘要交給 Agent；${state.saveHistory ? "摘要也會加密保存於你的私人練習歷史。" : "未選擇保存歷史，因此完成後不會保留在帳號。"}`
    : "數值只在此瀏覽器暫存，沒有傳到伺服器或寫入資料庫。";
  return `${postureFeedbackCard(buildPostureFeedback(summary, state.backendTurns))}<section class="camera-results-card"><details><summary>鏡頭原始數值（各時段）</summary><p>${handling} 視線與坐姿是相對開場校正的估計，不是眼動儀量測或面試評分；校正狀態：${esc(calibration)}・實際推論 ${summary.actualFps.toFixed(1)} FPS。</p>${rows || '<p class="subtle-copy">本場沒有足夠鏡頭樣本；可檢查攝影機畫面與瀏覽器權限後再試。</p>'}</details></section>`;
}

function postureFeedbackCard(feedback) {
  if (!feedback) return "";
  const levelLabels = { good: "保持", watch: "留意", improve: "優先改善", unknown: "資料不足" };
  const limits = feedback.limits.length ? `<ul class="posture-limits">${feedback.limits.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
  if (!feedback.usable) return `<section class="posture-feedback-card"><div class="eyebrow">POSTURE & EYE CONTACT</div><h2>姿態與視線回饋</h2>${limits || '<p class="subtle-copy">本場鏡頭資料不足，無法產生姿態回饋。</p>'}</section>`;
  const focus = feedback.priorities.length
    ? `<div class="posture-focus"><strong>下一場先練：</strong>${feedback.priorities.map((card) => `<span>${esc(card.title)}</span>`).join("")}${feedback.strengths.length ? `<small>做得不錯：${feedback.strengths.map(esc).join("、")}</small>` : ""}</div>`
    : `<div class="posture-focus"><strong>這場的姿態與視線都在穩定範圍。</strong><small>維持同樣的鏡頭高度與坐姿即可。</small></div>`;
  const cards = feedback.cards.map((card) => `<article class="posture-card is-${card.level}"><header><span>${esc(card.title)}</span><b>${esc(levelLabels[card.level])}</b></header><strong>${esc(card.value)}</strong><p>${esc(card.detail)}</p><p class="posture-why">${esc(card.why)}</p><p class="posture-tip"><span>練習</span>${esc(card.tip)}</p></article>`).join("");
  const zones = [["screen", "看向考官"], ["down", "低頭"], ["side", "看旁邊"], ["up", "往上看"]];
  const timeline = feedback.perQuestion.map((row) => {
    const bars = zones.map(([zone, label]) => Number.isFinite(row.attention[zone]) && row.attention[zone] > 0 ? `<i class="zone-${zone}" style="width:${(row.attention[zone] * 100).toFixed(1)}%" title="${label} ${Math.round(row.attention[zone] * 100)}%"></i>` : "").join("");
    return `<article class="posture-question"><div><span class="transcript-index">${String(row.index + 1).padStart(2, "0")}</span><p>${esc(row.question)}</p></div><div class="attention-bar" aria-label="回答時的視線分布">${bars}</div><div class="posture-flags">${row.flags.length ? row.flags.map((flag) => `<span>${esc(flag)}</span>`).join("") : "<small>這題沒有明顯問題</small>"}</div></article>`;
  }).join("");
  const legend = zones.map(([zone, label]) => `<span><i class="zone-${zone}"></i>${label}</span>`).join("");
  return `<section class="posture-feedback-card"><div class="eyebrow">POSTURE & EYE CONTACT</div><h2>姿態與視線回饋</h2><p class="subtle-copy">只看你回答的時段，數值相對開場校正的坐姿與視線估計，用來找練習方向，不是面試分數。</p>${focus}<div class="posture-cards">${cards}</div><h3>每一題的視線分布</h3><div class="attention-legend">${legend}</div><div class="posture-questions">${timeline}</div>${limits}</section>`;
}

function cameraMetricsForSubmission(summary) {
  if (!summary || !Array.isArray(summary.segments)) return null;
  return {
    schemaVersion: summary.schemaVersion === "camera-trial-v2" ? "camera-trial-v2" : "camera-trial-v1",
    status: summary.status,
    calibration: summary.calibration,
    elapsedMs: summary.elapsedMs,
    actualFps: summary.actualFps,
    droppedFrames: summary.droppedFrames,
    segments: summary.segments.slice(0, 120).map((item) => ({
      turnId: item.turnId,
      speakerId: item.speakerId,
      phase: item.phase,
      startedOffsetMs: item.startedOffsetMs,
      endedOffsetMs: item.endedOffsetMs,
      samples: item.samples,
      observedMs: item.observedMs,
      faceCoverage: item.faceCoverage,
      poseCoverage: item.poseCoverage,
      headOrientationRatios: item.headOrientationRatios,
      unknownRatio: item.unknownRatio,
      averageTorsoDisplacementPerSecond: item.averageTorsoDisplacementPerSecond,
      torsoDisplacementP90PerSecond: item.torsoDisplacementP90PerSecond,
      attentionRatios: item.attentionRatios,
      attentionUnknownRatio: item.attentionUnknownRatio,
      gazeCoverage: item.gazeCoverage,
      postureCoverage: item.postureCoverage,
      tiltedRatio: item.tiltedRatio,
      slumpedRatio: item.slumpedRatio,
      handNearFaceRatio: item.handNearFaceRatio,
      awayEpisodes: item.awayEpisodes,
      longestAwayMs: item.longestAwayMs,
      longestDownMs: item.longestDownMs,
    })),
  };
}
function cameraHistoryMetricsMarkup(summary) {
  if (!summary) return '<p class="subtle-copy">這筆紀錄沒有保存鏡頭衍生摘要。</p>';
  const ratio = (value) => Number.isFinite(value) ? percent(value) : "未校正或樣本不足";
  const movement = Number.isFinite(summary.averageTorsoDisplacementPerSecond)
    ? `${summary.averageTorsoDisplacementPerSecond.toFixed(2)} 肩寬／秒`
    : "樣本不足";
  return `<div class="camera-history-metrics"><span>回答涵蓋 ${summary.answerSegments} 題</span><span>臉部可用 ${ratio(summary.faceCoverage)}</span><span>肩部可用 ${ratio(summary.poseCoverage)}</span>${Number.isFinite(summary.screenRatio) ? `<span>看向考官 ${ratio(summary.screenRatio)}</span><span>低頭 ${ratio(summary.downRatio)}</span><span>坐姿下沉或歪斜 ${ratio(summary.postureIssueRatio)}</span>` : `<span>頭部朝前代理 ${ratio(summary.headForwardRatio)}</span>`}<span>上半身平均位移 ${esc(movement)}</span></div><small class="subtle-copy">視線與坐姿是相對校正的估計，不是眼動儀量測；這些未經人工標註驗證的數值不構成表現分數。</small>`;
}

function reviewPage() {
  const p = profile();
  const answered = state.backendTurns.filter((turn) => turn.answerText?.trim()).length;
  const review = state.review;
  const cards = state.backendTurns.map((turn, i) => {
    const specificPriority = review?.improvementPriorities?.find((item) => item.evidenceRefs?.some((ref) => ref.turnId === turn.turnId));
    const feedback = specificPriority?.description || '復盤尚未提供這題的逐題建議；可先補上具體行動、例子和結果。';
    const evidence = review?.evidenceRefs?.filter((ref) => ref.turnId === turn.turnId) || [];
    const followUps = (turn.followUps || []).map((text) => '<div class="review-follow-up"><span>教授接話</span><p>' + esc(text) + '</p></div>').join('');
    return '<article class="transcript-card"><div class="transcript-head"><span class="transcript-index">' + String(i + 1).padStart(2, '0') + '</span><div><span class="topic-chip">' + esc(turn.roleId || '面試') + '</span><h3>' + esc(turn.questionText) + '</h3>' + followUps + '</div><span class="transcript-time">' + esc(interviewers[turn.speakerId]?.name || '考官') + '</span></div><div class="answer-quote"><span>你的回答</span><p>' + (turn.answerText ? esc(turn.answerText) : '這題尚未輸入回答。') + '</p></div><div class="feedback-note"><span>✳</span><p>' + esc(feedback) + '</p></div>' + (evidence.length ? '<div class="evidence-link">逐字稿依據：<strong>' + esc(evidence.map((item) => item.quote).join('／')) + '</strong></div>' : '') + '</article>';
  }).join('');
  const roster = activePeople().map((person) => '<div><img src="' + person.image + '" alt="" /><span><strong>' + esc(person.name) + '</strong><small>' + esc(person.role) + '</small></span></div>').join('');
  const strengths = (review?.sharedStrengths || []).map((item) => '<li>' + esc(item) + '</li>').join('');
  const priorities = (review?.improvementPriorities || []).map((item) => '<li><strong>' + esc(item.title) + '</strong><p>' + esc(item.description) + '</p></li>').join('');
  const drill = review?.practiceDrill?.[0];
  const dataLimits = (review?.dataLimits || []).map((item) => esc(item)).join('／');
  return '<div class="review-hero"><div><span class="eyebrow accent">SESSION REVIEW / ' + (state.agentMode === 'mock' ? 'DEMO' : 'GEMINI') + '</span><h1>每一次回答，<br /><em>都能找到下一步。</em></h1><p>' + esc(p.school) + '・' + esc(p.dept) + '　／　練習 ' + elapsedText() + (state.endReason === 'time' ? '・時間到' : '') + '</p></div><div class="review-stamp"><span>V</span><small>回答題數</small><strong>' + String(answered).padStart(2, '0') + '<i> / ' + String(state.backendTurns.length).padStart(2, '0') + '</i></strong><small>題有輸入回答</small></div></div>' +
    cameraTrialReviewCard() +
    '<div class="review-disclaimer"><span>i</span><p><strong>' + (review ? '面試後 Agent 復盤。' : '復盤尚未完成。') + '</strong>' + esc(review?.summary || '請稍候；不代表官方評分，也不預測錄取結果。') + (dataLimits ? '<br /><small>' + dataLimits + '</small>' : '') + '</p></div>' +
    (review ? '<div class="review-layout"><section class="review-main"><div class="review-side-card"><span class="eyebrow">SHARED STRENGTHS</span><h3>本場可延續的做法</h3><ul>' + (strengths || '<li>本場沒有足夠回答可歸納共通優點。</li>') + '</ul><span class="eyebrow">NEXT PRIORITIES</span><h3>下一步練習</h3><ul>' + (priorities || '<li>先補上具體例子、自己的行動與結果。</li>') + '</ul>' + (drill ? '<div class="practice-quote">' + esc(drill.prompt) + '<small>' + esc((drill.checklist || []).join('・')) + '</small></div>' : '') + '</div><div class="section-heading compact-heading"><div><span class="eyebrow">QUESTION BY QUESTION</span><h2>逐題回看</h2></div><button class="text-link" data-action="export">下載文字紀錄 ↓</button></div><div class="transcript-list">' + (cards || '<p class="subtle-copy">這場尚無問題紀錄。</p>') + '</div></section>' +
    '<aside class="review-aside"><div class="review-side-card"><span class="eyebrow">PANEL USED</span><h3>這次的考官</h3><div class="review-roster">' + roster + '</div><div class="source-note"><span class="source-dot"></span><div><strong>復盤模式：' + esc(agentLabel()) + '</strong><small>官方來源只作規則背景；教授角色為模擬設定。</small></div></div></div><div class="review-safety"><span>◈</span><p>只根據本場回答與可追溯來源整理練習建議；不推斷人格或錄取機率。</p></div></aside></div>' :
      '<div class="review-side-card"><p>' + esc(state.reviewError || '正在整理教授觀察和逐字稿…') + '</p>' + (state.reviewError ? '<button class="button button-primary" data-action="retry-review">重新整理復盤</button>' : '') + '</div>') +
    '<div class="form-footer review-footer"><button class="button button-quiet" data-action="home">回到練習總覽</button><button class="button button-primary" data-action="practice">開始下一輪練習 <span>→</span></button></div>';
}

let clock = null;
let silenceClock = null;
let audioContext = null;
let audioAnalyser = null;
let audioMonitorId = 0;
function stopAudioMonitor() {
  if (audioMonitorId) cancelAnimationFrame(audioMonitorId);
  audioMonitorId = 0;
  microphoneLevel = 0;
  lastAudioSampleAt = 0;
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; audioAnalyser = null; }
}
function startAudioMonitor() {
  if (audioContext || !state.audioReady || state.muted || !state.stream?.getAudioTracks().length) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioContext = new AudioContextClass();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 512;
    audioContext.createMediaStreamSource(new MediaStream(state.stream.getAudioTracks())).connect(audioAnalyser);
    audioContext.resume().catch(() => {});
    const samples = new Uint8Array(audioAnalyser.fftSize);
    const readLevel = () => {
      if (!audioAnalyser || state.muted || !["device", "interview"].includes(state.page)) { audioMonitorId = 0; return; }
      audioAnalyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) { const value = (sample - 128) / 128; sum += value * value; }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      const delta = Math.min(100, now - (lastAudioSampleAt || now));
      lastAudioSampleAt = now;
      microphoneLevel = rms;
      if (state.page === "device") {
        if (rms > 0.008) state.microphoneHeard = true;
        const meter = document.getElementById("device-mic-level");
        if (meter) meter.style.width = `${Math.min(100, rms * 700)}%`;
        const status = document.getElementById("device-mic-signal");
        if (status) status.textContent = state.microphoneHeard ? "已收到聲音；請確認說話時音量表會移動。" : "請說一句話測試；若音量表不動，請換一個輸入裝置。";
      }
      const listening = state.recording && !state.waitingForAgent && ["listening", "capturing", "nudge"].includes(interviewTiming.phase);
      // Runs every frame so the noise floor is learned before the answer starts.
      const transition = voiceActivity.update(rms, now, delta, { listening });
      if (listening) {
        if (transition === "start" && !state.voiceDetected) markVoiceStart();
        if (state.voiceDetected && voiceActivity.smoothed >= voiceActivity.continueThreshold) {
          interviewTiming.activity();
          if (voiceCapture) voiceCapture.lastVoiceAt = now;
        }
        if (voiceCapture?.kind === "stream") { if (state.voiceDetected && transition === "end") scheduleStreamEnd(voiceCapture); }
        else if (state.voiceDetected && (transition === "end" || now - (voiceCapture?.startedAt || now) >= MAX_ANSWER_RECORDING_MS)) completeVoiceCapture();
      }
      audioMonitorId = requestAnimationFrame(readLevel);
    };
    audioMonitorId = requestAnimationFrame(readLevel);
  } catch {
    stopAudioMonitor();
  }
}
function armSilencePrompt() {
  state.lastActivityAt = Date.now();
  interviewTiming.activity();
  if (state.currentEvent?.phase !== "follow_up") state.followUp = "";
}
function triggerFollowUp() {
  if (state.finishing || state.closing || !state.sessionId || state.waitingForAgent || state.nudgePending || state.voiceDetected || silenceRemainingMs() !== 0) return;
  if (liveLink) {
    // Live rephrases once, then changes topic, like the turn-based professor.
    if (liveNudges >= 2 || liveProfessorTurn || liveLink.playing) return;
    liveNudges += 1;
    state.nudgePending = true;
    interviewTiming.pause("nudge");
    liveLink.send({ type: "nudge" });
    clearTimeout(liveNudgeTimer);
    liveNudgeTimer = setTimeout(() => { if (state.nudgePending && liveLink) { state.nudgePending = false; liveListen(); } }, 8000);
    updateConversationHud();
    return;
  }
  const sessionId = state.sessionId;
  const turnId = state.currentEvent?.turnId;
  const eventSeq = state.currentEvent?.seq;
  interviewTiming.pause("nudge");
  state.nudgePending = true;
  api("/api/sessions/" + encodeURIComponent(sessionId) + "/nudge", { method: "POST", body: JSON.stringify({ turnId, eventSeq, elapsedSeconds: state.elapsed }) })
    .then((result) => {
      if (state.sessionId !== sessionId || state.currentEvent?.seq !== eventSeq) return;
      if (result.skipped || !result.event) {
        state.nudgePending = false;
        if (interviewTiming.phase === "nudge") beginListening(eventSeq);
        return;
      }
      acceptInterviewEvent(result.event);
    })
    .catch((error) => {
      if (state.sessionId !== sessionId || state.currentEvent?.seq !== eventSeq) return;
      state.nudgePending = false;
      if (interviewTiming.phase === "nudge") beginListening(eventSeq);
      const turn = state.backendTurns.find((item) => item.turnId === turnId);
      if (!turn?.answerText) notify(error.message);
    });
}
async function finishInterview(reason = "manual") {
  if (!state.sessionId || state.page !== "interview" || state.finishing) return;
  state.finishing = true;
  // The backend keeps the words Live already heard for this answer.
  if (liveLink) leaveLiveMode("", { rerender: false });
  state.confirmEnd = false;
  state.endReason = reason;
  const hadPendingVoice = (state.voiceDetected && state.recording) || state.transcribing;
  stopQuestionAudio();
  interviewTiming.pause("ending");
  try {
    // Freeze question generation before flushing the last recording or typed answer.
    await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/ending", { method: "POST", body: JSON.stringify({ reason, elapsedSeconds: state.elapsed }) });
  if (state.voiceDetected && state.recording) await completeVoiceCapture();
  if (voiceSubmissionPromise) await voiceSubmissionPromise;
  if (hadPendingVoice && state.voiceRetryRequired && state.transcribing === false && state.waitingForAgent === false) throw new Error("最後一段語音未辨識成功，請重試收音或改用文字後再結束。");
  const input = app.querySelector('[data-form="answer"] textarea');
  const currentTurn = state.backendTurns.find((turn) => turn.turnId === state.currentEvent?.turnId);
  if ((input?.value.trim() || state.draft.trim()) && currentTurn && !currentTurn.answerText) {
    const saved = await submitAnswer();
    if (!saved) throw new Error("最後的回答尚未保存，請重試後再結束。");
  }
    const result = await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/close", { method: "POST", body: JSON.stringify({ reason, elapsedSeconds: state.elapsed }) });
    if (result.event) acceptInterviewEvent(result.event);
    else if (!state.closing) throw new Error("尚未完成面試收尾，請重試結束。");
  } catch (error) {
    await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/ending", { method: "POST", body: JSON.stringify({ cancel: true }) }).catch(() => {});
    state.finishing = false; state.waitingForAgent = false; interviewTiming.listen(); notify(error.message); render();
  }
}
async function completeInterviewReview() {
  if (!state.sessionId || !state.closing || state.reviewStarting || state.page !== "interview") return;
  state.reviewStarting = true;
  clearTimeout(closingTimer);
  if (voiceSubmissionPromise) await voiceSubmissionPromise;
  state.page = "review";
  state.confirmEnd = false;
  state.review = null;
  state.reviewError = null;
  stopMedia();
  render();
  try {
    const finishedSessionId = state.sessionId;
    const finishPayload = { reason: state.endReason || "completed" };
    const cameraMetrics = state.cameraMetricsConsent ? cameraMetricsForSubmission(state.cameraAnalysisSummary) : null;
    if (cameraMetrics) finishPayload.cameraMetrics = cameraMetrics;
    await api("/api/sessions/" + encodeURIComponent(finishedSessionId) + "/finish", { method: "POST", body: JSON.stringify(finishPayload) });
    const snapshot = await api("/api/sessions/" + encodeURIComponent(finishedSessionId));
    state.backendTurns = snapshot.turns || state.backendTurns;
    state.review = snapshot.review || null;
    state.reviewError = snapshot.reviewError || null;
    state.waitingForAgent = false;
    if (snapshot.status === "review_failed") notify("面試已結束，但復盤服務未完成；可以重試。");
    else if (snapshot.status === "completed") {
      stopEventStream();
      await api("/api/sessions/" + encodeURIComponent(finishedSessionId), { method: "DELETE" }).catch(() => {});
      state.sessionId = null;
    }
    render();
  } catch (error) {
    notify(error.message);
    state.page = "interview";
    render();
  } finally { state.finishing = false; state.reviewStarting = false; }
}
async function retryReview() {
  if (!state.sessionId) return;
  state.reviewError = null;
  state.waitingForAgent = true;
  render();
  try {
    await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/review/retry", { method: "POST", body: "{}" });
    const snapshot = await api("/api/sessions/" + encodeURIComponent(state.sessionId));
    state.backendTurns = snapshot.turns || state.backendTurns;
    state.review = snapshot.review || null;
    state.reviewError = snapshot.reviewError || null;
    state.waitingForAgent = false;
    if (snapshot.status === "completed") {
      stopEventStream();
      await api("/api/sessions/" + encodeURIComponent(state.sessionId), { method: "DELETE" }).catch(() => {});
      state.sessionId = null;
    }
    render();
  } catch (error) {
    state.waitingForAgent = false;
    state.reviewError = error.message;
    render();
  }
}
async function toggleCaptions() {
  if (state.settingsSaving) return;
  const nextValue = !state.config.captions;
  if (!state.sessionId) { state.config.captions = nextValue; render(); return; }
  state.settingsSaving = true;
  state.config.captions = nextValue;
  render();
  try {
    await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/settings", {
      method: "PATCH",
      body: JSON.stringify({ captionsEnabled: nextValue }),
    });
  } catch (error) {
    state.config.captions = !nextValue;
    notify(error.message);
  } finally {
    state.settingsSaving = false;
    render();
  }
}
function authEntry() {
  const mode = state.authMode;
  const isRegister = mode === "register";
  const isReset = mode === "reset";
  const link = state.authActionUrl ? `<a class="account-action-link" href="${esc(state.authActionUrl)}">開啟本機開發驗證連結</a>` : "";
  return `<section class="account-auth-card"><div class="eyebrow accent">VIVAPREP ACCOUNT</div><h2>${isReset ? "重設密碼" : isRegister ? "建立帳號" : "登入 VivaPrep"}</h2><p>${isReset ? "輸入註冊信箱；若帳號存在，我們會寄出重設連結。" : isRegister ? "註冊後請先驗證電子郵件；密碼至少 12 個字元。" : "登入後可選擇保存個人練習歷史。訪客仍可直接練習和匿名分享。"}</p>
  ${!isReset ? `<div class="account-mode-tabs"><button class="${mode === "login" ? "is-active" : ""}" data-action="auth-mode" data-value="login">登入</button><button class="${isRegister ? "is-active" : ""}" data-action="auth-mode" data-value="register">註冊</button></div>` : ""}
  <form data-form="${isReset ? "password-reset-request" : "auth"}">${isRegister ? `<label>顯示名稱<input name="displayName" maxlength="60" autocomplete="name" required></label>` : ""}<label>電子郵件<input type="email" name="email" maxlength="254" autocomplete="email" value="${esc(state.authEmail)}" required></label>${isReset ? "" : `<label>密碼<input type="password" name="password" minlength="12" maxlength="128" autocomplete="${isRegister ? "new-password" : "current-password"}" required></label>`}<button class="button button-primary full-button" type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "處理中…" : isReset ? "寄送重設連結" : isRegister ? "建立帳號並寄送驗證信" : "登入"}</button></form>
  ${!isReset && !isRegister ? `<button class="text-link account-forgot" data-action="auth-mode" data-value="reset">忘記密碼？</button><button class="text-link account-forgot" data-action="resend-verification">重新寄送驗證信</button>` : `<button class="text-link account-forgot" data-action="auth-mode" data-value="login">返回登入</button>`}<p class="form-status" role="status">${esc(state.authMessage)}</p>${link}<small class="subtle-copy">不會在此瀏覽器保存密碼或登入 token；登入狀態由安全 Cookie 維護。</small></section>`;
}

function accountPage() {
  if (!state.auth?.authenticated) return intro(0, "管理帳號與練習資料", "登入後可跨裝置查看你明確選擇保存的歷史；心得分享仍與帳號和練習紀錄分開。") + authEntry();
  const account = state.account;
  const historyRows = state.accountHistory.map((item) => `<article class="account-history-row"><div><strong>${esc(item.profile_id)}・${esc(item.admission_route)}</strong><small>${new Date(item.ended_at).toLocaleString("zh-TW")}・保存期限至 ${new Date(item.retention_expires_at).toLocaleDateString("zh-TW")}</small></div><button class="button button-quiet" data-action="history-open" data-id="${esc(item.history_id)}">查看</button><button class="button button-quiet danger-text" data-action="history-delete" data-id="${esc(item.history_id)}">刪除</button></article>`).join("");
  const sessionRows = state.accountSessions.map((item) => `<article class="account-history-row"><div><strong>${item.session_id === account?.currentSessionId ? "目前裝置" : "已登入裝置"}</strong><small>最近活動 ${new Date(item.last_seen_at).toLocaleString("zh-TW")}・有效至 ${new Date(item.absolute_expires_at).toLocaleDateString("zh-TW")}</small></div><button class="button button-quiet danger-text" data-action="revoke-device" data-id="${esc(item.session_id)}">${item.session_id === account?.currentSessionId ? "登出此裝置" : "撤銷登入"}</button></article>`).join("");
  const history = state.selectedHistory ? (() => {
    const selected = state.selectedHistory;
    const comparable = state.accountHistory
      .filter((item) => item.profile_id === selected.profileId && item.profile_version === selected.profileVersion && item.cameraMetricsSummary)
      .slice(0, 3);
    const selectedInList = comparable.some((item) => item.history_id === selected.historyId);
    if (selected.cameraMetricsSummary && !selectedInList) comparable.unshift({
      history_id: selected.historyId,
      ended_at: selected.endedAt,
      cameraMetricsSummary: selected.cameraMetricsSummary,
    });
    comparable.sort((a, b) => new Date(b.ended_at || selected.endedAt) - new Date(a.ended_at || selected.endedAt));
    const comparison = comparable.length > 1
      ? `<section class="camera-history-comparison"><h3>同一校系情境的近期鏡頭摘要</h3>${comparable.slice(0, 3).map((item) => `<article><strong>${new Date(item.ended_at || selected.endedAt).toLocaleDateString("zh-TW")}</strong>${cameraHistoryMetricsMarkup(item.cameraMetricsSummary)}</article>`).join("")}<p class="subtle-copy">只並列同版本、已同意保存的摘要。取景、裝置和練習情境會影響數值；這不是進步排名或因果判斷。</p></section>`
      : "";
    return `<section class="account-detail-card"><div class="section-heading compact-heading"><div><span class="eyebrow">PRIVATE PRACTICE HISTORY</span><h2>練習紀錄</h2></div><button class="text-link" data-action="history-close">關閉</button></div><section class="history-camera-card"><h3>本場鏡頭衍生摘要</h3>${cameraHistoryMetricsMarkup(selected.cameraMetricsSummary)}</section>${comparison}${(selected.turns || []).map((turn) => `<article class="history-turn"><strong>${esc(turn.speakerId)}・${esc(turn.questionText)}</strong><p>${esc(turn.answerText || "尚未回答")}</p>${(turn.followUps || []).map((follow) => `<small>追問：${esc(follow)}</small>`).join("")}</article>`).join("")}</section>`;
  })() : "";
  const mfaAllowed = Boolean(state.auth.capabilities?.mfaSetupAllowed);
  const mfaCard = mfaAllowed ? `<section class="account-detail-card"><div class="section-heading compact-heading"><div><span class="eyebrow">ADMIN SECURITY</span><h2>管理者雙重驗證</h2></div><span class="status-pill ${state.accountMfa?.enabled ? "is-ready" : ""}">${state.accountMfa?.enabled ? "已啟用" : "尚未啟用"}</span></div><p class="subtle-copy">審核、管理與隱私操作必須先以驗證器完成雙重驗證。</p>${!state.accountMfa?.enabled ? state.mfaSecret ? `<p>在驗證器 App 手動新增 VivaPrep 帳號，並輸入下方 6 位數驗證碼。</p><code class="mfa-secret">${esc(state.mfaSecret)}</code><form data-form="mfa-confirm"><label>驗證碼<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="button button-primary" type="submit">確認並啟用</button></form>` : `<button class="button button-outline" data-action="mfa-setup">開始設定驗證器</button>` : `<form data-form="mfa-verify"><label>輸入目前的 6 位數驗證碼<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="button button-primary" type="submit">驗證本次管理工作階段</button></form><small>${state.auth.capabilities?.mfaRequired ? "尚未驗證，本工作階段的管理操作會被拒絕。" : "本工作階段已完成 MFA 驗證。"}</small>`}${state.mfaRecoveryCodes.length ? `<div class="recovery-codes"><strong>一次性復原碼（只顯示這一次）</strong><p>請妥善保存；每組只能使用一次。</p><code>${state.mfaRecoveryCodes.map(esc).join("　")}</code><button class="button button-outline" data-action="copy-mfa-codes">複製復原碼</button></div>` : ""}</section>` : "";
  const moderation = mfaAllowed ? `<section class="account-detail-card"><div class="section-heading compact-heading"><div><span class="eyebrow">COMMUNITY REVIEW</span><h2>心得審核</h2></div><button class="button button-outline" data-action="load-reports" ${state.auth.capabilities?.mfaRequired ? "disabled" : ""}>載入待審內容</button></div>${(state.pendingReports || []).map((report) => `<article class="moderation-card"><strong>${esc(report.title || "匿名面試心得")}</strong><small>${esc(report.schoolId)}・${esc(report.departmentId)}・${esc(report.academicYear)} 學年度</small>${report.legacyImport ? `<div class="share-findings">這是舊版匯入資料，沒有目前版本的分享告知證據，不能核准進入檢索；請拒絕並要求提交者依新版流程重新送出。</div>` : ""}${report.piiFindings?.length ? `<small>掃描提示：${report.piiFindings.map((item) => esc(item.type)).join("、")}</small>` : ""}<p>${esc(report.summary)}</p><label>審核備註<textarea id="moderation-note-${esc(report.reportId)}" rows="2" maxlength="500"></textarea></label><div class="moderation-actions"><button class="button button-primary" data-action="review-report" data-id="${esc(report.reportId)}" data-decision="approved" ${report.legacyImport ? "disabled" : ""}>核准並加入檢索</button><button class="button button-quiet" data-action="review-report" data-id="${esc(report.reportId)}" data-decision="needs_changes">要求修改</button><button class="button button-quiet danger-text" data-action="review-report" data-id="${esc(report.reportId)}" data-decision="rejected">拒絕</button></div></article>`).join("") || `<p class="subtle-copy">${state.pendingReports ? "目前沒有待審心得。" : "載入前需先完成雙重驗證。"}</p>`}</section>` : "";
  const privacyOperator = mfaAllowed ? `<section class="account-detail-card"><div class="section-heading compact-heading"><div><span class="eyebrow">PRIVACY OPERATIONS</span><h2>個資申請處理</h2></div><button class="button button-outline" data-action="load-privacy-requests" ${state.auth.capabilities?.mfaRequired ? "disabled" : ""}>載入待處理申請</button></div>${(state.pendingPrivacyRequests || []).map((request) => `<article class="account-history-row"><div><strong>${esc(request.request_type)}・${esc(request.request_id)}</strong><small>提出時間 ${new Date(request.created_at).toLocaleString("zh-TW")}</small></div><button class="button button-primary" data-action="complete-privacy-request" data-id="${esc(request.request_id)}">標記已完成</button></article>`).join("") || `<p class="subtle-copy">${state.pendingPrivacyRequests ? "目前沒有待處理申請。" : "載入前需先完成雙重驗證。"}</p>`}</section>` : "";
  return intro(0, "管理帳號與練習資料", "個人練習紀錄只屬於你的帳號；匿名心得另外保存，帳號刪除不會替代心得撤回。") +
    `<div class="account-overview"><section class="account-detail-card"><div class="eyebrow accent">SIGNED IN</div><h2>${esc(account?.user?.displayName || state.auth.user?.displayName)}</h2><p>${esc(account?.user?.email || state.auth.user?.email)}</p><div class="account-stats"><div><strong>${state.accountHistory.length}</strong><small>已保存練習</small></div><div><strong>${state.accountSessions.length}</strong><small>有效登入裝置</small></div></div><div class="account-actions"><button class="button button-outline" data-action="export-account">下載完整資料副本</button><button class="button button-quiet" data-action="logout">登出此裝置</button><button class="button button-quiet" data-action="logout-all">登出所有裝置</button></div></section>
    <section class="account-detail-card"><div class="eyebrow">ACCOUNT SECURITY</div><h2>帳號資料與密碼</h2><form data-form="display-name"><label>顯示名稱<input name="displayName" maxlength="60" value="${esc(account?.user?.displayName || "")}" required></label><button class="button button-outline" type="submit">更新顯示名稱</button></form><form data-form="change-password"><label>目前密碼<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>新密碼（至少 12 個字元）<input name="newPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="button button-outline" type="submit">更新密碼並登出其他裝置</button></form></section>
    <section class="account-detail-card"><div class="section-heading compact-heading"><div><span class="eyebrow">ACTIVE LOGIN SESSIONS</span><h2>登入裝置</h2></div></div>${sessionRows || `<p class="subtle-copy">目前沒有有效的其他裝置。</p>`}</section>
    <section class="account-detail-card"><div class="section-heading compact-heading"><div><span class="eyebrow">YOUR PRIVATE HISTORY</span><h2>個人練習歷史</h2></div><span class="muted-count">${state.accountHistory.length} 筆</span></div><p class="subtle-copy">只有在建立練習時明確勾選保存的完成場次會出現在這裡；分享心得不會連回這些資料。</p>${state.accountLoading ? `<p>載入中…</p>` : historyRows || `<p class="subtle-copy">目前沒有保存的練習紀錄。</p>`}${history}</section>
    <section class="account-detail-card"><div class="eyebrow">PRIVACY REQUESTS</div><h2>個資權利</h2><p>你可下載資料副本，或提交查詢、資料更正及停止處理請求。</p><div class="privacy-request-actions"><button class="button button-outline" data-action="privacy-request" data-value="access">提交資料查詢</button><button class="button button-outline" data-action="privacy-request" data-value="correction">提交資料更正</button><button class="button button-outline" data-action="privacy-request" data-value="stop_processing">提交停止處理</button></div></section>
    ${mfaCard}${moderation}${privacyOperator}
    <section class="account-detail-card danger-zone"><div class="eyebrow">ACCOUNT DELETION</div><h2>刪除帳號</h2><p>會先登出所有裝置並寄送取消連結；30 天後永久刪除帳號與私人練習歷史。匿名分享是獨立資料，需要另外以撤回碼撤回。</p><button class="button button-quiet danger-text" data-action="delete-account">申請刪除帳號</button></section></div>${state.authMessage ? `<p class="form-status" role="status">${esc(state.authMessage)}</p>` : ""}`;
}

function sharePage() {
  const p = profile();
  const shareProfiles = profiles;
  const defaultShareProfile = shareProfiles.find((item) => item.id === p.id) || shareProfiles[0];
  const preview = state.sharePreview;
  const policy = state.sharePolicy;
  const result = state.shareResult;
  const withdrawal = `<section class="account-detail-card"><div class="eyebrow">WITHDRAW A REPORT</div><h2>撤回已分享的心得</h2><p>輸入送出時顯示的一次性心得編號與撤回碼；單靠編號無法讀取內容。</p><form data-form="report-withdraw"><label>心得編號<input name="reportId" maxlength="80" required></label><label>一次性撤回碼<input name="withdrawalCode" autocomplete="off" required></label><button class="button button-outline" type="submit">撤回心得</button></form><p class="form-status">${esc(state.shareWithdrawalMessage)}</p></section>`;
  return intro(0, "分享匿名面試心得", "心得會和帳號及練習場次分開保存。送出前先看去識別預覽；需由審核者核准後才會加入共用檢索。") +
    `<div class="share-layout"><section class="account-detail-card"><div class="eyebrow accent">OPTIONAL COMMUNITY CONTRIBUTION</div><h2>整理一段可分享的經驗</h2><p class="subtle-copy">${esc(policy?.noticeText || "分享內容只供審核後的面試經驗檢索；請先移除自己與第三人的識別資訊。")}</p><form data-form="report-preview"><label>心得標題<input name="title" maxlength="120" value="" placeholder="例如：面試官常從專題延伸追問" required></label><label>練習校系<select name="profileId">${shareProfiles.map((item) => `<option value="${esc(item.id)}" ${item.id === defaultShareProfile?.id ? "selected" : ""}>${esc(item.school)}・${esc(item.dept)}・${esc(item.route)}</option>`).join("")}</select></label><label>學年度<input name="academicYear" type="number" min="100" max="200" value="${esc(defaultShareProfile?.academicYear || 115)}" required></label><label>面試形式<input name="format" maxlength="40" value="個人申請面試" required></label><label>主題（每行一項）<textarea name="topics" rows="3" maxlength="700" placeholder="專題實作\n學習動機"></textarea></label><label>匿名心得摘要<textarea name="summary" rows="7" minlength="20" maxlength="2500" placeholder="描述面試過程、問題方向與準備經驗。不要放姓名、聯絡方式、考生編號或可辨識他人的細節。" required></textarea></label><button class="button button-outline" type="submit" ${state.shareBusy ? "disabled" : ""}>${state.shareBusy ? "掃描中…" : "掃描並預覽去識別內容"}</button></form>
    ${preview ? `<section class="share-preview"><h3>送出前預覽</h3><p><strong>${esc(preview.title || "匿名心得")}</strong></p><p>${esc(preview.summary)}</p><div class="share-findings">${(preview.findings || []).length ? `已遮蔽／移除 ${preview.findings.length} 個可能識別項目：${(preview.findings || []).map((item) => esc(item.type)).join("、")}` : "自動掃描未找到明顯識別資訊；仍請你自行檢查內容。"}</div><form data-form="report-submit"><label class="consent-check"><input type="checkbox" name="consentToShare"><span>我已閱讀分享說明，並獨立同意將此預覽內容提交審核及在核准後用於共用檢索。</span></label><label class="consent-check"><input type="checkbox" name="confirmNoIdentifiers"><span>我已逐字檢查，確認不含可辨識自己或第三人的資訊。</span></label><button class="button button-primary" type="submit" ${state.shareBusy ? "disabled" : ""}>確認同意並送交審核</button></form></section>` : ""}
    ${result ? `<section class="share-result"><h3>已送交審核</h3><p>狀態：${esc(result.state)}。核准前不會加入共用檢索。</p><label>心得編號<input readonly value="${esc(result.reportId)}"></label><label>一次性撤回碼<input readonly value="${esc(result.withdrawalCode)}"></label><button class="button button-outline" data-action="copy-withdrawal">複製撤回資訊</button><p>請立即保存撤回碼；離開此頁後不會再次顯示。</p></section>` : ""}</section>${withdrawal}</div>${state.authMessage ? `<p class="form-status">${esc(state.authMessage)}</p>` : ""}`;
}

// While the student picks a panel or checks devices, open the CLI model
// connection so the opening question does not pay its 15-25 s first call.
let agentPrewarmedAt = 0;
function maybePrewarmAgent() {
  if (state.agentMode !== "cli" || !["setup", "device"].includes(state.page) || Date.now() - agentPrewarmedAt < 120000) return;
  agentPrewarmedAt = Date.now();
  void api("/api/agent/prewarm", { method: "POST", body: "{}" }).catch(() => { agentPrewarmedAt = 0; });
}

function render() {
  maybePrewarmAgent();
  if (state.page === "device") maybeProbeLive();
  if (state.page === "interview") {
    app.innerHTML = interviewPage();
    if (!state.closing) startAudioMonitor();
    if (!clock) clock = setInterval(() => {
      if (!interviewTiming.countsTowardPractice() || state.confirmEnd || state.finishing) return;
      state.elapsed++;
      state.remaining = Math.max(0, Number(state.config.duration) * 60 - state.elapsed);
      if (liveLink && state.elapsed % 5 === 0) liveLink.send({ type: "progress", elapsedSeconds: state.elapsed });
      if (state.elapsed % 15 === 0 || state.remaining === closingWindowSeconds()) {
        void api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/progress", { method: "POST", body: JSON.stringify({ elapsedSeconds: state.elapsed }) }).catch(() => {});
      }
      const e = document.getElementById("remaining-time"); if (e) e.textContent = remainingText();
      const timer = document.querySelector(".interview-timer"); if (timer) timer.classList.toggle("is-urgent", state.remaining <= 60);
      if (state.remaining <= 0) finishInterview("time");
    }, 1000);
    if (!silenceClock) silenceClock = setInterval(() => {
      if (state.page !== "interview") return;
      updateConversationHud();
      if (silenceRemainingMs() === 0) triggerFollowUp();
    }, 250);
    updateConversationHud();
  } else {
    if (clock) clearInterval(clock); clock = null;
    if (silenceClock) clearInterval(silenceClock); silenceClock = null;
    const views = { home: homePage, profile: profilePage, resume: resumePage, library: libraryPage, setup: setupPage, device: devicePage, review: reviewPage, account: accountPage, share: sharePage, settings: settingsPage };
    app.innerHTML = shell((views[state.page] || homePage)(), state.page === "home" ? "is-home" : "");
    const video = document.getElementById("device-video"); if (video && state.stream) video.srcObject = state.stream;
    if (state.page === "device") startAudioMonitor();
  }
}
async function startInterview() {
  if (state.sessionStarting) return;
  if (state.deviceChecking) return notify("請等麥克風連接完成後再開始。");
  if (state.resumeParsing) return notify("請等 PDF 整理完成後再開始。");
  if (!state.libraryReady || state.resumeParsing) return notify("請等備審載入或整理完成後再開始。");
  if (state.confirmClaims && selectedPortfolioClaims().filter((claim) => claim.text.trim()).length > 40) return notify("本場最多使用 40 個主張，請減少選用文件或主張。");
  if (state.agentMode === "gemini-api" && !state.health?.geminiApiConfigured) return notify("Gemini API key 尚未設定，請先完成伺服器設定。面試目前不會改用 mock。 ");
  if (startRestriction()) return notify(startRestriction());
  state.sessionStarting = true;
  state.waitingForAgent = true;
  render();
  try {
    if (state.config.mode === "voice") {
      if (!state.speechStatus?.available) { notify("語音辨識服務尚未準備好，請改用文字方式或稍後重試。"); return; }
      if (!state.stream?.getAudioTracks().some((track) => track.readyState === "live")) await acquireMicrophone();
      if (!state.audioReady) return;
    }
    // The device-page probe decides Live for this session; wait if it is still running.
    if (liveEligible() && liveConsented()) await maybeProbeLive();
    stopAudioMonitor();
    if (state.stream) {
      if (!state.cameraAnalysisConsent) state.stream.getVideoTracks().forEach((track) => track.stop());
      const audioTracks = state.stream.getAudioTracks().filter((track) => track.readyState === "live");
      const videoTracks = state.cameraAnalysisConsent ? state.stream.getVideoTracks().filter((track) => track.readyState === "live") : [];
      state.stream = audioTracks.length || videoTracks.length ? new MediaStream([...audioTracks, ...videoTracks]) : null;
      state.audioReady = audioTracks.length > 0;
      state.deviceReady = false;
    }
    if (state.cameraAnalysisConsent && !state.stream?.getVideoTracks().some((track) => track.readyState === "live")) {
      state.waitingForAgent = false;
      state.page = "device";
      render();
      notify("請先在設備檢查頁開啟鏡頭預覽，再開始本機試測；也可以取消勾選後繼續。");
      return;
    }
    stopEventStream();
    if (state.sessionId) await api("/api/sessions/" + encodeURIComponent(state.sessionId), { method: "DELETE" }).catch(() => {});
    streamingRecognitionFailure = "";
    const result = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        profileId: state.profileId,
        customProfile: profile().customProfile || undefined,
        panelIds: state.people,
        durationMinutes: Number(state.config.duration),
        mode: state.config.mode,
        captionsEnabled: state.config.captions,
        seed: Number(state.seed),
        confirmedClaims: state.confirmClaims ? selectedPortfolioClaims().map((claim) => ({ text: claim.text, sourcePage: claim.sourcePage, evidenceQuote: claim.evidenceQuote, claimType: claim.claimType, confidence: claim.confidence, documentId: claim.documentId, sourceFilename: claim.sourceFilename })) : [],
        retentionMode: state.saveHistory ? "saved" : "ephemeral",
        cameraAnalysis: state.cameraAnalysisConsent,
        liveVoice: plansLive(),
        consent: { modelProcessing: state.consentModel, audioProcessing: state.consentAudio, liveVoice: plansLive(), speechRecognition: usesStreamingRecognition() ? "browser" : "server", saveHistory: state.saveHistory, cameraMetricsProcessing: state.cameraMetricsConsent },
      }),
    });
    state.sessionId = result.session.sessionId;
    state.agentMode = result.agentMode;
    state.speechStatus = result.speech || { available: false };
    state.voiceEnabled = Boolean(result.session.voiceEnabled);
    state.currentEvent = result.event;
    state.eventSequence = result.event?.seq || 0;
    state.page = "interview"; state.q = 0; state.answers = []; state.backendTurns = [];
    state.cameraAnalysisSummary = null;
    state.cameraPhase = "question_visible_window";
    if (result.event) state.backendTurns.push({ turnId: result.event.turnId, roleId: result.event.roleId, speakerId: result.event.speakerId, questionText: result.event.utterance, answerText: "", followUps: [] });
    state.followUps = []; state.followUp = ""; state.draft = ""; state.endReason = "";
    state.review = null; state.reviewError = null; state.elapsed = 0; state.remaining = Number(state.config.duration) * 60; state.muted = false; state.confirmEnd = false; state.waitingForAgent = false;
    state.closing = false; state.finishing = false; state.reviewStarting = false; clearTimeout(closingTimer);
    state.liveCaption = "";
    state.liveNotice = liveEligible() && liveConsented() && !result.live ? "即時對談無法使用，改用回合制" : "";
    // Live speaks its own opening once the socket connects; no Agent question exists yet.
    if (result.live) interviewTiming.pause("preparing");
    else prepareQuestion(result.event);
    connectEventStream();
    render();
    if (result.live) void startLiveConversation(result.live.ticket);
    else if (result.event.audioUrl && state.voiceEnabled) playAudio(result.event.audioUrl, result.event.seq);
    if (state.cameraAnalysisConsent) void startCameraTrial();
  } catch (error) {
    state.waitingForAgent = false;
    if (!state.audioReady && state.config.mode === "voice") state.page = "device";
    render();
    notify(error.message);
  } finally {
    state.sessionStarting = false;
    state.waitingForAgent = state.page === "device" ? false : state.waitingForAgent;
    if (state.page === "device") render();
  }
}
async function submitAnswer() {
  const input = app.querySelector('[data-form="answer"] textarea');
  const answer = input?.value.trim() || state.draft.trim();
  if (!answer) { notify("先輸入一段回答，再讓教授繼續提問。"); input?.focus(); return; }
  if (!state.sessionId || state.waitingForAgent) return false;
  if (liveLink) {
    if (!liveLink.send({ type: "text", text: answer })) { notify("即時對談連線中斷，請稍候改用回合制。"); return false; }
    state.draft = "";
    if (input) input.value = "";
    clearLiveTranscript();
    interviewTiming.pause("thinking");
    notify("已送出文字回答：" + answer.slice(0, 45));
    render();
    return true;
  }
  const turn = state.backendTurns.find((item) => item.turnId === state.currentEvent?.turnId);
  if (!turn || turn.answerText) { notify("教授正在準備下一題，請稍候。"); return false; }
  stopQuestionAudio();
  discardRecording();
  interviewTiming.pause("thinking");
  state.waitingForAgent = true;
  state.cameraPhase = "agent_transition";
  state.lastActivityAt = Date.now();
  render();
  try {
    await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/answers", {
      method: "POST",
      body: JSON.stringify({ clientTurnId: window.crypto?.randomUUID?.() || String(Date.now()), turnId: turn.turnId, text: answer, elapsedSeconds: state.elapsed, submittedAt: new Date().toISOString() }),
    });
    turn.answerText = answer;
    state.answers[state.q] = answer;
    state.draft = "";
    render();
    return true;
  } catch (error) {
    state.waitingForAgent = false;
    state.cameraPhase = "candidate_answer";
    state.draft = answer;
    interviewTiming.listen();
    notify(error.message);
    render();
    return false;
  }
}
function setPanel(id) { const item = panels.find((p) => p.id === id); if (!item) return; state.panel = item.id; state.people = [...item.people]; render(); }
function togglePerson(id) {
  if (state.people.includes(id)) {
    if (state.people.length === 1) return notify("至少保留一位考官。");
    state.people = state.people.filter((x) => x !== id);
  } else { if (state.people.length === 3) return notify("一場面試最多安排三位考官。"); state.people.push(id); }
  state.panel = "custom"; render();
}
async function checkDevices() {
  if (state.deviceChecking) return;
  state.deviceChecking = true;
  render();
  try {
    await acquireMicrophone();
    if (!state.audioReady) return;
    if (state.page === "interview" && state.voiceEnabled) {
      state.voiceRetryRequired = false;
      if (interviewTiming.phase === "capturing") interviewTiming.listen();
      if (interviewTiming.phase === "listening") startVoiceCapture();
    }
    notify("麥克風已連接，請說一句話確認音量表。");
  }
  catch (error) { notify(error.message); }
  finally { state.deviceChecking = false; render(); }
}
function microphoneFailure(error) {
  if (!navigator.mediaDevices?.getUserMedia) return "此瀏覽器無法使用麥克風。請以 localhost 或 HTTPS 開啟，或改用支援錄音的瀏覽器。";
  return {
    NotAllowedError: "麥克風權限被拒絕。請在瀏覽器的網站權限允許麥克風，並確認 Windows「隱私權與安全性 → 麥克風」允許桌面應用程式。",
    NotFoundError: "找不到可用麥克風。請接上裝置，並在 Windows 音效設定確認輸入裝置。",
    NotReadableError: "麥克風無法啟動。可能被其他程式占用或裝置異常，請關閉其他錄音程式後重試。",
    OverconstrainedError: "所選麥克風已無法使用，請重新選擇輸入裝置。",
  }[error?.name] || "無法連接麥克風，請檢查輸入装置後重試。仍可改用文字回答。";
}
async function refreshMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.microphones = devices.filter((item) => item.kind === "audioinput" && item.deviceId !== "communications");
}
async function acquireMicrophone() {
  const generation = ++voiceRequestGeneration;
  const previousPage = state.page;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("MIC_UNAVAILABLE");
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (state.microphoneId) audio.deviceId = { exact: state.microphoneId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    if (generation !== voiceRequestGeneration || state.page !== previousPage) { stream.getTracks().forEach((track) => track.stop()); return; }
    const tracks = stream.getAudioTracks().filter((track) => track.readyState === "live");
    if (!tracks.length) { stream.getTracks().forEach((track) => track.stop()); throw { name: "NotFoundError" }; }
    discardRecording();
    stopAudioMonitor();
    state.stream?.getAudioTracks().forEach((track) => track.stop());
    state.stream = new MediaStream([...(state.stream?.getVideoTracks().filter((track) => track.readyState === "live") || []), ...tracks]);
    state.microphoneName = tracks[0].label || "麥克風";
    state.audioReady = true;
    state.muted = false;
    state.microphoneError = "";
    state.microphoneHeard = false;
    for (const track of tracks) track.onended = () => {
      if (!state.stream?.getAudioTracks().includes(track)) return;
      state.audioReady = state.stream.getAudioTracks().some((item) => item.readyState === "live");
      if (!state.audioReady) { discardRecording(); stopAudioMonitor(); state.microphoneError = "麥克風已中斷，請重新連接或改用文字回答。"; render(); }
    };
    await refreshMicrophones().catch(() => {});
    startAudioMonitor();
  } catch (error) {
    if (generation !== voiceRequestGeneration) return;
    state.audioReady = state.stream?.getAudioTracks().some((track) => track.readyState === "live") || false;
    state.microphoneError = microphoneFailure(error);
    throw new Error(state.microphoneError);
  }
}
async function checkCamera() {
  const generation = cameraTrialGeneration;
  const page = state.page;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("CAMERA_UNAVAILABLE");
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (generation !== cameraTrialGeneration || state.page !== page) { stream.getTracks().forEach((track) => track.stop()); return; }
    state.stream?.getVideoTracks().forEach((track) => track.stop());
    state.stream = new MediaStream([...(state.stream?.getAudioTracks().filter((track) => track.readyState === "live") || []), ...stream.getVideoTracks()]);
    state.deviceReady = stream.getVideoTracks().some((track) => track.readyState === "live");
    state.cameraError = "";
  } catch { state.deviceReady = false; state.cameraError = "鏡頭無法開啟；麥克風仍可獨立使用。"; }
  render();
}
async function toggleMic() {
  if (state.deviceChecking || state.finishing || state.closing) return;
  if (!state.voiceEnabled) {
    if (!state.consentAudio || (usesExternalAgent() && !state.consentModel)) return notify("語音回答尚未授權，請在下一場開始前到資料使用設定開啟。");
    if (!state.speechStatus?.available) return notify("語音服務尚未準備好，請先使用文字回答。");
    state.deviceChecking = true;
    try {
      await acquireMicrophone();
      if (!state.audioReady) return;
      const result = await api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/settings", { method: "PATCH", body: JSON.stringify({ mode: "voice", audioProcessing: true, speechRecognition: usesStreamingRecognition() ? "browser" : "server" }) });
      state.voiceEnabled = Boolean(result.session.voiceEnabled);
      state.config.mode = result.session.mode;
      state.voiceRetryRequired = false;
      if (interviewTiming.phase === "listening") startVoiceCapture();
    } catch (error) { notify(error.message); }
    finally { state.deviceChecking = false; render(); }
    return;
  }
  if (!state.audioReady || !state.stream?.getAudioTracks().some((track) => track.readyState === "live")) {
    if (!navigator.mediaDevices?.getUserMedia) return notify("瀏覽器沒有可用的麥克風；停頓追問會依文字輸入節奏觸發。");
    try {
      await acquireMicrophone();
      if (!state.audioReady) return;
      state.lastActivityAt = Date.now();
      state.voiceRetryRequired = false;
      startAudioMonitor();
      if (interviewTiming.phase === "listening") startVoiceCapture();
      render();
    } catch (error) {
      state.muted = true; render();
      notify(error.message);
    }
    return;
  }
  if (state.voiceRetryRequired) { state.voiceRetryRequired = false; state.muted = false; }
  else state.muted = !state.muted;
  state.stream?.getAudioTracks().forEach((track) => { track.enabled = !state.muted; });
  if (state.muted) { discardRecording(); stopAudioMonitor(); if (interviewTiming.phase === "capturing") interviewTiming.listen(); }
  else { startAudioMonitor(); if (interviewTiming.phase === "capturing") interviewTiming.listen(); if (interviewTiming.phase === "listening") startVoiceCapture(); }
  state.lastActivityAt = Date.now();
  interviewTiming.activity();
  render();
}
function reportCandidateActivity() {
  const event = state.currentEvent;
  if (state.finishing || state.closing || !state.sessionId || !event || (candidateActivitySequence === event.seq && !state.nudgePending)) return;
  candidateActivitySequence = event.seq;
  void api("/api/sessions/" + encodeURIComponent(state.sessionId) + "/activity", {
    method: "POST", body: JSON.stringify({ turnId: event.turnId, eventSeq: event.seq, elapsedSeconds: state.elapsed }),
  }).catch(() => {});
}
function discardRecording() {
  if (voiceCapture) {
    voiceCapture.cancelled = true; voiceCapture.resolve?.(); voiceCapture.chunks.length = 0;
    if (voiceCapture.kind === "stream") { clearTimeout(voiceCapture.timer); try { voiceCapture.recognition.abort(); } catch { /* Already stopped. */ } }
  }
  if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  voiceCapture = null;
  state.recorder = null;
  state.recording = false;
  state.voiceDetected = false;
  voiceActivity.reset();
  clearLiveTranscript();
}
function markVoiceStart() {
  if (voiceCapture && !voiceCapture.speechStartedAt) voiceCapture.speechStartedAt = Date.now();
  state.voiceDetected = true;
  interviewTiming.pause("capturing");
  state.cameraPhase = "candidate_answer";
  reportCandidateActivity();
}
// Recognized words stay out of the answer box: the professor reads past
// recognition errors, but a student seeing them would think they were misheard.
function showLiveTranscript(text) { state.liveTranscript = text; }
function clearLiveTranscript() { state.liveTranscript = ""; }
// The same question listens once more by itself before asking for the retry button.
function resumeAfterVoiceMiss(capture, retryable, message) {
  const retryKey = `${capture.turnId}:${capture.eventSeq}`;
  const autoRetry = retryable && state.autoRetriedVoiceTurn !== retryKey;
  if (autoRetry) state.autoRetriedVoiceTurn = retryKey;
  state.voiceRetryRequired = !autoRetry;
  interviewTiming.listen();
  notify(autoRetry ? "剛才沒有聽清楚，請再說一次；也可以直接打字回答。" : message);
  render();
  if (autoRetry) startVoiceCapture();
}
const streamText = (capture) => (capture.committed + capture.final + capture.interim).trim();
function startRecognitionSession(capture) {
  capture.sessionStartedAt = Date.now();
  // Newer Chrome accepts the selected microphone track; older versions ignore it and use the default input.
  try { capture.recognition.start(capture.track); return true; }
  catch { try { capture.recognition.start(); return true; } catch { return false; } }
}
function startStreamingCapture(tracks) {
  const Recognition = SpeechRecognitionClass();
  const capture = { kind: "stream", sessionId: state.sessionId, turnId: state.currentEvent.turnId, eventSeq: state.currentEvent.seq, startedAt: Date.now(), track: tracks[0], chunks: [], generation: voiceRequestGeneration, cancelled: false, submit: false, finished: false, committed: "", final: "", interim: "", lastResultAt: 0, lastVoiceAt: 0, lastWordsAt: 0, speechStartedAt: 0, wordlessSpeech: 0, quickEnds: 0, timer: null };
  try {
    capture.recognition = new Recognition();
    Object.assign(capture.recognition, { lang: "zh-TW", continuous: true, interimResults: true, maxAlternatives: 1 });
  } catch { streamingRecognitionFailure = "unavailable"; return false; }
  capture.recognition.onresult = (event) => onStreamResult(capture, event);
  capture.recognition.onerror = (event) => onStreamError(capture, event.error);
  capture.recognition.onend = () => onStreamEnd(capture);
  voiceCapture = capture;
  if (!startRecognitionSession(capture)) { voiceCapture = null; streamingRecognitionFailure = "start-failed"; return false; }
  state.recording = true;
  state.voiceDetected = false;
  voiceActivity.reset();
  startAudioMonitor();
  return true;
}
function onStreamResult(capture, event) {
  if (voiceCapture !== capture || capture.cancelled || capture.finished) return;
  let final = "", interim = "";
  for (let index = 0; index < event.results.length; index++) {
    const result = event.results[index];
    if (result.isFinal) final += result[0]?.transcript || ""; else interim += result[0]?.transcript || "";
  }
  const previous = streamText(capture);
  const previousInterim = capture.interim;
  Object.assign(capture, { final, interim });
  const text = streamText(capture);
  showLiveTranscript(text);
  if (!text) return;
  if (capture.submit) { if (!interim) void finishStreamingCapture(capture); return; }
  capture.lastResultAt = Date.now();
  // Changed pending words mean the student is still talking. A phrase being finalized
  // (even with a few more characters) does not, nor does Chrome resending the same interim.
  if ((interim && interim !== previousInterim) || !previous) capture.lastWordsAt = capture.lastResultAt;
  if (!state.voiceDetected) markVoiceStart();
  interviewTiming.activity();
  scheduleStreamEnd(capture);
}
function scheduleStreamEnd(capture) {
  clearTimeout(capture.timer);
  if (voiceCapture !== capture || capture.submit || !state.voiceDetected) return;
  const now = Date.now();
  const longAnswer = capture.speechStartedAt && now - capture.speechStartedAt >= MAX_STREAM_ANSWER_MS;
  const wordsQuiet = now - capture.lastWordsAt;
  const wait = Math.min(Math.max(STREAM_PAUSE_MS - (now - capture.lastVoiceAt), STREAM_WORDS_QUIET_MS - wordsQuiet), STREAM_WORDS_ONLY_END_MS - wordsQuiet);
  if (wait > 0 && !longAnswer) { capture.timer = setTimeout(() => scheduleStreamEnd(capture), wait); return; }
  completeVoiceCapture();
}
function onStreamError(capture, code) {
  if (voiceCapture !== capture || capture.cancelled || capture.finished) return;
  // Chrome reports silence as no-speech and then ends; onend listens again.
  if (code === "no-speech" || code === "aborted") return;
  if (capture.submit) { void finishStreamingCapture(capture); return; }
  fallBackToRecorder(capture, code || "error");
}
function onStreamEnd(capture) {
  if (voiceCapture !== capture || capture.cancelled || capture.finished) return;
  if (capture.submit) { void finishStreamingCapture(capture); return; }
  // Chrome closes a recognition session after silence or about a minute; keep listening on the same question.
  capture.committed = streamText(capture);
  capture.final = ""; capture.interim = "";
  capture.quickEnds = Date.now() - capture.sessionStartedAt < 1000 ? capture.quickEnds + 1 : 0;
  if (capture.quickEnds >= 3 || !startRecognitionSession(capture)) fallBackToRecorder(capture, "ended");
}
// network, not-allowed, service-not-allowed and the like: Whisper takes over for the rest of the interview.
function fallBackToRecorder(capture, reason) {
  streamingRecognitionFailure = reason;
  const text = streamText(capture);
  discardRecording();
  if (interviewTiming.phase === "capturing") interviewTiming.listen();
  if (text) {
    state.draft = text;
    notify(`瀏覽器串流辨識中斷，已保留辨識到的文字，可修改後送出；之後改用${serverRecognitionLabel()}。`);
    render();
    return;
  }
  notify(`瀏覽器串流辨識無法使用（${reason}），改用${serverRecognitionLabel()}，請再說一次。`);
  render();
  startVoiceCapture();
}
function completeStreamingCapture(capture) {
  if (!streamText(capture)) {
    // Noise without words is not an answer; keep listening on this question.
    state.voiceDetected = false;
    voiceActivity.reset();
    if (interviewTiming.phase === "capturing") interviewTiming.listen();
    if (++capture.wordlessSpeech >= 2) fallBackToRecorder(capture, "no-result");
    else updateConversationHud();
    return voiceSubmissionPromise;
  }
  capture.submit = true;
  capture.stopRequestedAt = Date.now();
  voiceSubmissionPromise = new Promise((resolve) => { capture.resolve = resolve; });
  state.transcribing = true;
  state.waitingForAgent = true;
  interviewTiming.pause("transcribing");
  state.cameraPhase = "agent_transition";
  clearTimeout(capture.timer);
  if (capture.interim) {
    try { capture.recognition.stop(); } catch { /* finish below */ }
    capture.timer = setTimeout(() => void finishStreamingCapture(capture), STREAM_FLUSH_MS);
  } else void finishStreamingCapture(capture);
  render();
  updateConversationHud();
  return voiceSubmissionPromise;
}
async function finishStreamingCapture(capture) {
  if (capture.finished) return;
  capture.finished = true;
  clearTimeout(capture.timer);
  try { capture.recognition.abort(); } catch { /* Already stopped. */ }
  if (voiceCapture === capture) voiceCapture = null;
  state.recording = false;
  state.voiceDetected = false;
  const text = streamText(capture);
  const sameSession = () => capture.generation === voiceRequestGeneration && state.sessionId === capture.sessionId && state.page === "interview";
  try {
    // A result that belongs to an older question is dropped, never sent to the new one.
    if (capture.cancelled || !sameSession() || state.currentEvent?.seq !== capture.eventSeq || state.currentEvent?.turnId !== capture.turnId) return;
    if (!text) {
      state.transcribing = false; state.waitingForAgent = false;
      resumeAfterVoiceMiss(capture, true, "沒有辨識到文字，請按「重試收音」或改用文字回答。");
      return;
    }
    const sentAt = Date.now();
    // The microphone level shows when speech stopped; result times lag it, so they are only the fallback.
    const speechEndedAt = capture.lastVoiceAt || capture.lastResultAt || capture.stopRequestedAt;
    const latency = { speechToSendMs: sentAt - speechEndedAt, wordsToSendMs: sentAt - capture.lastWordsAt, flushMs: sentAt - capture.stopRequestedAt };
    await api("/api/sessions/" + encodeURIComponent(capture.sessionId) + "/answers", {
      method: "POST",
      body: JSON.stringify({ clientTurnId: window.crypto?.randomUUID?.() || String(sentAt), turnId: capture.turnId, eventSeq: capture.eventSeq, text, elapsedSeconds: state.elapsed, submittedAt: new Date(sentAt).toISOString(), speechInput: "browser-stream", recognitionLatencyMs: latency.speechToSendMs }),
    });
    latency.acceptedMs = Date.now() - speechEndedAt;
    voiceLatencies.push(latency);
    if (voiceLatencies.length > 20) voiceLatencies.shift();
    console.info(`[VivaPrep] 串流辨識：說完到送出 ${latency.speechToSendMs} ms，後端收到 ${latency.acceptedMs} ms（最後新字到送出 ${latency.wordsToSendMs} ms，收尾 ${latency.flushMs} ms）`);
    if (!sameSession()) return;
    const turn = state.backendTurns.find((item) => item.turnId === capture.turnId);
    if (turn) turn.answerText = text;
    state.transcribing = false;
    clearLiveTranscript();
    notify("已收到你的回答");
    render();
  } catch (error) {
    if (!sameSession()) return;
    state.transcribing = false;
    state.waitingForAgent = false;
    clearLiveTranscript();
    if (error.code === "STALE_TURN") { render(); return; }
    // Keep the recognized words so the answer can be sent again as text.
    state.draft = text;
    interviewTiming.listen();
    notify(error.message);
    render();
  } finally { capture.resolve?.(); }
}
function startVoiceCapture() {
  if (liveLink || state.closing || state.finishing || !state.voiceEnabled || state.recording || state.muted || state.voiceRetryRequired || state.waitingForAgent || state.draft.trim() || interviewTiming.phase !== "listening") return;
  const tracks = state.stream?.getAudioTracks().filter((track) => track.readyState === "live" && track.enabled) || [];
  if (!tracks.length) { state.audioReady = false; return; }
  if (usesStreamingRecognition() && startStreamingCapture(tracks)) return;
  if (!window.MediaRecorder) { state.voiceRetryRequired = true; notify("瀏覽器無法錄音，請改用文字回答。"); return; }
  const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  try {
    const recorder = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType } : {});
    const capture = { sessionId: state.sessionId, turnId: state.currentEvent.turnId, eventSeq: state.currentEvent.seq, startedAt: Date.now(), chunks: [], generation: voiceRequestGeneration, cancelled: false, submit: false };
    voiceCapture = capture;
    state.recorder = recorder;
    state.recording = true;
    state.voiceDetected = false;
    voiceActivity.reset();
    recorder.ondataavailable = (event) => { if (!capture.cancelled && event.data?.size) capture.chunks.push(event.data); };
    recorder.onerror = () => {
      if (voiceCapture !== capture) return;
      discardRecording(); state.voiceRetryRequired = true;
      notify("錄音中斷，請按「重試收音」或改用文字回答。"); updateConversationHud();
    };
    recorder.onstop = async () => {
      if (capture.cancelled || !capture.submit) return;
      const blob = new Blob(capture.chunks, { type: recorder.mimeType });
      capture.chunks.length = 0;
      state.recording = false;
      state.recorder = null;
      state.voiceDetected = false;
      voiceCapture = null;
      try {
        if (!blob.size) throw new Error("沒有收到錄音，請按「重試收音」。");
        const response = await api("/api/sessions/" + encodeURIComponent(capture.sessionId) + "/audio-answers", {
          method: "POST", headers: { "Content-Type": blob.type, "X-VivaPrep-Turn": capture.turnId, "X-VivaPrep-Event-Seq": String(capture.eventSeq), "X-VivaPrep-Elapsed": String(state.elapsed) }, body: blob,
        });
        if (capture.generation !== voiceRequestGeneration || state.sessionId !== capture.sessionId || state.page !== "interview") return;
        const turn = state.backendTurns.find((item) => item.turnId === capture.turnId);
        if (turn) turn.answerText = response.transcript;
        state.transcribing = false;
        notify("已收到你的回答");
        render();
      } catch (error) {
        if (capture.generation !== voiceRequestGeneration || state.sessionId !== capture.sessionId || state.page !== "interview") return;
        state.transcribing = false;
        state.waitingForAgent = false;
        // A recognition miss should not stall the interview.
        const recognitionMiss = ["TRANSCRIPTION_FAILED", "LOCAL_SPEECH_TIMEOUT", "SPEECH_BUSY", "LOCAL_SPEECH_UNAVAILABLE", "SPEECH_PROVIDER_FAILED"].includes(error.code);
        resumeAfterVoiceMiss(capture, recognitionMiss, error.message);
      } finally { capture.resolve?.(); }
    };
    recorder.start(1000);
    startAudioMonitor();
  } catch {
    discardRecording(); state.voiceRetryRequired = true;
    notify("無法開始收音，請按「重試收音」或改用文字回答。");
  }
}
function completeVoiceCapture() {
  if (!voiceCapture || voiceCapture.submit || !state.voiceDetected) return voiceSubmissionPromise;
  if (voiceCapture.kind === "stream") return completeStreamingCapture(voiceCapture);
  if (!state.recorder) return voiceSubmissionPromise;
  voiceCapture.submit = true;
  voiceSubmissionPromise = new Promise((resolve) => { voiceCapture.resolve = resolve; });
  state.transcribing = true;
  state.waitingForAgent = true;
  interviewTiming.pause("transcribing");
  state.cameraPhase = "agent_transition";
  state.recorder.stop();
  render();
  updateConversationHud();
  return voiceSubmissionPromise;
}
function silenceRemainingMs() {
  return interviewTiming.remainingMs({
    unavailable: state.waitingForAgent || state.nudgePending || state.transcribing || state.confirmEnd || state.finishing || (state.voiceEnabled && (state.muted || !state.audioReady || state.voiceRetryRequired)),
    draft: state.draft,
  });
}
function updateConversationHud() {
  const practiceLabel=document.getElementById("practice-timer-label");
  if(practiceLabel) practiceLabel.textContent=state.closing ? "面試收尾" : interviewTiming.countsTowardPractice()?"練習倒數":"等待中・計時暫停";
  if (state.page !== "interview") return;
  const remaining = silenceRemainingMs();
  const streaming = voiceCapture?.kind === "stream" || (state.transcribing && usesStreamingRecognition());
  const labels = { preparing: liveLink ? "連線即時對談" : "準備語音", speaking: "教授說話中", playback_blocked: "請播放問題", capturing: streaming ? "即時辨識中" : "正在收音", transcribing: streaming ? "送出回答中" : "語音辨識中", thinking: "考官思考中", nudge: "考官接話中" };
  const microphoneUnavailable = state.voiceEnabled && !["preparing", "speaking", "playback_blocked", "thinking", "transcribing", "nudge"].includes(interviewTiming.phase);
  const status = state.closing ? (state.playbackBlocked ? "播放收尾，或閱讀後前往復盤" : "教授收尾中，稍後整理復盤") : microphoneUnavailable && !state.audioReady ? "請連接麥克風" : microphoneUnavailable && state.voiceRetryRequired ? "請重試收音" : microphoneUnavailable && state.muted ? "麥克風已暫停" : labels[interviewTiming.phase] || (state.draft.trim() ? "輸入回答中" : "輪到你回答");
  const value = document.getElementById("silence-value");
  if (value) value.textContent = remaining == null ? status : `${Math.ceil(remaining / 1000).toString().padStart(2, "0")} 秒`;
  const progress = document.getElementById("silence-progress");
  if (progress) progress.style.width = remaining == null ? "0%" : `${(1 - remaining / interviewTiming.waitMs) * 100}%`;
  const voice = document.getElementById("voice-status-text");
  if (voice) voice.textContent = status + (liveLink && interviewTiming.phase === "listening" ? "；直接說話，說完教授會即時接話" : state.voiceEnabled && interviewTiming.phase === "listening" && state.recording ? "；直接說話，停頓約 1.6 秒後送出" : "");
  const level = document.getElementById("microphone-level");
  if (level) level.style.width = `${Math.min(100, microphoneLevel * 700)}%`;
  const mic = app.querySelector('[data-action="mic"] small');
  if (mic) mic.textContent = !state.voiceEnabled ? "啟用語音回答" : state.voiceRetryRequired ? "重試收音" : !state.audioReady ? "連接麥克風" : state.muted ? "開啟麥克風" : "暫停麥克風";
  const send = app.querySelector('[data-action="send-voice"]');
  if (send) send.disabled = !state.voiceDetected || state.waitingForAgent;
  const currentActor = app.querySelector('.actor[data-person="' + state.currentEvent?.speakerId + '"]');
  const pose = interviewTiming.phase === "speaking" || (state.closing && questionAudio && !state.playbackBlocked) ? "speaking" : ["preparing", "thinking", "transcribing", "nudge"].includes(interviewTiming.phase) ? "thinking" : "listening";
  if (currentActor && currentActor.dataset.state !== pose) {
    currentActor.dataset.state = pose;
    for (const name of ["speaking", "thinking", "listening", "reading_notes"]) {
      currentActor.classList.toggle("state-" + name, pose === name);
      currentActor.querySelector(".actor-portrait")?.classList.toggle("pose-" + name, pose === name);
    }
    currentActor.classList.toggle("is-active-speaker", pose === "speaking");
    const label = pose === "speaking" ? (state.closing ? "面試收尾" : "正在提問") : pose === "thinking" ? "思考中" : "聆聽中";
    const nameplate = currentActor.querySelector(".actor-nameplate small");
    if (nameplate) nameplate.textContent = label;
    currentActor.querySelector(".actor-portrait")?.setAttribute("aria-label", (interviewers[state.currentEvent.speakerId]?.name || "考官") + "，" + label);
  }
}
function newSeed() {
  const v = new Uint32Array(1); if (window.crypto?.getRandomValues) window.crypto.getRandomValues(v); else v[0] = Date.now() >>> 0;
  state.seed = (v[0] % 999999) + 1;
}
function exportReview() {
  const lines = ['VivaPrep 面試復盤（' + state.agentMode + '）', profile().school + '・' + profile().dept, '',
    '復盤：' + (state.review?.summary || '尚未完成'), '',
    ...state.backendTurns.flatMap((turn, i) => [
      String(i + 1) + '. ' + (turn.roleId || '面試'),
      '考官提問：' + turn.questionText,
      ...(turn.followUps || []).map((text) => '考官接話：' + text),
      '回答：' + (turn.answerText || '尚未輸入回答'),
      '',
    ]),
    '本紀錄僅供練習，不代表官方評分或錄取結果。'];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'VivaPrep-interview-review.txt'; link.click(); URL.revokeObjectURL(link.href);
}
async function submitAuth(form) {
  if (state.authBusy) return;
  state.authBusy = true;
  const data = Object.fromEntries(new FormData(form));
  state.authEmail = data.email || state.authEmail;
  try {
    if (state.authMode === "register") {
      const result = await api("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
      state.authMessage = "帳號申請已受理。請至信箱完成驗證後再登入。";
      state.authActionUrl = result.developmentVerificationUrl || "";
    } else {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
      state.csrfToken = result.csrfToken || state.csrfToken;
      state.authMessage = "登入成功。";
      await refreshAuth();
      await loadAccountData();
    }
  } catch (error) { state.authMessage = error.message; }
  finally { state.authBusy = false; if (state.page === "account") render(); }
}
async function requestPasswordReset(form) {
  if (state.authBusy) return;
  state.authBusy = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    state.authEmail = data.email || state.authEmail;
    const result = await api("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify(data) });
    state.authMessage = "若該信箱有已驗證帳號，重設連結已寄出。";
    state.authActionUrl = result.developmentResetUrl || "";
  } catch (error) { state.authMessage = error.message; }
  finally { state.authBusy = false; render(); }
}
async function resendVerification() {
  const email = state.authEmail || prompt("請輸入註冊時使用的電子郵件：") || "";
  if (!email) return;
  state.authEmail = email;
  try {
    const result = await api("/api/auth/verification/resend", { method: "POST", body: JSON.stringify({ email }) });
    state.authMessage = "若該信箱有待驗證帳號，驗證連結已寄出。";
    state.authActionUrl = result.developmentVerificationUrl || "";
    render();
  } catch (error) { state.authMessage = error.message; render(); }
}
async function updateDisplayName(form) {
  try {
    await api("/api/account", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    await refreshAuth();
    await loadAccountData();
    notify("顯示名稱已更新。");
  } catch (error) { notify(error.message); }
}
async function changePassword(form) {
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/api/account/password", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    await loadAccountData();
    notify("密碼已更新，其他登入裝置已登出。");
  } catch (error) { notify(error.message); }
}
async function submitMfa(form, action) {
  try {
    const result = await api(`/api/account/mfa/${action}`, { method: "POST", body: JSON.stringify({ code: new FormData(form).get("code") }) });
    state.mfaSecret = "";
    if (action === "confirm") state.mfaRecoveryCodes = result.recoveryCodes || [];
    await refreshAuth();
    await loadAccountData();
    notify(action === "confirm" ? "雙重驗證已啟用。" : "管理者驗證完成。");
  } catch (error) { notify(error.message); }
}
async function previewReport(form) {
  if (state.shareBusy) return;
  state.shareBusy = true;
  const data = Object.fromEntries(new FormData(form));
  const selected = allProfiles().find((item) => item.id === data.profileId);
  if (!selected) { state.shareBusy = false; return notify("請選擇有效的校系情境。"); }
  const payload = {
    profileId: selected.id,
    schoolId: selected.schoolId || "unknown",
    departmentId: selected.departmentId || selected.id,
    academicYear: Number(data.academicYear),
    admissionRoute: selected.admissionRoute || selected.routeLabel || selected.route || "general",
    format: data.format,
    topics: String(data.topics || "").split(/[\r\n,，、]+/).map((item) => item.trim()).filter(Boolean),
    summary: data.summary,
    title: data.title,
  };
  try {
    const result = await api("/api/reports/preview", { method: "POST", body: JSON.stringify(payload) });
    state.shareDraft = { ...payload, previewHash: result.preview.previewHash, consentVersion: result.policy?.version };
    state.sharePreview = { ...result.preview, title: payload.title };
    state.sharePolicy = result.policy;
    state.authMessage = "";
  } catch (error) { state.authMessage = error.message; }
  finally { state.shareBusy = false; render(); }
}
async function submitReport(form) {
  if (!state.shareDraft || !state.sharePreview || state.shareBusy) return notify("內容已變更，請重新掃描並預覽。");
  const data = new FormData(form);
  if (data.get("consentToShare") !== "on" || data.get("confirmNoIdentifiers") !== "on") return notify("請分別確認分享同意與去識別檢查。 ");
  state.shareBusy = true;
  try {
    const result = await api("/api/reports", { method: "POST", body: JSON.stringify({ ...state.shareDraft, consentToShare: true, confirmNoIdentifiers: true }) });
    state.shareResult = result;
    state.sharePreview = null;
    state.shareDraft = null;
    state.authMessage = "";
  } catch (error) { state.authMessage = error.message; }
  finally { state.shareBusy = false; render(); }
}
async function withdrawReport(form) {
  const data = Object.fromEntries(new FormData(form));
  state.shareWithdrawalMessage = "正在處理…"; render();
  try {
    const result = await api("/api/reports/" + encodeURIComponent(data.reportId) + "/withdraw", { method: "POST", body: JSON.stringify({ withdrawalCode: data.withdrawalCode }) });
    state.shareWithdrawalMessage = result.message || "心得已撤回。";
    form.reset();
  } catch (error) { state.shareWithdrawalMessage = error.message; }
  render();
}
app.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  if (a === "home") { stopMedia(); stopEventStream(); if (state.sessionId) api("/api/sessions/" + encodeURIComponent(state.sessionId), { method: "DELETE" }).catch(() => {}); state.sessionId = null; go("home"); }
  else if (a === "settings") { if (state.page === "settings") return; if (state.resumeParsing || state.sessionStarting) return notify("請等目前處理完成後再調整設定。"); state.settingsReturnPage = state.page; go("settings"); }
  else if (a === "settings-done") go(state.settingsReturnPage || "home");
  else if (a === "reset-permissions") { preferenceFields.forEach((field) => { state[field] = false; }); persistPreferences(); await forgetSavedPortfolio(); render(); }
  else if (a === "library") { if (state.page === "library") return; state.libraryReturnPage = state.page; go("library"); }
  else if (a === "library-return") go(state.libraryReturnPage || "home");
  else if (a === "account") await openAccount();
  else if (a === "share") await openShare();
  else if (a === "auth-mode") { state.authMode = el.dataset.value; state.authMessage = ""; state.authActionUrl = ""; render(); }
  else if (a === "resend-verification") await resendVerification();
  else if (a === "logout" || a === "logout-all") { try { await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ all: a === "logout-all" }) }); state.account = null; state.accountHistory = []; state.authMessage = "已登出。"; await refreshAuth(); render(); } catch (error) { notify(error.message); } }
  else if (a === "export-account") { location.assign("/api/account/export"); }
  else if (a === "history-open") { try { state.selectedHistory = (await api("/api/account/practice-sessions/" + encodeURIComponent(id))).history; render(); } catch (error) { notify(error.message); } }
  else if (a === "history-close") { state.selectedHistory = null; render(); }
  else if (a === "history-delete") { if (confirm("刪除此練習歷史？刪除後無法復原。")) { try { await api("/api/account/practice-sessions/" + encodeURIComponent(id), { method: "DELETE" }); state.selectedHistory = null; await loadAccountData(); notify("練習歷史已刪除。"); } catch (error) { notify(error.message); } } }
  else if (a === "revoke-device") { try { if (id === state.account?.currentSessionId) { await api("/api/auth/logout", { method: "POST", body: "{}" }); state.account = null; await refreshAuth(); } else { await api("/api/account/sessions/" + encodeURIComponent(id), { method: "DELETE" }); await loadAccountData(); } notify("登入裝置已撤銷。"); } catch (error) { notify(error.message); } }
  else if (a === "privacy-request") { try { const result = await api("/api/privacy/requests", { method: "POST", body: JSON.stringify({ type: el.dataset.value }) }); state.authMessage = `已建立個資申請（${result.requestId}）。`; render(); } catch (error) { notify(error.message); } }
  else if (a === "delete-account") { if (confirm("將登出所有裝置並開始 30 天帳號刪除流程。私人練習歷史會一併刪除；匿名心得需另外用撤回碼撤回。確定繼續？")) { try { await api("/api/account/deletion-requests", { method: "POST", body: "{}" }); state.account = null; state.accountHistory = []; await refreshAuth(); state.authMessage = "刪除申請已建立；取消連結已寄到你的電子郵件。"; render(); } catch (error) { notify(error.message); } } }
  else if (a === "mfa-setup") { try { const result = await api("/api/account/mfa/setup", { method: "POST", body: "{}" }); state.mfaSecret = result.secret; render(); } catch (error) { notify(error.message); } }
  else if (a === "load-reports") { try { state.pendingReports = (await api("/api/admin/reports")).reports || []; render(); } catch (error) { notify(error.message); } }
  else if (a === "load-privacy-requests") { try { state.pendingPrivacyRequests = (await api("/api/admin/privacy-requests")).requests || []; render(); } catch (error) { notify(error.message); } }
  else if (a === "complete-privacy-request") { try { await api("/api/admin/privacy-requests/" + encodeURIComponent(id) + "/complete", { method: "POST", body: "{}" }); state.pendingPrivacyRequests = state.pendingPrivacyRequests.filter((item) => item.request_id !== id); render(); notify("個資申請已標記完成。"); } catch (error) { notify(error.message); } }
  else if (a === "review-report") { const note = document.getElementById("moderation-note-" + id)?.value || ""; try { await api("/api/admin/reports/" + encodeURIComponent(id) + "/review", { method: "POST", body: JSON.stringify({ decision: el.dataset.decision, note }) }); state.pendingReports = state.pendingReports.filter((report) => report.reportId !== id); render(); notify("審核結果已保存。"); } catch (error) { notify(error.message); } }
  else if (a === "copy-withdrawal") { const text = `心得編號：${state.shareResult?.reportId || ""}\n撤回碼：${state.shareResult?.withdrawalCode || ""}`; try { await navigator.clipboard.writeText(text); notify("撤回資訊已複製。"); } catch { notify("無法自動複製，請手動保存上方資訊。"); } }
  else if (a === "copy-mfa-codes") { try { await navigator.clipboard.writeText(state.mfaRecoveryCodes.join("\n")); notify("復原碼已複製，請保存到安全位置。"); } catch { notify("無法自動複製，請手動保存復原碼。"); } }
  else if (a === "step") { el.dataset.page === "interview" ? startInterview() : go(el.dataset.page); }
  else if (a === "back" && state.page === "settings") go(state.settingsReturnPage || "home");
  else if (a === "back" && state.page === "library") go(state.libraryReturnPage || "home");
  else if (a === "back") { const i = steps.findIndex((s) => s[0] === state.page); go(i > 0 ? steps[i - 1][0] : "home"); }
  else if (a === "profile") await selectProfile(id);
  else if (a === "custom-profile") { state.customProfileOpen = true; render(); app.querySelector('[name="school"]')?.focus(); }
  else if (a === "cancel-custom-profile") { state.customProfileOpen = false; render(); }
  else if (a === "panel") setPanel(id);
  else if (a === "person") togglePerson(id);
  else if (a === "duration") { state.config.duration = Number(el.dataset.value); render(); }
  else if (a === "mode") { state.config.mode = el.dataset.value; render(); }
  else if (a === "new-seed") { newSeed(); render(); notify("已換成新的角色動作種子。"); }
  else if (a === "add-claim") { if (state.resumeParsing || !state.libraryReady) return; if (state.claims.length >= 80) return notify("資料庫最多 80 個主張，請先移除不需要的內容。"); state.claimsOrigin = "manual"; state.claims.push({ id: crypto.randomUUID(), text: "" }); void persistPortfolioLibrary(); render(); app.querySelector(".claim-item:last-child textarea")?.focus(); }
  else if (a === "remove-claim") { if (state.resumeParsing || !state.libraryReady) return; state.claims = state.claims.filter((c) => c.id !== id); void persistPortfolioLibrary(); render(); }
  else if (a === "sample") { if (state.resumeParsing) return; state.portfolioFiles = []; state.claimsOrigin = "sample"; state.resumeParseMessage = ""; state.resumeParseError = false; state.claims = [{ id: "c" + Date.now(), text: "我在校園借閱系統專題中負責資料處理與搜尋功能。" }, { id: "c" + (Date.now() + 1), text: "我透過自學演算法，嘗試用動態規劃改善問題解法。" }]; render(); notify("已載入可自行修改的示範主張。"); }
  else if (a === "parse-portfolio") await parsePortfolioPdf();
  else if (a === "remove-portfolio") removePortfolioFile(id);
  else if (a === "camera-device") checkCamera();
  else if (a === "devices") await checkDevices();
  else if (a === "mic") await toggleMic();
  else if (a === "send-voice") completeVoiceCapture();
  else if (a === "closing-review") await completeInterviewReview();
  else if (a === "play-question") await tryQuestionPlayback();
  else if (a === "skip-question-audio") { stopQuestionAudio(); beginListening(state.currentEvent?.seq); render(); }
  else if (a === "skip-devices") { state.config.mode = "text"; startInterview(); }
  else if (a === "captions") await toggleCaptions();
  else if (a === "live-probe") { state.liveProbe = { status: "idle", at: 0 }; maybeProbeLive(true); render(); }
  else if (a === "end") { if (state.finishing) return; state.confirmEnd = true; render(); }
  else if (a === "continue") { state.confirmEnd = false; render(); }
  else if (a === "confirm-end") finishInterview("manual");
  else if (a === "retry-review") await retryReview();
  else if (a === "practice") { state.cameraAnalysisSummary = null; newSeed(); startInterview(); }
  else if (a === "export") exportReview();
});
app.addEventListener("focusin", (event) => {
  if (!event.target.matches('[data-form="answer"] textarea')) return;
  const panel = document.getElementById("camera-trial-panel");
  if (!panel || panel.hidden || panel.classList.contains("is-collapsed")) return;
  const toggle = panel.querySelector("[data-camera-panel-toggle]");
  if (toggle) toggle.click();
});
app.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.id === "resume-file" && el.files?.length) {
    selectPortfolioFiles(el.files);
  } else if (el.dataset.microphone !== undefined) {
    state.microphoneId = el.value;
    checkDevices();
  } else if (el.dataset.recognition !== undefined) {
    if (!state.preferencesReady || !["browser", "server"].includes(el.value) || el.value === state.recognitionMode) return;
    const hadAudioConsent = state.consentAudio;
    state.recognitionMode = el.value;
    state.consentAudio = false;
    state.liveVoiceConsent = false;
    persistPreferences();
    if (hadAudioConsent) state.preferencesMessage = "語音辨識位置已變更，請重新允許語音辨識與教授語音。";
    render();
  } else if (el.dataset.preference !== undefined) {
    const field = el.dataset.preference;
    if (!state.preferencesReady || !preferenceFields.includes(field)) return;
    state[field] = el.checked;
    if (!state.consentModel) { state.resumeConsent = false; state.cameraMetricsConsent = false; }
    if (!state.consentModel || !state.consentAudio) state.liveVoiceConsent = false;
    if (!state.cameraAnalysisConsent) state.cameraMetricsConsent = false;
    if (!state.auth?.authenticated) state.saveHistory = false;
    persistPreferences();
    if (field === "savePortfolio") {
      if (state.savePortfolio) { if (state.claimsOrigin === "sample" && !state.portfolioFiles.length) await loadPortfolioLibrary(); await persistPortfolioLibrary(); }
      else await forgetSavedPortfolio();
    }
    render();
  }
  else if (el.dataset.portfolioSelection) { const item = state.portfolioFiles.find((file) => file.id === el.dataset.portfolioSelection); if (item?.status === "done") { item.selected = el.checked; void persistPortfolioLibrary(); render(); } }
  else if (["summary", "topics", "title", "format", "academicYear", "profileId"].includes(el.name)) { state.sharePreview = null; state.shareDraft = null; app.querySelector(".share-preview")?.remove(); }
  else if (el.dataset.config) { state.config[el.dataset.config] = el.checked; render(); }
  else if (el.dataset.seed !== undefined) state.seed = Math.max(1, Number(el.value) || 1);
});
app.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.claim) { const claim = state.claims.find((c) => c.id === el.dataset.claim); if (claim && !state.resumeParsing) { claim.text = el.value; state.claimsOrigin = "manual"; void persistPortfolioLibrary(); } }
  else if (el.name === "answer") {
    state.draft = el.value; state.lastActivityAt = Date.now(); interviewTiming.activity();
    if (el.value.trim()) {
      discardRecording(); reportCandidateActivity(); state.cameraPhase = "candidate_answer";
      if (["preparing", "speaking", "playback_blocked"].includes(interviewTiming.phase)) { stopQuestionAudio(); interviewTiming.listen(); }
    }
    else if (interviewTiming.phase === "listening") startVoiceCapture();
  }
  else if (el.dataset.shareField !== undefined || ["summary", "topics", "title", "format", "academicYear"].includes(el.name)) { state.sharePreview = null; state.shareDraft = null; app.querySelector(".share-preview")?.remove(); }
  else if (el.dataset.seed !== undefined) state.seed = Math.max(1, Number(el.value) || 1);
});
app.addEventListener("submit", (event) => {
  if (event.target.matches('[data-form="answer"]')) { event.preventDefault(); submitAnswer(); }
  else if (event.target.matches('[data-form="custom-profile"]')) { event.preventDefault(); submitCustomProfile(event.target); }
  else if (event.target.matches('[data-form="auth"]')) { event.preventDefault(); submitAuth(event.target); }
  else if (event.target.matches('[data-form="password-reset-request"]')) { event.preventDefault(); requestPasswordReset(event.target); }
  else if (event.target.matches('[data-form="mfa-confirm"]')) { event.preventDefault(); submitMfa(event.target, "confirm"); }
  else if (event.target.matches('[data-form="mfa-verify"]')) { event.preventDefault(); submitMfa(event.target, "verify"); }
  else if (event.target.matches('[data-form="report-preview"]')) { event.preventDefault(); previewReport(event.target); }
  else if (event.target.matches('[data-form="report-submit"]')) { event.preventDefault(); submitReport(event.target); }
  else if (event.target.matches('[data-form="report-withdraw"]')) { event.preventDefault(); withdrawReport(event.target); }
  else if (event.target.matches('[data-form="display-name"]')) { event.preventDefault(); updateDisplayName(event.target); }
  else if (event.target.matches('[data-form="change-password"]')) { event.preventDefault(); changePassword(event.target); }
});
app.addEventListener("dragover", (event) => { if (event.target.closest(".drop-zone")) event.preventDefault(); });
app.addEventListener("drop", (event) => {
  if (!event.target.closest(".drop-zone")) return;
  event.preventDefault();
  selectPortfolioFiles(event.dataTransfer?.files);
});
window.addEventListener("pagehide", () => {
  stopEventStream();
  stopMedia();
  if (state.sessionId) fetch("/api/sessions/" + encodeURIComponent(state.sessionId), { method: "DELETE", credentials: "same-origin", headers: { "X-CSRF-Token": state.csrfToken }, keepalive: true }).catch(() => {});
});
render();
async function initializeApp() {
  try { await refreshAuth(); }
  catch { state.authReady = true; }
  const healthRequest = api("/api/health").then((health) => {
    state.health = health;
    state.agentMode = health.agentMode || "mock";
    state.speechStatus = health.speech || { available: false };
    if (state.page !== "interview") render();
  }).catch(() => {
    state.agentMode = "offline";
    render();
  });
  await Promise.all([loadProfiles(), healthRequest]);
  loadPreferences(); await loadPortfolioLibrary(); render();
}
initializeApp();
