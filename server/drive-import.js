// Google Drive import policy. The browser runs OAuth, the Picker and the download itself,
// so the access token never reaches this server. The server only decides whether the
// feature is on and refuses Drive-derived data when it could reach an unsuitable model.

// Drive user data must not train general AI models (Workspace API User Data Policy), and the
// Gemini API free tier uses submitted content to improve products. No API reports a key's
// tier, so the operator states it after checking AI Studio.
export function driveProcessingBlock(config) {
  if (config.agentMode !== "gemini-api") return { reason: "agent-mode", message: "Google Drive 匯入只能搭配 Gemini API 付費層，目前的模型接入方式不可使用。" };
  if (!config.geminiApiKey) return { reason: "gemini-key-missing", message: "伺服器尚未設定 Gemini API key，Google Drive 匯入目前不可用。" };
  if (!config.geminiPaidTierConfirmed) return { reason: "paid-tier-unconfirmed", message: "尚未確認 Gemini API 為付費層；Drive 的資料不可送進免費層，Google Drive 匯入目前停用。" };
  return null;
}

function driveOAuthBlock(config) {
  if (!config.driveClientId || !config.drivePickerApiKey || !config.driveAppId) return { reason: "not-configured", message: "伺服器尚未設定 Google Drive 匯入（OAuth 用戶端、Picker API key 與專案編號）。" };
  if (!/^\d+$/.test(config.driveAppId)) return { reason: "invalid-app-id", message: "Google Drive 匯入設定有誤：App ID 必須是 Cloud 專案編號（全為數字），不是專案 ID。" };
  // The Picker key is sent to every browser, so it must never double as a Gemini key.
  if ([config.geminiApiKey, config.liveVoiceApiKey].includes(config.drivePickerApiKey)) return { reason: "picker-key-reused", message: "Google Drive 匯入設定有誤：Picker API key 會送到瀏覽器，不可與 Gemini API key 相同。" };
  return null;
}

// Client ID, Picker key and project number are public browser values; nothing else is exposed.
export function driveImportStatus(config) {
  const processingBlock = driveProcessingBlock(config);
  const block = driveOAuthBlock(config) || processingBlock;
  const processingAllowed = !processingBlock;
  if (block) return { enabled: false, processingAllowed, reason: block.reason, message: block.message };
  return { enabled: true, processingAllowed, clientId: config.driveClientId, apiKey: config.drivePickerApiKey, appId: config.driveAppId };
}
