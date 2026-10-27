import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { createPracticeProfile, publicProfile } from "./profiles.js";
import { appendSetCookie } from "./auth-service.js";
import { createHash } from "node:crypto";

export function portfolioBatchScope(batchId, authContext) {
  const owner = authContext?.userId || authContext?.guestOwnerHash;
  if (!owner || typeof batchId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return null;
  return "portfolio-batch-" + createHash("sha256").update(owner).digest("hex") + "-" + batchId.toLowerCase();
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
};

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(JSON.stringify(value));
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("請求內容超出大小限制。"), { code: "REQUEST_TOO_LARGE", status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, maxBytes) {
  const buffer = await readBody(request, maxBytes);
  if (!buffer.length) return {};
  try { return JSON.parse(buffer.toString("utf8")); }
  catch { throw Object.assign(new Error("INVALID_JSON"), { code: "INVALID_JSON", status: 400 }); }
}

function sendEvent(response, event) {
  response.write("id: " + event.seq + "\n");
  response.write("data: " + JSON.stringify(event) + "\n\n");
}

export function createHttpHandler({ root, config, orchestrator, agentService, store, getProfiles, reportRepository, authService, emailDelivery, interviewHistoryRepository }) {
  const rootPath = resolve(root);
  const portfolioParsingAvailable = () => config.agentMode === "cli" || (config.agentMode === "gemini-api" && Boolean(config.geminiApiKey));
  return async function handler(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      if (request.method === "GET" && ["/verify-email", "/reset-password", "/cancel-deletion"].includes(pathname)) {
        const action = pathname === "/verify-email" ? "verify-email" : pathname === "/cancel-deletion" ? "cancel-deletion" : "reset-password";
        return sendAuthActionPage(response, action, url.searchParams.get("token") || "");
      }
      if (pathname.startsWith("/api/")) {
        const authContext = authService.resolveContext(request);
        for (const cookie of authContext.cookiesToSet) appendSetCookie(response, cookie);
        if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method || "GET")) authService.assertCsrf(authContext, request);
        const parts = pathname.split("/").filter(Boolean);
        const method = request.method || "GET";
        if (method === "GET" && pathname === "/api/auth/session") {
          json(response, 200, authService.publicSession(authContext));
          return;
        }
        if (method === "POST" && pathname === "/api/auth/register") {
          authService.rateLimit("register-ip", request.socket.remoteAddress, 20, 60 * 60 * 1000);
          const input = await readJson(request, 8192);
          const result = await authService.register(input, emailDelivery);
          return json(response, 202, { accepted: true, verificationRequired: true, developmentVerificationUrl: config.production ? undefined : result.developmentUrl });
        }
        if (method === "POST" && pathname === "/api/auth/login") {
          authService.rateLimit("login-ip", request.socket.remoteAddress, 40, 15 * 60 * 1000);
          const input = await readJson(request, 8192);
          const result = await authService.login(input);
          appendSetCookie(response, result.cookie);
          appendSetCookie(response, authService.clearGuestCookie());
          return json(response, 200, { authenticated: true, csrfToken: result.csrfToken });
        }
        if (method === "POST" && pathname === "/api/auth/verify-email") {
          const input = await readJson(request, 8192);
          const result = await authService.verifyEmail(input.token);
          appendSetCookie(response, result.cookie);
          appendSetCookie(response, authService.clearGuestCookie());
          return json(response, 200, { verified: true, authenticated: true, csrfToken: result.csrfToken });
        }
        if (method === "POST" && pathname === "/api/auth/verification/resend") {
          authService.rateLimit("verification-resend-ip", request.socket.remoteAddress, 8, 60 * 60 * 1000);
          const input = await readJson(request, 8192);
          const result = await authService.sendVerificationAgain(input, emailDelivery);
          return json(response, 202, { accepted: true, developmentVerificationUrl: config.production ? undefined : result.developmentUrl });
        }
        if (method === "POST" && pathname === "/api/auth/password-reset/request") {
          authService.rateLimit("password-reset-ip", request.socket.remoteAddress, 12, 60 * 60 * 1000);
          const input = await readJson(request, 8192);
          const result = await authService.requestPasswordReset(input, emailDelivery);
          return json(response, 202, { accepted: true, developmentResetUrl: config.production ? undefined : result.developmentUrl });
        }
        if (method === "POST" && pathname === "/api/auth/password-reset/confirm") {
          const input = await readJson(request, 8192);
          await authService.resetPassword(input.token, input.password);
          return json(response, 200, { changed: true });
        }
        if (method === "POST" && pathname === "/api/auth/logout") {
          const input = await readJson(request, 2048);
          authService.logout(authContext, input.all === true);
          appendSetCookie(response, authService.clearAuthCookie());
          return json(response, 200, { loggedOut: true });
        }
        if (method === "GET" && pathname === "/api/account") {
          return json(response, 200, { account: authService.account(authContext) });
        }
        if (method === "PATCH" && pathname === "/api/account") {
          const input = await readJson(request, 2048);
          return json(response, 200, authService.updateDisplayName(authContext, input.displayName));
        }
        if (method === "POST" && pathname === "/api/account/password") {
          const input = await readJson(request, 4096);
          return json(response, 200, await authService.changePassword(authContext, input.currentPassword, input.newPassword));
        }
        if (method === "GET" && pathname === "/api/account/export") {
          const data = authService.exportAccount(authContext, interviewHistoryRepository);
          response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="vivaprep-account-export-${new Date().toISOString().slice(0, 10)}.json"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(JSON.stringify(data, null, 2));
          return;
        }
        if (method === "POST" && pathname === "/api/privacy/requests") {
          const input = await readJson(request, 2048);
          return json(response, 202, authService.createPrivacyRequest(authContext, input.type));
        }
        if (method === "GET" && pathname === "/api/account/mfa") {
          return json(response, 200, authService.mfaStatus(authContext));
        }
        if (method === "POST" && pathname === "/api/account/mfa/setup") {
          return json(response, 201, authService.beginMfaSetup(authContext));
        }
        if (method === "POST" && pathname === "/api/account/mfa/confirm") {
          const input = await readJson(request, 2048);
          return json(response, 200, authService.confirmMfaSetup(authContext, input.code));
        }
        if (method === "POST" && pathname === "/api/account/mfa/verify") {
          const input = await readJson(request, 2048);
          return json(response, 200, authService.verifyMfa(authContext, input.code));
        }
        if (method === "GET" && pathname === "/api/account/practice-sessions") {
          return json(response, 200, { sessions: interviewHistoryRepository.list(authService.requireUser(authContext).userId) });
        }
        if (parts[1] === "account" && parts[2] === "practice-sessions" && parts[3]) {
          const user = authService.requireUser(authContext);
          if (method === "GET" && parts.length === 4) {
            const history = interviewHistoryRepository.get(user.userId, parts[3]);
            if (!history) return json(response, 404, { error: { code: "PRACTICE_HISTORY_NOT_FOUND", message: "找不到這筆個人練習紀錄。" } });
            return json(response, 200, { history });
          }
          if (method === "DELETE" && parts.length === 4) {
            if (!interviewHistoryRepository.delete(user.userId, parts[3])) return json(response, 404, { error: { code: "PRACTICE_HISTORY_NOT_FOUND", message: "找不到這筆個人練習紀錄。" } });
            return response.writeHead(204, { "Cache-Control": "no-store" }).end();
          }
        }
        if (method === "GET" && pathname === "/api/account/sessions") {
          return json(response, 200, { sessions: authService.account(authContext).sessions });
        }
        if (parts[1] === "account" && parts[2] === "sessions" && parts[3] && method === "DELETE") {
          return json(response, 200, authService.deleteAuthSession(authContext, parts[3]));
        }
        if (method === "POST" && pathname === "/api/account/deletion-requests") {
          const result = await authService.requestDeletion(authContext, emailDelivery);
          for (const session of store.list()) if (session.ownerUserId === authContext.userId) orchestrator.deleteSession(session.id);
          appendSetCookie(response, authService.clearAuthCookie());
          return json(response, 202, result);
        }
        if (method === "POST" && pathname === "/api/account/deletion-requests/cancel-token") {
          const input = await readJson(request, 2048);
          const result = authService.cancelDeletionWithToken(input.token);
          appendSetCookie(response, result.cookie);
          appendSetCookie(response, authService.clearGuestCookie());
          return json(response, 200, { cancelled: true, authenticated: true, csrfToken: result.csrfToken });
        }
        if (parts[1] === "account" && parts[2] === "deletion-requests" && parts[3] && method === "DELETE") {
          return json(response, 200, authService.cancelDeletion(authContext, parts[3]));
        }
        if (method === "GET" && pathname === "/api/health") {
          const profileList = getProfiles();
          json(response, 200, {
            status: "ok",
            agentMode: config.agentMode,
            model: config.modelSlug,
            liveModel: config.agentMode === "cli" ? config.liveModelSlug : config.modelSlug,
            geminiApiConfigured: Boolean(config.geminiApiKey),
            portfolioParsingAvailable: portfolioParsingAvailable(),
            speech: orchestratorSpeech(orchestrator),
            profiles: profileList.length,
            timestamp: new Date().toISOString(),
          });
          return;
        }
        if (method === "POST" && pathname === "/api/agent/prewarm") {
          // Sends no student data; it only opens a model connection ahead of the interview.
          json(response, 202, { warming: agentService.prewarm() });
          return;
        }
        if (method === "GET" && pathname === "/api/profiles") {
          json(response, 200, { profiles: getProfiles() });
          return;
        }
        if (method === "POST" && pathname === "/api/profiles/custom") {
          const input = await readJson(request, 4096);
          json(response, 201, { profile: publicProfile(createPracticeProfile(input)) });
          return;
        }
        if (method === "GET" && parts[1] === "profiles" && parts[2]) {
          const profile = getProfiles().find((item) => item.id === parts[2]);
          if (!profile) return json(response, 404, { error: { code: "PROFILE_NOT_FOUND", message: "找不到指定的校系情境。" } });
          json(response, 200, { profile });
          return;
        }
        if (method === "POST" && pathname === "/api/portfolio/parse") {
          authService.rateLimit("portfolio-parse", request.socket.remoteAddress, 20, 60 * 60 * 1000);
          if (!portfolioParsingAvailable()) {
            return json(response, 503, { error: { code: "PDF_PARSER_UNAVAILABLE", message: "備審整理需要 Gemini 服務，目前無法使用。" } });
          }
          const input = await readJson(request, Math.min(config.maxRequestBytes, Math.ceil(config.maxPdfBytes * 4 / 3) + 32 * 1024));
          const batchScopeId = input.batchId ? portfolioBatchScope(input.batchId, authContext) : undefined;
          if (input.batchId && !batchScopeId) return json(response, 400, { error: { code: "INVALID_BATCH", message: "備審整理工作格式無效，請重新整理。" } });
          if (input.consent !== true) return json(response, 400, { error: { code: "PDF_CONSENT_REQUIRED", message: config.agentMode === "cli" ? "請先同意將 PDF 傳至 VivaPrep，並交由 Google Gemini 整理。" : "請先同意將所選 PDF 傳送至 Google Gemini API 解析。" } });
          const profile = input.customProfile
            ? createPracticeProfile(input.customProfile)
            : getProfiles().find((item) => item.id === input.profileId);
          if (!profile) return json(response, 404, { error: { code: "PROFILE_NOT_FOUND", message: "找不到指定的校系情境。" } });
          if (typeof input.pdfBase64 !== "string" || !input.pdfBase64 || input.pdfBase64.length > Math.ceil(config.maxPdfBytes * 4 / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.pdfBase64)) {
            return json(response, 400, { error: { code: "INVALID_PDF", message: "PDF 檔案格式無效，請重新選擇檔案。" } });
          }
          const pdfBuffer = Buffer.from(input.pdfBase64, "base64");
          input.pdfBase64 = "";
          if (!pdfBuffer.length || pdfBuffer.length > config.maxPdfBytes) {
            pdfBuffer.fill(0);
            return json(response, pdfBuffer.length > config.maxPdfBytes ? 413 : 400, { error: { code: pdfBuffer.length > config.maxPdfBytes ? "PDF_TOO_LARGE" : "INVALID_PDF", message: pdfBuffer.length > config.maxPdfBytes ? "PDF 不可大於 8 MB。" : "PDF 檔案內容是空的。" } });
          }
          if (pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
            pdfBuffer.fill(0);
            return json(response, 400, { error: { code: "INVALID_PDF", message: "選取的檔案不是有效的 PDF。" } });
          }
          let result;
          try { result = await agentService.parsePortfolioPdf(pdfBuffer, profile, { batchScopeId }); }
          finally { pdfBuffer.fill(0); }
          const notice = result.parsingMode === "extracted-text"
            ? "Gemini 根據 PDF 可擷取文字整理了候選主張；掃描影像與圖表未經 OCR／視覺解析。請回到原 PDF 核對並自行修改，這些主張不代表已查證的事實。"
            : "Gemini 依 PDF 內容整理了候選主張，請回到原 PDF 核對並自行修改；它們不代表已查證的事實。";
          return json(response, 200, { ...result, notice });
        }
        if (method === "POST" && pathname === "/api/portfolio/release") {
          const input = await readJson(request, 1024);
          const scope = portfolioBatchScope(input.batchId, authContext);
          if (!scope) return json(response, 400, { error: { code: "INVALID_BATCH", message: "備審整理工作格式無效。" } });
          agentService.release(scope);
          return json(response, 200, { released: true });
        }
        if (method === "POST" && pathname === "/api/sessions") {
          const input = await readJson(request, config.maxRequestBytes);
          const result = await orchestrator.createSession(input, authContext);
          json(response, 201, result);
          return;
        }
        if (parts[1] === "sessions" && parts[2]) {
          const sessionId = parts[2];
          const ownedSession = store.get(sessionId);
          if (!authService.ownsInterviewSession(authContext, ownedSession)) return json(response, 404, { error: { code: "SESSION_NOT_FOUND", message: "找不到這場面試。" } });
          if (method === "GET" && parts[3] === "events" && parts.length === 4) {
            response.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "Connection": "keep-alive",
              "X-Accel-Buffering": "no",
            });
            response.write("retry: 2000\n\n");
            const requestedSequence = Number(request.headers["last-event-id"] || url.searchParams.get("after") || 0);
            let lastSequence = Number.isSafeInteger(requestedSequence) && requestedSequence > 0 ? requestedSequence : 0;
            const unsubscribe = store.subscribe(sessionId, (event) => {
              if (event.seq <= lastSequence) return;
              lastSequence = event.seq;
              sendEvent(response, event);
            });
            for (const event of store.replayAfter(sessionId, lastSequence)) {
              lastSequence = event.seq;
              sendEvent(response, event);
            }
            const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 20000);
            response.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
            return;
          }
          if (method === "GET" && parts[3] === "events" && parts[5] === "audio") {
            const audio = orchestrator.audioForEvent(sessionId, Number(parts[4]));
            if (!audio) return json(response, 404, { error: { code: "AUDIO_NOT_FOUND", message: "找不到這段語音。" } });
            response.writeHead(200, { "Content-Type": audio.mimeType, "Cache-Control": "private, no-store", "Content-Length": audio.buffer.length, "X-Content-Type-Options": "nosniff" });
            response.end(audio.buffer);
            return;
          }
          if (method === "GET" && parts.length === 3) {
            json(response, 200, orchestrator.getSession(sessionId));
            return;
          }
          if (method === "POST" && parts[3] === "answers") {
            const input = await readJson(request, config.maxRequestBytes);
            const result = await orchestrator.submitAnswer(sessionId, input);
            json(response, 202, result);
            return;
          }
          if (method === "PATCH" && parts[3] === "settings") {
            const input = await readJson(request, 4096);
            json(response, 200, orchestrator.updateSettings(sessionId, input));
            return;
          }
          if (method === "POST" && parts[3] === "nudge") {
            const input = await readJson(request, 4096);
            json(response, 200, await orchestrator.nudge(sessionId, input));
            return;
          }
          if (method === "POST" && parts[3] === "activity") {
            const input = await readJson(request, 4096);
            json(response, 200, orchestrator.candidateActivity(sessionId, input));
            return;
          }
          if (method === "POST" && ["progress", "ending", "close"].includes(parts[3])) {
            const input = await readJson(request, 4096);
            const result = parts[3] === "progress" ? orchestrator.progress(sessionId, input) : parts[3] === "ending" ? orchestrator.prepareEnding(sessionId, input) : await orchestrator.close(sessionId, input);
            json(response, 200, result);
            return;
          }
          if (method === "POST" && parts[3] === "audio-answers") {
            const audio = await readBody(request, config.maxAudioBytes);
            const mimeType = String(request.headers["content-type"] || "audio/webm").split(";")[0].slice(0, 100);
            const turnId = String(request.headers["x-vivaprep-turn"] || "").slice(0, 100);
            const rawSequence = request.headers["x-vivaprep-event-seq"];
            json(response, 202, await orchestrator.transcribeAnswer(sessionId, audio, mimeType, { turnId, eventSeq: rawSequence == null ? undefined : Number(rawSequence), elapsedSeconds: request.headers["x-vivaprep-elapsed"] == null ? undefined : Number(request.headers["x-vivaprep-elapsed"]) }));
            return;
          }
          if (method === "POST" && parts[3] === "finish") {
            const input = await readJson(request, 65_536);
            json(response, 200, await orchestrator.finish(sessionId, input.reason || "manual", input.cameraMetrics || null));
            return;
          }
          if (method === "POST" && parts[3] === "review" && parts[4] === "retry") {
            json(response, 200, await orchestrator.retryReview(sessionId));
            return;
          }
          if (method === "GET" && parts[3] === "review") {
            json(response, 200, orchestrator.getReview(sessionId));
            return;
          }
          if (method === "DELETE" && parts.length === 3) {
            orchestrator.deleteSession(sessionId);
            response.writeHead(204, { "Cache-Control": "no-store" }).end();
            return;
          }
        }
        if (method === "GET" && pathname === "/api/reports/share-policy") {
          return json(response, 200, { policy: reportRepository.sharePolicy() });
        }
        if (method === "POST" && pathname === "/api/reports/preview") {
          authService.rateLimit("report-preview", request.socket.remoteAddress, 40, 60 * 60 * 1000);
          const input = await readJson(request, Math.min(config.maxRequestBytes, 64 * 1024));
          const profile = getProfiles().find((item) => item.id === input.profileId);
          if (!profile) return json(response, 404, { error: { code: "PROFILE_NOT_FOUND", message: "找不到指定的校系情境。" } });
          const preview = reportRepository.preview({
            schoolId: profile.schoolId,
            departmentId: profile.departmentId,
            academicYear: Number(input.academicYear) || profile.academicYear,
            admissionRoute: profile.admissionRoute,
            format: input.format,
            topics: input.topics,
            summary: input.summary,
          });
          return json(response, 200, { preview: { ...preview.sanitized, findings: preview.findings, previewHash: preview.previewHash }, policy: preview.policy });
        }
        if (method === "POST" && pathname === "/api/reports") {
          authService.rateLimit("report-submit", request.socket.remoteAddress, 12, 60 * 60 * 1000);
          const input = await readJson(request, Math.min(config.maxRequestBytes, 64 * 1024));
          const profile = getProfiles().find((item) => item.id === input.profileId);
          if (!profile) return json(response, 404, { error: { code: "PROFILE_NOT_FOUND", message: "找不到指定的校系情境。" } });
          const record = await reportRepository.create({
            schoolId: profile.schoolId,
            departmentId: profile.departmentId,
            academicYear: Number(input.academicYear) || profile.academicYear,
            admissionRoute: profile.admissionRoute,
            format: input.format,
            topics: input.topics,
            summary: input.summary,
            title: input.title,
            previewHash: input.previewHash,
            consentVersion: input.consentVersion,
            consentToShare: input.consentToShare === true,
            confirmNoIdentifiers: input.confirmNoIdentifiers === true,
          });
          return json(response, 202, { reportId: record.reportId, withdrawalCode: record.withdrawalToken, state: record.state, reviewStatus: record.reviewStatus, message: "心得已送交審核；核准前不會進入共用檢索。撤回碼只顯示這一次，請立即保存。" });
        }
        if (method === "POST" && parts[1] === "reports" && parts[2] && parts[3] === "withdraw") {
          const input = await readJson(request, 4096);
          const result = await reportRepository.withdraw(parts[2], input.withdrawalCode || input.withdrawalToken);
          if (!result.authorized) return json(response, 403, { error: { code: "WITHDRAWAL_NOT_AUTHORIZED", message: "撤回碼無效或心得已撤回。" } });
          return json(response, 200, { reportId: result.reportId, reviewStatus: result.reviewStatus, message: "心得已自共用檢索停用，摘要內容已清除。" });
        }
        if (pathname === "/api/admin/reports" && method === "GET") {
          authService.requireRole(authContext, "report_reviewer");
          const reports = (await reportRepository.pendingReports()).map(({ withdrawalTokenHash, ...record }) => record);
          return json(response, 200, { reports });
        }
        if (parts[1] === "admin" && parts[2] === "reports" && parts[3] && parts[4] === "review" && method === "POST") {
          authService.requireRole(authContext, "report_reviewer");
          const input = await readJson(request, 4096);
          if (!["approved", "rejected", "needs_changes"].includes(input.decision)) return json(response, 400, { error: { code: "INVALID_DECISION", message: "審核決定不正確。" } });
          const record = await reportRepository.review(parts[3], input.decision, input.note, authContext.userId);
          if (!record) return json(response, 404, { error: { code: "REPORT_NOT_FOUND", message: "找不到這筆心得。" } });
          if (record.conflict) return json(response, 409, { error: { code: "REPORT_ALREADY_REVIEWED", message: "這筆心得已經審核過。" } });
          const { withdrawalTokenHash, ...publicRecord } = record;
          return json(response, 200, { report: publicRecord });
        }
        if (pathname === "/api/admin/privacy-requests" && method === "GET") {
          return json(response, 200, { requests: authService.pendingPrivacyRequests(authContext) });
        }
        if (parts[1] === "admin" && parts[2] === "privacy-requests" && parts[3] && parts[4] === "complete" && method === "POST") {
          return json(response, 200, authService.completePrivacyRequest(authContext, parts[3]));
        }
        json(response, 404, { error: { code: "NOT_FOUND", message: "找不到這個 API。" } });
        return;
      }

      const relative = pathname === "/"
        ? "index.html"
        : pathname.startsWith("/vendor/mediapipe/")
          ? "node_modules/@mediapipe/tasks-vision" + pathname.slice("/vendor/mediapipe".length)
          : pathname === "/vendor/three.module.js" || pathname === "/vendor/three.core.js"
          ? "node_modules/three/build" + pathname.replace("/vendor", "")
          : pathname.startsWith("/vendor/addons/")
            ? "node_modules/three/examples/jsm" + pathname.slice("/vendor/addons".length)
            : pathname.startsWith("/assets/")
              ? "public" + pathname
              : pathname.replace(/^[/\\]+/, "");
      const filePath = resolve(join(rootPath, relative));
      if (filePath !== rootPath && !filePath.startsWith(rootPath + sep)) return response.writeHead(403).end("Forbidden");
      const info = await stat(filePath).catch((error) => { if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null; throw error; });
      if (!info?.isFile()) return response.writeHead(404).end("Not found");
      // Revalidate instead of re-downloading: large images and vendor bundles
      // come back as 304 when unchanged.
      const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      if (request.headers["if-none-match"] === etag) return response.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" }).end();
      response.writeHead(200, {
        "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-cache",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Length": info.size,
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (response.headersSent) return response.end();
      const status = Number(error?.status) || Number(error?.statusCode) || 500;
      const code = error?.code || "INTERNAL_ERROR";
      const safeProviderErrors = new Set(["AGENT_TIMEOUT", "AGENT_UNAVAILABLE", "AGENT_CALL_FAILED", "AGENT_INVALID_OUTPUT", "GEMINI_API_KEY_REQUIRED", "GEMINI_AUTH_FAILED", "GEMINI_RATE_LIMITED", "GEMINI_UNAVAILABLE", "GEMINI_CALL_FAILED"]);
      const message = status < 500 || safeProviderErrors.has(code) ? error.message : "伺服器暫時無法完成要求。";
      if (status >= 500) process.stderr.write(`[api-error] ${code}\n`);
      json(response, status, { error: { code, message } });
    }
  };
}

