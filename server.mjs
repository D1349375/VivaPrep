import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliWorkDirectory, config, dataDirectory, ensureDataDirectory } from "./server/config.js";
import { AgentService } from "./server/agent-service.js";
import { AntigravityCliProvider, GeminiApiProvider, MockAgentProvider } from "./server/agent-provider.js";
import { InterviewOrchestrator } from "./server/interview-orchestrator.js";
import { createHttpHandler } from "./server/http-api.js";
import { PanelCoordinator } from "./server/panel-coordinator.js";
import { getProfile, profiles, publicProfile } from "./server/profiles.js";
import { AppDatabase } from "./server/database.js";
import { ReportRepository } from "./server/report-repository.js";
import { SessionStore } from "./server/session-store.js";
import { SpeechAdapter } from "./server/speech-adapter.js";
import { AuthService } from "./server/auth-service.js";
import { EmailDelivery } from "./server/email-delivery.js";
import { InterviewHistoryRepository } from "./server/interview-history-repository.js";
import { loadApplicationKey } from "./server/crypto-utils.js";

await ensureDataDirectory();
const applicationKey = await loadApplicationKey({ dataDirectory, secret: config.appSecret, production: config.production });
const database = new AppDatabase(config.databasePath);
const authService = new AuthService({ database, applicationKey, secureCookies: config.secureCookies, bootstrapAdminEmail: config.bootstrapAdminEmail });
const emailDelivery = new EmailDelivery({ mode: config.emailMode, webhookUrl: config.emailWebhookUrl, webhookKey: config.emailWebhookKey, publicUrl: config.publicUrl });
const provider = config.agentMode === "gemini-api"
  ? new GeminiApiProvider({ apiKey: config.geminiApiKey, modelId: config.modelSlug, timeoutMs: config.agentTimeoutMs })
  : config.agentMode === "cli"
    ? new AntigravityCliProvider({
      cliPath: config.cliPath,
      modelSlug: config.modelSlug,
      liveModelSlug: config.liveModelSlug,
      effort: config.effort,
      timeoutMs: config.agentTimeoutMs,
      workDirectory: cliWorkDirectory,
    })
    : new MockAgentProvider();
const agentService = new AgentService(provider);
const store = new SessionStore({ database, sessionTtlMs: config.sessionTtlMs, applicationKey });
const speechAdapter = new SpeechAdapter({
  mode: config.speechMode,
  ttsMode: config.ttsMode,
  apiKey: config.geminiApiKey,
  sttModel: config.sttModel,
  ttsModel: config.ttsModel,
  voice: config.ttsVoice,
  speakerVoices: config.ttsSpeakerVoices,
  maxAudioBytes: config.maxAudioBytes,
  powerShellPath: config.speechPowerShellPath,
  ffmpegPath: config.speechFfmpegPath,
  pythonPath: config.speechPythonPath,
  whisperModelPath: config.whisperModelPath,
});
await speechAdapter.initialize();
const reportRepository = new ReportRepository(database, applicationKey);
const importedDatabaseReports = await reportRepository.importLegacyDatabase();
const importedLegacyReports = await reportRepository.importLegacyJson(join(dataDirectory, "reports.json"));
reportRepository.seedOfficialSources(profiles.flatMap((profile) => profile.sources || []));
const interviewHistoryRepository = new InterviewHistoryRepository({ database, applicationKey, retentionMonths: config.savedHistoryRetentionMonths });
const orchestrator = new InterviewOrchestrator({
  store,
  agentService,
  coordinator: new PanelCoordinator(),
  speechAdapter,
  reportRepository,
  interviewHistoryRepository,
  getProfile,
  config,
});
const root = fileURLToPath(new URL(".", import.meta.url));
const handler = createHttpHandler({
  root,
  config,
  orchestrator,
  agentService,
  store,
  getProfiles: () => profiles.map(publicProfile),
  reportRepository,
  authService,
  emailDelivery,
  interviewHistoryRepository,
});

const server = createServer(handler);
server.listen(config.port, config.host, () => {
  process.stdout.write("VivaPrep is available at http://" + config.host + ":" + config.port + "\n");
  process.stdout.write("Interview agents: " + agentService.mode + " (" + agentService.modelId + ")\n");
  process.stdout.write("Speech adapters: " + speechAdapter.status().provider + "\n");
  process.stdout.write("SQLite database: " + config.databasePath + "\n");
  if (importedDatabaseReports || importedLegacyReports) process.stdout.write("Imported " + (importedDatabaseReports + importedLegacyReports) + " legacy report(s).\n");
  process.stdout.write("Account registration email mode: " + emailDelivery.mode + "\n");
  orchestrator.resumePendingWork();
});
const sessionCleanup = setInterval(() => {
  store.pruneExpired(config.sessionTtlMs);
  interviewHistoryRepository.pruneExpired();
  authService.purgeExpiredDeletionRequests();
  reportRepository.expireReports();
  database.connection.prepare("DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL OR idle_expires_at <= ? OR absolute_expires_at <= ?").run(new Date().toISOString(), new Date().toISOString());
  database.connection.prepare("DELETE FROM auth_action_tokens WHERE consumed_at IS NOT NULL OR expires_at <= ?").run(new Date().toISOString());
}, 60 * 1000);
sessionCleanup.unref();
server.on("close", () => {
  provider.close?.();
  speechAdapter.close();
  clearInterval(sessionCleanup);
  database.close();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close());
}
