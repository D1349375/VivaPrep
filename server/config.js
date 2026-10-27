import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
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
  liveModelSlug: process.env.ANTIGRAVITY_LIVE_MODEL || "gemini-3.8-flash-low",
  agentTimeoutMs: Number(process.env.VIVAPREP_AGENT_TIMEOUT_MS || 90000),
  speechMode: process.env.VIVAPREP_SPEECH_MODE === "whisper-local"
    ? "whisper-local"
    : process.env.VIVAPREP_SPEECH_MODE === "gemini" && process.env.GEMINI_API_KEY
    ? "gemini"
    : process.env.VIVAPREP_SPEECH_MODE === "windows-sapi" && process.platform === "win32"
      ? "windows-sapi"
      : "off",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  speechPowerShellPath: process.env.VIVAPREP_SPEECH_POWERSHELL_PATH || "powershell.exe",
  speechFfmpegPath: process.env.VIVAPREP_FFMPEG_PATH || "ffmpeg.exe",
  speechPythonPath: process.env.VIVAPREP_SPEECH_PYTHON_PATH || join(dataDirectory, "speech-venv", "Scripts", "python.exe"),
  whisperModelPath: process.env.VIVAPREP_WHISPER_MODEL_PATH || join(dataDirectory, "speech-model", "small"),
  sttModel: process.env.GEMINI_STT_MODEL || "gemini-3.5-transcribe",
  ttsModel: process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts",
  ttsVoice: process.env.GEMINI_TTS_VOICE || "Kore",
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
