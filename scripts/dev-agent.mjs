import { access } from "node:fs/promises";
import { join } from "node:path";

process.env.VIVAPREP_AGENT_MODE = "cli";
process.env.ANTIGRAVITY_MODEL ||= "gemini-3.8-flash-medium";
if (!process.env.VIVAPREP_SPEECH_MODE && process.platform === "win32") {
  try {
    await access(new URL("../.data/speech-model/small/model.bin", import.meta.url));
    await access(new URL("../.data/speech-venv/Scripts/python.exe", import.meta.url));
    process.env.VIVAPREP_SPEECH_MODE = "whisper-local";
  } catch { process.env.VIVAPREP_SPEECH_MODE = "windows-sapi"; }
}

if (!process.env.ANTIGRAVITY_CLI_PATH) {
  const localInstall = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")
    : "";
  if (localInstall) {
    try {
      await access(localInstall);
      process.env.ANTIGRAVITY_CLI_PATH = localInstall;
    } catch {
      process.env.ANTIGRAVITY_CLI_PATH = "agy";
    }
  } else process.env.ANTIGRAVITY_CLI_PATH = "agy";
}

await import("../server.mjs");