function sendAuthActionPage(response, action, token) {
  const safeToken = JSON.stringify(String(token || "")).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  const verify = action === "verify-email";
  const cancelDeletion = action === "cancel-deletion";
  const title = verify ? "驗證電子郵件" : cancelDeletion ? "取消帳號刪除" : "重設密碼";
  const content = verify
    ? `<p>請確認這是你剛剛申請的驗證連結。</p><button id="submit" type="button">驗證並登入</button>`
    : cancelDeletion
      ? `<p>確認後會取消帳號刪除申請，並重新登入帳號。</p><button id="submit" type="button">取消刪除並重新登入</button>`
      : `<p>請設定新密碼（至少 12 個字元）。</p><form id="form"><label>新密碼<input id="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><button type="submit">更新密碼</button></form>`;
  const script = verify
    ? `document.getElementById('submit').addEventListener('click',async()=>{await send('/api/auth/verify-email',{token});});`
    : cancelDeletion
      ? `document.getElementById('submit').addEventListener('click',async()=>{await send('/api/account/deletion-requests/cancel-token',{token});});`
      : `document.getElementById('form').addEventListener('submit',async e=>{e.preventDefault();await send('/api/auth/password-reset/confirm',{token,password:document.getElementById('password').value});});`;
  const successText = verify ? "驗證完成，現在可以進入 VivaPrep。" : cancelDeletion ? "帳號刪除申請已取消，現在可以繼續使用 VivaPrep。" : "密碼已更新，請回到登入頁使用新密碼。";
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>${title}｜VivaPrep</title><style>body{font-family:system-ui,sans-serif;background:#f5f2eb;color:#25312e;display:grid;min-height:100vh;place-items:center;margin:0}.card{box-sizing:border-box;width:min(420px,calc(100% - 32px));padding:32px;border:1px solid #e4ded3;border-radius:16px;background:#fff;box-shadow:0 16px 50px #26342b18}h1{font-size:24px}p{line-height:1.7;color:#68736f}label{display:grid;gap:8px;margin:20px 0}input{padding:12px;border:1px solid #c9d0cc;border-radius:8px}button{padding:12px 16px;border:0;border-radius:8px;background:#245d4d;color:white;font-size:15px;cursor:pointer}#message{min-height:24px;margin-top:16px}</style><main class="card"><h1>${title}</h1>${content}<p id="message" role="status"></p></main><script>const token=${safeToken};let csrfToken='';history.replaceState(null,'',location.pathname);async function csrf(){if(!csrfToken){const r=await fetch('/api/auth/session',{credentials:'same-origin'});csrfToken=(await r.json()).csrfToken;}return csrfToken;}async function send(path,body){const m=document.getElementById('message');m.textContent='處理中…';try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':await csrf()},body:JSON.stringify(body),credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error?.message||'連結無效或已過期。');m.textContent=${JSON.stringify(successText)};if(${verify || cancelDeletion})setTimeout(()=>location.assign('/'),900);}catch(e){m.textContent=e.message;}}${script}</script></html>`;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(html);
}

function orchestratorSpeech(orchestrator) {
  return orchestrator.speechStatus?.() || { available: false, provider: "off" };
}
