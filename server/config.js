import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

// Local secrets such as GEMINI_API_KEY live in an untracked .env file.
try { process.loadEnvFile(join(projectRoot, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
export const dataDirectory = join(projectRoot, ".data");
export const cliWorkDirectory = join(tmpdir(), "vivaprep-" + process.pid + "-cli-work");

export const config = {
  production: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || "127.0.0.1",
  databasePath: process.env.VIVAPREP_DATABASE_PATH || join(dataDirectory, "vivaprep.sqlite"),
  agentMode: ["gemini", "gemini-api"].includes(process.env.VIVAPREP_AGENT_MODE) ? "gemini-api" : process.env.VIVAPREP_AGENT_MODE === "cli" ? "cli" : "mock",
  cliPath: process.env.ANTIGRAVITY_CLI_PATH || "agy",
  modelSlug: process.env.VIVAPREP_AGENT_MODE === "gemini" || process.env.VIVAPREP_AGENT_MODE === "gemini-api"
    ? process.env.GEMINI_MODEL || "gemini-3.8-flash"
    : process.env.ANTIGRAVITY_MODEL || "gemini-3.8-flash-medium",
  effort: process.env.ANTIGRAVITY_EFFORT || "medium",
  // Fast CLI model for question generation; unrelated to Gemini Live voice below.
  liveModelSlug: process.env.ANTIGRAVITY_LIVE_MODEL || "gemini-3.8-flash-low",
  // Gemini Live real-time voice for the warm-up panel: auto = use when reachable, off = always turn-based.
  liveVoiceMode: process.env.VIVAPREP_LIVE_VOICE === "off" ? "off" : "auto",
  liveVoiceModel: process.env.GEMINI_LIVE_VOICE_MODEL || "gemini-3.8-live",
  liveVoiceApiKey: process.env.GEMINI_LIVE_API_KEY || process.env.GEMINI_API_KEY || "",
  agentTimeoutMs: Number(process.env.VIVAPREP_AGENT_TIMEOUT_MS || 90000),
  speechMode: process.env.VIVAPREP_SPEECH_MODE === "whisper-local"
    ? "whisper-local"
    : process.env.VIVAPREP_SPEECH_MODE === "gemini" && process.env.GEMINI_API_KEY
    ? "gemini"
    : process.env.VIVAPREP_SPEECH_MODE === "windows-sapi" && process.platform === "win32"
      ? "windows-sapi"
      : "off",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  // "confirmed" only after AI Studio shows every Gemini key here on a paid project; Drive import depends on it.
  geminiPaidTierConfirmed: process.env.VIVAPREP_GEMINI_PAID_TIER === "confirmed",
  // Google Drive import (Picker): public browser values from one Cloud project; off when any is missing.
  driveClientId: process.env.VIVAPREP_DRIVE_CLIENT_ID || "",
  drivePickerApiKey: process.env.VIVAPREP_DRIVE_PICKER_API_KEY || "",
  driveAppId: process.env.VIVAPREP_DRIVE_APP_ID || "",
  // Sign in with Google: a web OAuth client ID (public). Defaults to the Drive client,
  // whose JavaScript origins already list this app.
  googleSignInClientId: process.env.VIVAPREP_GOOGLE_SIGNIN_CLIENT_ID || process.env.VIVAPREP_DRIVE_CLIENT_ID || "",
  // Professor voices: Gemini TTS whenever a key is set, even with local speech
  // recognition; VIVAPREP_TTS_MODE=local keeps Windows voices only.
  ttsMode: process.env.VIVAPREP_TTS_MODE === "local" || !process.env.GEMINI_API_KEY ? "local" : "gemini",
  speechPowerShellPath: process.env.VIVAPREP_SPEECH_POWERSHELL_PATH || "powershell.exe",
  speechFfmpegPath: process.env.VIVAPREP_FFMPEG_PATH || "ffmpeg.exe",
  speechPythonPath: process.env.VIVAPREP_SPEECH_PYTHON_PATH || join(dataDirectory, "speech-venv", "Scripts", "python.exe"),
  whisperModelPath: process.env.VIVAPREP_WHISPER_MODEL_PATH || join(dataDirectory, "speech-model", "small"),
  sttModel: process.env.GEMINI_STT_MODEL || "gemini-3.5-transcribe",
  ttsModel: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
  ttsVoice: process.env.GEMINI_TTS_VOICE || "Kore",
  ttsSpeakerVoices: Object.fromEntries(Object.entries({
    technical: process.env.GEMINI_TTS_VOICE_TECHNICAL,
    portfolio: process.env.GEMINI_TTS_VOICE_PORTFOLIO,
    logic: process.env.GEMINI_TTS_VOICE_LOGIC,
  }).filter(([, voice]) => voice)),
  bootstrapAdminEmail: process.env.VIVAPREP_BOOTSTRAP_ADMIN_EMAIL || "",
  appSecret: process.env.VIVAPREP_APP_SECRET || "",
  publicUrl: process.env.VIVAPREP_PUBLIC_URL || `http://${process.env.HOST || "127.0.0.1"}:${Number(process.env.PORT || 4173)}`,
  emailMode: process.env.VIVAPREP_EMAIL_MODE || (process.env.NODE_ENV === "production" ? "disabled" : "console"),
  emailWebhookUrl: process.env.VIVAPREP_EMAIL_WEBHOOK_URL || "",
  emailWebhookKey: process.env.VIVAPREP_EMAIL_WEBHOOK_KEY || "",
  secureCookies: process.env.NODE_ENV === "production" || String(process.env.VIVAPREP_PUBLIC_URL || "").startsWith("https://"),
  savedHistoryRetentionMonths: Number(process.env.VIVAPREP_SAVED_HISTORY_MONTHS || 24),
  maxRequestBytes: 12 * 1024 * 1024,
  maxPdfBytes: 8 * 1024 * 1024,
  maxAnswerLength: 8000,
  maxAudioBytes: 8 * 1024 * 1024,
  sessionDurationMin: 3,
  sessionDurationMax: 8,
  sessionTtlMs: Number(process.env.VIVAPREP_SESSION_TTL_MS || 60 * 60 * 1000),
};

export async function ensureDataDirectory() {
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(dirname(config.databasePath), { recursive: true });
  await mkdir(cliWorkDirectory, { recursive: true });
}
