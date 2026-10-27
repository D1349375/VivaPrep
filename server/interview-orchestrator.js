import { randomUUID } from "node:crypto";
import { AgentError } from "./agent-provider.js";
import { retrieveSources } from "./source-retriever.js";
import { roles } from "./agent-service.js";
import { createPracticeProfile } from "./profiles.js";
import { cameraMetricsForTurns, sanitizeCameraMetrics } from "./camera-metrics.js";
import { OpeningPlanner } from "./opening-planner.js";
import { practiceBudget, topicPolicy, focusAspect } from "./interview-guide.js";
import { redactSchool, redactSchoolMentions, violatesAnonymity } from "./anonymity.js";
import { safeSwitchQuestions } from "./panel-coordinator.js";

const roleBySpeaker = { portfolio: "portfolio", technical: "technical", logic: "motivation" };
const retryReasonText = "上次候選題重複、太長，或違反匿名規則（提及、猜測或詢問學生就讀的學校）。請離開目前話題線，改問未探索的新重點。";
const finalSafeQuestion = { candidateQuestion: "時間差不多了，最後請你簡短補充一個剛才還沒談到的重點。", questionFocus: "future_plan" };

function safeQuestion(roleId, finalQuestion = false) {
  return { ...(finalQuestion ? finalSafeQuestion : safeSwitchQuestions[roleId] || safeSwitchQuestions.portfolio), dialogueAction: "switch_topic", sourceRefs: [] };
}

function cleanClaims(claims) {
  if (!Array.isArray(claims)) return [];
  return claims.map((claim) => redactSchool(String(claim?.text || "").trim()).slice(0, 500)).filter(Boolean).slice(0, 40);
}

function cleanPortfolioEvidence(claims) {
  if (!Array.isArray(claims)) return [];
  return claims.map((claim) => ({
    text: String(claim?.text || "").trim().slice(0, 500),
    sourcePage: Number(claim?.sourcePage),
    evidenceQuote: redactSchool(String(claim?.evidenceQuote || "").trim()).slice(0, 240),
    claimType: String(claim?.claimType || "").slice(0, 40),
    confidence: ["low", "medium", "high"].includes(claim?.confidence) ? claim.confidence : "low",
    documentId: String(claim?.documentId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
    sourceFilename: redactSchool(String(claim?.sourceFilename || "").split(/[\\/]/).at(-1)).slice(0, 120),
  })).filter((claim) => claim.text).slice(0, 40).map((claim, claimIndex) => {
    const sourcePage = claim.sourcePage;
    const evidenceQuote = claim.evidenceQuote;
    if ((!Number.isInteger(sourcePage) || sourcePage < 1) && !evidenceQuote) return null;
    return {
      claimIndex,
      ...(claim.documentId ? { documentId: claim.documentId, sourceFilename: claim.sourceFilename } : {}),
      ...(Number.isInteger(sourcePage) && sourcePage > 0 ? { sourcePage } : {}),
      ...(evidenceQuote ? { evidenceQuote } : {}),
      claimType: claim.claimType,
      confidence: claim.confidence,
    };
  }).filter(Boolean);
}

function compactSources(sources) {
  return sources.slice(0, 4).map((source) => ({
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    claimType: source.claimType,
    academicYear: source.academicYear,
    admissionRoute: source.admissionRoute,
    title: String(source.title || "").slice(0, 160),
    summary: String(source.summary || source.excerpt || "").slice(0, 700),
    confidence: source.confidence,
    reportCount: source.reportCount,
    url: source.url,
    retrievalNote: source.retrievalNote || null,
  }));
}

function compactTurns(turns, limit = 4, excludeTurnId = null, answerLimit = 700) {
  return turns.filter((turn) => turn.turnId !== excludeTurnId).slice(-limit).map((turn) => ({
    turnId: turn.turnId,
    roleId: turn.roleId,
    questionText: String(turn.questionText || "").slice(0, 260),
    answerText: redactSchool(turn.answerText).slice(-answerLimit),
    followUps: (turn.followUps || []).slice(-1).map((text) => String(text).slice(0, 200)),
    questionFocus: turn.questionFocus || null,
  }));
}

function compactAssessments(assessments) {
  return assessments.map((item) => ({
    turnId: item.turnId,
    agentId: item.agentId,
    rubricDimension: item.rubricDimension,
    assessment: String(item.assessment || "").slice(0, 220),
    evidenceRefs: (item.evidenceRefs || []).slice(0, 1).map((ref) => ({ turnId: ref.turnId, quote: String(ref.quote || "").slice(0, 120) })),
    confidence: item.confidence,
    limits: (item.limits || []).slice(0, 1).map((limit) => String(limit).slice(0, 120)),
  }));
}

function compactReview(review) {
  return {
    summary: String(review.summary || "").slice(0, 350),
    sharedStrengths: review.sharedStrengths.slice(0, 3).map((item) => String(item).slice(0, 180)),
    improvementPriorities: review.improvementPriorities.slice(0, 3).map((item) => ({
      priority: item.priority,
      title: String(item.title || "").slice(0, 100),
      description: String(item.description || "").slice(0, 220),
      evidenceRefs: item.evidenceRefs.slice(0, 2),
    })),
    perspectiveDifferences: review.perspectiveDifferences.slice(0, 4).map((item) => ({
      perspective: String(item.perspective || "").slice(0, 80),
      observation: String(item.observation || "").slice(0, 180),
    })),
    practiceDrill: review.practiceDrill.slice(0, 2).map((item) => ({
      prompt: String(item.prompt || "").slice(0, 180),
      checklist: item.checklist.slice(0, 4).map((entry) => String(entry).slice(0, 100)),
    })),
    evidenceRefs: review.evidenceRefs.slice(0, 4),
    sourceRefs: review.sourceRefs.slice(0, 8),
    dataLimits: review.dataLimits.slice(0, 4).map((item) => String(item).slice(0, 160)),
  };
}

function completeReviewTurns(turns) {
  return turns.map((turn) => ({
    turnId: turn.turnId,
    roleId: turn.roleId,
    questionText: String(turn.questionText || "").slice(0, 1200),
    answerText: redactSchool(turn.answerText),
    followUps: (turn.followUps || []).map((text) => String(text).slice(0, 800)),
  }));
}

// The professor and review Agents only ever see answers with school names masked.
function modelTurns(turns) {
  return turns.map((turn) => ({ ...turn, answerText: redactSchool(turn.answerText) }));
}

function threadOf(turn) {
  return { threadId: turn.threadId || turn.turnId, threadDepth: Number(turn.threadDepth) || 0 };
}

function topicConversation(session, answeredTurn) {
  const { threadId, threadDepth } = threadOf(answeredTurn);
  const { maxFollowUps } = topicPolicy(session);
  const coveredAspects = [...new Set(session.turns.map((turn) => focusAspect[turn.questionFocus]).filter(Boolean))];
  return {
    coveredFocus: session.turns.slice(-4).map((turn) => turn.questionFocus).filter(Boolean),
    currentThread: {
      depth: threadDepth,
      maxFollowUps,
      followUpsLeft: Math.max(0, maxFollowUps - threadDepth),
      questions: session.turns.filter((turn) => threadOf(turn).threadId === threadId).map((turn) => String(turn.questionText || "").slice(0, 160)),
    },
    threadCount: new Set(session.turns.map((turn) => threadOf(turn).threadId)).size,
    coveredAspects,
    unexploredAspects: ["經驗細節", "學習與反思", "選系動機", "未來規劃"].filter((aspect) => !coveredAspects.includes(aspect)),
  };
}

function splitReviewChunks(turns, assessments, maxPromptDataChars = 14000, maxTurnsPerChunk = 6) {
  const chunks = [];
  let current = { turns: [], assessments: [] };
  let currentChars = 0;
  for (const turn of turns) {
    const compactTurn = completeReviewTurns([turn])[0];
    const turnAssessments = compactAssessments(assessments.filter((item) => item.turnId === turn.turnId));
    const itemChars = JSON.stringify({ turn: compactTurn, assessments: turnAssessments }).length + 1;
    if (current.turns.length && (currentChars + itemChars > maxPromptDataChars || current.turns.length >= maxTurnsPerChunk)) {
      chunks.push(current);
      current = { turns: [], assessments: [] };
      currentChars = 0;
    }
    current.turns.push(turn);
    current.assessments.push(...turnAssessments);
    currentChars += itemChars;
  }
  if (current.turns.length || !chunks.length) chunks.push(current);
  return chunks;
}

export class InterviewOrchestrator {
  constructor({ store, agentService, coordinator, speechAdapter, reportRepository, interviewHistoryRepository, getProfile, config }) {
    this.store = store;
    this.agentService = agentService;
    this.coordinator = coordinator;
    this.speechAdapter = speechAdapter;
    this.reportRepository = reportRepository;
    this.interviewHistoryRepository = interviewHistoryRepository;
    this.getProfile = getProfile;
    this.config = config;
  }

  async createSession(input, owner = {}) {
    const profile = input?.customProfile
      ? createPracticeProfile(input.customProfile)
      : this.getProfile(input?.profileId);
    if (!profile) throw new AgentError("PROFILE_NOT_FOUND", "找不到指定的校系情境。", 404);
    const roster = Array.isArray(input.panelIds) ? [...new Set(input.panelIds.map(String))] : ["technical", "portfolio", "logic"];
    if (!roster.length || roster.length > 3 || roster.some((id) => !["technical", "portfolio", "logic"].includes(id))) {
      throw new AgentError("INVALID_PANEL", "請選擇一至三位有效的教授角色。", 400);
    }
    const durationMinutes = Number(input.durationMinutes || 5);
    if (!Number.isInteger(durationMinutes) || durationMinutes < this.config.sessionDurationMin || durationMinutes > this.config.sessionDurationMax) {
      throw new AgentError("INVALID_DURATION", `練習時間需介於 ${this.config.sessionDurationMin} 到 ${this.config.sessionDurationMax} 分鐘。`, 400);
    }
    const mode = input.mode === "voice" ? "voice" : "text";
    const speechStatus = this.speechAdapter.status();
    const voiceEnabled = mode === "voice" && speechStatus.available && input.consent?.audioProcessing === true;
    if (this.agentService.mode !== "mock" && input.consent?.modelProcessing !== true) {
      throw new AgentError("CONSENT_REQUIRED", "使用 Gemini 前，請先同意將本場對話內容送至模型服務處理。", 400);
    }
    if (input.consent?.cameraMetricsProcessing === true && (input.cameraAnalysis !== true || input.consent?.modelProcessing !== true)) {
      throw new AgentError("CAMERA_METRICS_CONSENT_REQUIRED", "傳送鏡頭衍生數值前，請啟用本機鏡頭分析並同意 Agent 處理本場內容。", 400);
    }
    if (Array.isArray(input.confirmedClaims) && input.confirmedClaims.filter((claim) => String(claim?.text || "").trim()).length > 40) throw new AgentError("TOO_MANY_CLAIMS", "本場最多使用 40 個備審主張，請先精簡內容。", 400);
    const claims = cleanClaims(input.confirmedClaims);
    const portfolioEvidence = cleanPortfolioEvidence(input.confirmedClaims);
    const claimSchoolMentions = (Array.isArray(input.confirmedClaims) ? input.confirmedClaims : [])
      .reduce((count, claim) => count + redactSchoolMentions(claim?.text).count + redactSchoolMentions(claim?.evidenceQuote).count, 0);
    const requestedSave = input.retentionMode === "saved";
    if (requestedSave && (!owner.userId || input.consent?.saveHistory !== true)) {
      throw new AgentError("SAVE_HISTORY_CONSENT_REQUIRED", "登入並明確同意保存本場練習後，才能加入個人歷史。", 400);
    }
    const approvedReports = await this.reportRepository.approvedSources();
    const sources = retrieveSources(profile, claims.join(" "), claims, approvedReports, 8);
    const session = {
      id: randomUUID(),
      ownerUserId: owner.userId || null,
      guestOwnerHash: owner.userId ? null : owner.guestOwnerHash || null,
      retentionMode: requestedSave ? "saved" : "ephemeral",
      profileId: profile.id,
      profileVersion: profile.version,
      profileSnapshot: {
        school: profile.school,
        department: profile.department,
        academicYear: profile.academicYear,
        admissionRoute: profile.admissionRoute,
        officialFacts: profile.officialFacts,
        unknowns: profile.unknowns,
        profileStatus: profile.profileStatus,
      },
      durationMinutes,
      elapsedSeconds: 0,
      stopAfterCurrentAnswer: false,
      mode,
      voiceEnabled,
      captionsEnabled: input.captionsEnabled !== false,
      roster,
      claims,
      portfolioEvidence,
      anonymity: { claimMentions: claimSchoolMentions, answerMentions: 0 },
      seed: Number.isInteger(Number(input.seed)) ? Number(input.seed) : 1,
      consentSnapshot: {
        modelProcessing: input.consent?.modelProcessing === true,
        audioProcessing: input.consent?.audioProcessing === true,
        saveHistory: requestedSave,
        cameraAnalysis: input.cameraAnalysis === true,
        cameraMetricsProcessing: input.consent?.cameraMetricsProcessing === true,
        consentVersion: "v1",
        consentedAt: new Date().toISOString(),
      },
      status: "active",
      phase: "question",
      startedAt: new Date().toISOString(),
      endedAt: null,
      currentEvent: null,
      turns: [],
      assessments: [],
      sources,
      eventSequence: 0,
      events: [],
      audioBySequence: new Map(),
      nudgeUsedForTurn: new Set(),
      review: null,
      reviewError: null,
      cameraMetrics: null,
    };
    this.store.create(session);
    if (this.interviewHistoryRepository) {
      try {
        if (input.consent?.modelProcessing === true) this.interviewHistoryRepository.recordConsent({ sessionId: session.id, userId: session.ownerUserId, purpose: "external_model", granted: true, version: "model-processing-v1" });
        if (input.consent?.audioProcessing === true) this.interviewHistoryRepository.recordConsent({ sessionId: session.id, userId: session.ownerUserId, purpose: "speech_processing", granted: true, version: "speech-processing-v2" });
        if (requestedSave) this.interviewHistoryRepository.recordConsent({ sessionId: session.id, userId: session.ownerUserId, purpose: "save_history", granted: true, version: "save-history-v1" });
        if (input.consent?.cameraMetricsProcessing === true) this.interviewHistoryRepository.recordConsent({ sessionId: session.id, userId: session.ownerUserId, purpose: "camera_metrics_processing", granted: true, version: "camera-metrics-processing-v1" });
      } catch (error) {
        this.store.delete(session.id);
        throw error;
      }
    }
    let event;
    try {
      event = await this.#askOpening(session);
    } catch (error) {
      this.store.delete(session.id);
      this.agentService.release?.(session.id);
      throw error;
    }
    this.store.emit(session.id, { type: "session.ready", status: "active", mode: this.agentService.mode, speech: speechStatus });
    const persisted = this.store.emit(session.id, event);
    session.currentEvent = persisted;
    this.store.save(session);
    void this.#maybeSynthesize(session, persisted);
    return { session: this.publicSession(session), event: persisted, agentMode: this.agentService.mode, modelId: this.agentService.modelId, speech: speechStatus };
  }

  getSession(sessionId) {
    const session = this.#requireSession(sessionId);
    return {
      ...this.publicSession(session),
      currentEvent: session.currentEvent ? { ...session.currentEvent } : null,
      turns: session.turns.map((turn) => ({ turnId: turn.turnId, roleId: turn.roleId, speakerId: turn.speakerId, questionText: turn.questionText, finalQuestion: Boolean(turn.finalQuestion), answerText: turn.answerText || "", followUps: turn.followUps || [], ...threadOf(turn) })),
      review: session.review,
      reviewError: session.reviewError,
      timings: session.timings || [],
    };
  }

  updateSettings(sessionId, input) {
    const session = this.#requireActive(sessionId);
    if (typeof input?.captionsEnabled !== "boolean" && !["voice", "text"].includes(input?.mode)) throw new AgentError("INVALID_SESSION_SETTINGS", "請提供有效的字幕或回答方式設定。", 400);
    if (input.mode === "voice") {
      if (input.audioProcessing !== true) throw new AgentError("AUDIO_CONSENT_REQUIRED", "啟用語音前需同意音訊處理。", 400);
      if (!this.speechAdapter.status().available) throw new AgentError("SPEECH_UNAVAILABLE", "語音服務尚未準備好。", 503);
      session.consentSnapshot.audioProcessing = true;
      if (session.ownerUserId && this.interviewHistoryRepository) this.interviewHistoryRepository.recordConsent({ sessionId: session.id, userId: session.ownerUserId, purpose: "speech_processing", granted: true, version: "speech-processing-v2" });
      session.voiceEnabled = true;
      session.mode = "voice";
    } else if (input.mode === "text") { session.voiceEnabled = false; session.mode = "text"; }
    if (typeof input.captionsEnabled === "boolean") session.captionsEnabled = input.captionsEnabled;
    this.store.save(session);
    return { session: this.publicSession(session) };
  }

  resumePendingWork() {
    for (const session of this.store.list()) {
      if (session.status === "reviewing") {
        void this.#generateReview(session);
        continue;
      }
      if (session.status !== "active" || session.phase !== "considering") continue;
      const answeredTurn = session.turns.find((turn) => turn.turnId === session.currentEvent?.turnId);
      if (answeredTurn?.answerText) this.#queueAnswerProcessing(session, answeredTurn);
    }
  }

  publicSession(session) {
    return {
      sessionId: session.id,
      profileId: session.profileId,
      profileVersion: session.profileVersion,
      profile: session.profileSnapshot,
      mode: session.mode,
      voiceEnabled: session.voiceEnabled,
      captionsEnabled: session.captionsEnabled,
      roster: session.roster,
      durationMinutes: session.durationMinutes,
      practiceBudget: practiceBudget(session),
      seed: session.seed,
      status: session.status,
      phase: session.phase,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      eventSequence: session.eventSequence,
      agentMode: this.agentService.mode,
      modelId: this.agentService.modelId,
      speech: this.speechAdapter.status(),
      sourceRefs: session.sources.map((source) => source.sourceId),
    };
  }

  speechStatus() {
    return this.speechAdapter.status();
  }

  async submitAnswer(sessionId, input) {
    const session = this.#requireActive(sessionId);
    this.#updateProgress(session, input);
    const text = String(input?.text || "").trim();
    if (!text || text.length > this.config.maxAnswerLength) throw new AgentError("INVALID_ANSWER", "回答不可空白，且最多 8000 個字元。", 400);
    if (!session.currentEvent) throw new AgentError("NO_CURRENT_QUESTION", "目前沒有等待回答的題目。", 409);
    if (input.turnId && input.turnId !== session.currentEvent.turnId) throw new AgentError("STALE_TURN", "這個回答屬於較早的題目，請回答目前畫面上的問題。", 409);
    const currentTurn = session.turns.find((turn) => turn.turnId === session.currentEvent.turnId);
    if (!currentTurn) throw new AgentError("TURN_NOT_FOUND", "找不到目前的面試回合。", 409);
    if (currentTurn.answerText) {
      if (currentTurn.answerText !== text) throw new AgentError("ANSWER_ALREADY_SUBMITTED", "這題已經收到回答，請等待下一個問題。", 409);
      if (!session.processingPromise && !session.stopAfterCurrentAnswer) this.#queueAnswerProcessing(session, currentTurn);
      return { accepted: true, turnId: currentTurn.turnId, phase: session.phase, retry: true };
    }
    currentTurn.answerText = text;
    currentTurn.submittedAt = input.submittedAt || new Date().toISOString();
    currentTurn.clientTurnId = String(input.clientTurnId || "").slice(0, 100) || null;
    const schoolMentions = redactSchoolMentions(text).count;
    if (schoolMentions) {
      session.anonymity ||= { claimMentions: 0, answerMentions: 0 };
      session.anonymity.answerMentions += schoolMentions;
      currentTurn.schoolMentionRedacted = true;
    }
    this.#queueAnswerProcessing(session, currentTurn);
    return { accepted: true, turnId: currentTurn.turnId, phase: session.phase, schoolMentionRedacted: Boolean(schoolMentions) };
  }

  #queueAnswerProcessing(session, currentTurn) {
    this.store.save(session);
    if (session.stopAfterCurrentAnswer) return;
    session.phase = "considering";
    this.store.emit(session.id, { type: "answer.received", turnId: currentTurn.turnId, phase: "considering", ...(currentTurn.schoolMentionRedacted ? { schoolMentionRedacted: true } : {}) });
    const work = currentTurn.finalQuestion || practiceBudget(session).remainingSeconds <= 20
      ? this.close(session.id, { reason: "completed" }) : this.#processAnswer(session, currentTurn);
    session.processingPromise = work.catch((error) => {
      if (session.stopAfterCurrentAnswer || session.status !== "active") return;
      this.store.emit(session.id, { type: "error", code: error.code || "AGENT_CALL_FAILED", message: error.message || "考官暫時無法回應，請重試。", recoverable: true });
      session.phase = "question";
    }).finally(() => { session.processingPromise = null; });
  }

  candidateActivity(sessionId, input = {}) {
    const session = this.#requireActive(sessionId);
    this.#updateProgress(session, input);
    if (input.turnId !== session.currentEvent?.turnId || input.eventSeq !== session.currentEvent?.seq) return { accepted: false };
    session.activityRevision = (session.activityRevision || 0) + 1;
    return { accepted: true };
  }

  async nudge(sessionId, input = {}) {
    const session = this.#requireActive(sessionId);
    this.#updateProgress(session, input);
    if (session.stopAfterCurrentAnswer) return { event: null, skipped: true };
    if (practiceBudget(session).remainingSeconds <= 20) return this.close(sessionId, { reason: practiceBudget(session).remainingSeconds === 0 ? "time" : "completed" });
    const current = session.currentEvent;
    if (!current) throw new AgentError("NO_CURRENT_QUESTION", "目前沒有等待回答的題目。", 409);
    if ((input.turnId && input.turnId !== current.turnId) || (input.eventSeq != null && input.eventSeq !== current.seq) || session.transcribingTurnId) return { event: null, skipped: true };
    const turn = session.turns.find((item) => item.turnId === current.turnId);
    if (turn?.answerText) throw new AgentError("ANSWER_ALREADY_SUBMITTED", "這題已經收到回答，請等候教授繼續。", 409);
    const nudgeKey = `${current.turnId}:${current.seq}`;
    if (session.nudgeUsedForTurn.has(nudgeKey)) return { event: null, skipped: true };
    session.nudgeUsedForTurn.add(nudgeKey);
    if (turn.finalQuestion && turn.followUps.length) return this.close(sessionId, { reason: "completed" });
    const nearEnd = practiceBudget(session).stage === "final_question";
    const switchTopic = !turn.finalQuestion && (turn.followUps || []).length > 0;
    if (nearEnd && !switchTopic) turn.finalQuestion = true;
    const nextSpeaker = session.roster[(session.roster.indexOf(current.speakerId) + 1) % session.roster.length];
    const role = roleBySpeaker[switchTopic ? nextSpeaker : current.speakerId];
    const activityRevision = session.activityRevision || 0;
    const context = {
      sessionId:session.id,
      task: switchTopic ? (nearEnd ? "final_question" : "switch_topic") : "rephrase",
      practiceBudget: practiceBudget(session),
      turnId: current.turnId,
      answer: "",
      previousQuestion: current.utterance,
      previousFocus: turn.questionFocus,
      claims: session.claims,
      portfolioEvidence: session.portfolioEvidence,
      sources: compactSources(session.sources),
      turns: compactTurns(session.turns, 4),
      askedQuestions: session.turns.slice(-8).map((item) => String(item.questionText || "").slice(0, 260)),
      profile: session.profileSnapshot,
      conversation: { ...topicConversation(session, turn), reason: switchTopic ? "no_response_after_rephrase" : "no_response_after_playback" },
    };
    let assessment;
    try {
      assessment = await this.agentService.assess(role, context);
      if (switchTopic && !this.coordinator.select([assessment], session.roster, session.turns, session.seed)) {
        assessment = await this.agentService.assess(role, { ...context, task: nearEnd ? "final_question" : "switch_topic", retryReason: retryReasonText });
        if (!this.coordinator.select([assessment], session.roster, session.turns, session.seed)) assessment = { ...assessment, ...safeQuestion(role, nearEnd) };
      }
      if (!switchTopic && violatesAnonymity(assessment.candidateQuestion)) assessment = { ...assessment, candidateQuestion: "還是我換個方式問：你可以先從這段經驗裡最有印象的一件事說起嗎？" };
    } catch (error) { session.nudgeUsedForTurn.delete(nudgeKey); throw error; }
    // The user may have answered while the Agent was generating the nudge.
    // Never let that delayed result replace a newer question or an answered turn.
    if (session.status !== "active"
      || session.stopAfterCurrentAnswer
      || session.currentEvent?.seq !== current.seq
      || (session.activityRevision || 0) !== activityRevision
      || session.transcribingTurnId
      || turn.answerText
      || session.processingPromise) {
      session.nudgeUsedForTurn.delete(nudgeKey);
      return { event: null, skipped: true };
    }
    let followUp = assessment.candidateQuestion;
    if (!followUp) { session.nudgeUsedForTurn.delete(nudgeKey); throw new AgentError("NO_VALID_QUESTION", "考官暫時無法接話，請稍後再試。"); }
    if (!switchTopic && !/換.{0,6}(方式|問法|角度)|先.{0,8}(說|聊|談|想)/u.test(followUp)) followUp = "還是我換個方式問：" + followUp;
    const newTurnId = randomUUID();
    const targetTurn = switchTopic ? { turnId: newTurnId, threadId: newTurnId, threadDepth: 0, roleId: role, speakerId: roles[role].speakerId, questionText: followUp, finalQuestion: nearEnd, questionFocus: assessment.questionFocus, answerText: "", sourceRefs: assessment.sourceRefs, followUps: [], createdAt: new Date().toISOString() } : turn;
    if (switchTopic) { turn.skippedReason = "no_response_after_rephrase"; session.turns.push(targetTurn); }
    else turn.followUps.push(followUp);
    const event = this.store.emit(session.id, {
      type: "interview.event",
      turnId: targetTurn.turnId,
      phase: switchTopic ? "question" : "follow_up",
      speakerId: targetTurn.speakerId,
      roleId: role,
      utterance: followUp,
      dialogueAction: switchTopic ? "switch_topic" : "rephrase",
      action: "follow_up",
      topic: switchTopic ? assessment.rubricDimension : current.topic,
      durationMs: 0,
      seed: session.seed,
      captionsEnabled: session.captionsEnabled,
      sourceRefs: assessment.sourceRefs,
      finalQuestion: Boolean(targetTurn.finalQuestion),
      mode: this.agentService.mode,
    });
    session.currentEvent = event;
    session.phase = switchTopic ? "question" : "follow_up";
    this.store.save(session);
    await this.#maybeSynthesize(session, event);
    return { event };
  }

  #updateProgress(session, input = {}) {
    const elapsed = Number(input.elapsedSeconds);
    if (Number.isFinite(elapsed) && elapsed >= 0) session.elapsedSeconds = Math.max(session.elapsedSeconds || 0, Math.min(Number(session.durationMinutes || 5) * 60, Math.floor(elapsed)));
  }

  progress(sessionId, input = {}) {
    const session = this.#requireActive(sessionId);
    this.#updateProgress(session, input);
    this.store.save(session);
    return { practiceBudget: practiceBudget(session) };
  }

  prepareEnding(sessionId, input = {}) {
    const session = this.#requireSession(sessionId);
    if (session.status === "active") {
      if (input.cancel === true) { session.stopAfterCurrentAnswer = false; session.endReason = null; session.phase = "question"; this.store.save(session); return { status: session.status }; }
      this.#updateProgress(session, input);
      session.stopAfterCurrentAnswer = true;
      session.endReason = input.reason === "time" ? "time" : "manual";
      session.activityRevision = (session.activityRevision || 0) + 1;
      this.agentService.release?.(sessionId);
      this.store.save(session);
    }
    return { status: session.status };
  }

  async close(sessionId, input = {}) {
    const session = this.#requireSession(sessionId);
    if (session.status === "closing") return { event: session.currentEvent };
    if (session.status !== "active") return { event: null, skipped: true };
    this.#updateProgress(session, input);
    session.stopAfterCurrentAnswer = true;
    session.status = "closing";
    session.phase = "closing";
    session.endReason ||= ["time", "manual", "completed"].includes(input.reason) ? input.reason : "completed";
    this.agentService.release?.(sessionId);
    const event = this.store.emit(session.id, {
      type: "interview.closing", phase: "closing", reason: session.endReason,
      speakerId: session.currentEvent?.speakerId || session.roster[0],
      utterance: session.endReason === "time" ? "時間到了，我們今天的面試就到這裡。謝謝你的分享，辛苦了。" : "好，我們今天的面試就到這裡。謝謝你的分享，辛苦了。",
      seed: session.seed, captionsEnabled: true, sourceRefs: [],
    });
    session.currentEvent = event;
    this.store.save(session);
    void this.#maybeSynthesize(session, event);
    return { event };
  }

  async finish(sessionId, reason = "manual", cameraMetricsInput = null) {
    const session = this.#requireSession(sessionId);
    if (!["active", "closing"].includes(session.status)) throw new AgentError("SESSION_NOT_ACTIVE", "這場面試已結束。", 409);
    if (cameraMetricsInput != null) {
      if (!session.consentSnapshot?.cameraMetricsProcessing) {
        throw new AgentError("CAMERA_METRICS_CONSENT_REQUIRED", "本場沒有同意傳送鏡頭衍生數值，這些資料不會送到 Agent。", 400);
      }
      session.cameraMetrics = sanitizeCameraMetrics(cameraMetricsInput, {
        turns: session.turns,
        roster: session.roster,
        durationMinutes: session.durationMinutes,
      });
      this.store.save(session);
    }
    session.status = "reviewing";
    session.stopAfterCurrentAnswer = true;
    this.agentService.release?.(sessionId);
    session.phase = "ended";
    session.endedAt = new Date().toISOString();
    if (session.processingPromise) await session.processingPromise;
    this.store.emit(session.id, { type: "session.ended", reason, endedAt: session.endedAt });
    await this.#generateReview(session);
    return { session: this.publicSession(session), review: session.review, reviewError: session.reviewError };
  }

  async retryReview(sessionId) {
    const session = this.#requireSession(sessionId);
    if (session.status !== "review_failed") throw new AgentError("REVIEW_NOT_RETRYABLE", "目前沒有需要重試的復盤。", 409);
    session.status = "reviewing";
    session.reviewError = null;
    this.store.save(session);
    await this.#generateReview(session);
    return { session: this.publicSession(session), review: session.review, reviewError: session.reviewError };
  }

  async #generateReview(session) {
    try {
      const sharedContext = {
        panel: session.roster.map(speaker => ({name:roles[roleBySpeaker[speaker]].name,dimension:roles[roleBySpeaker[speaker]].dimension})),
        profile: session.profileSnapshot,
        claims: session.claims,
        portfolioEvidence: session.portfolioEvidence,
        sources: compactSources(session.sources),
        ...(session.consentSnapshot?.cameraMetricsProcessing && session.cameraMetrics ? { cameraMetrics: session.cameraMetrics } : {}),
      };
      if (this.agentService.mode === "mock") {
        session.review = await this.agentService.review({
          ...sharedContext,
          turns: modelTurns(session.turns),
          assessments: session.assessments,
          validationTurns: modelTurns(session.turns),
        });
      } else {
        const chunks = splitReviewChunks(session.turns, session.assessments);
        const chunkReviews = [];
        for (let index = 0; index < chunks.length; index += 1) {
          const turns = chunks[index].turns;
          const review = await this.agentService.review({
            ...sharedContext,
            claims: session.claims.slice(0, 6).map((claim) => claim.slice(0, 320)),
            portfolioEvidence: session.portfolioEvidence,
            chunk: { index: index + 1, count: chunks.length },
            turns: completeReviewTurns(turns),
            cameraMetrics: cameraMetricsForTurns(session.cameraMetrics, turns),
            assessments: chunks[index].assessments,
            validationTurns: modelTurns(turns),
          });
          chunkReviews.push(compactReview(review));
        }
        session.review = chunks.length === 1
          ? chunkReviews[0]
          : await this.agentService.review({
            ...sharedContext,
            claims: session.claims.slice(0, 6).map((claim) => claim.slice(0, 320)),
            portfolioEvidence: session.portfolioEvidence,
            synthesis: true,
            cameraMetrics: null,
            chunkReviews,
            turns: [],
            assessments: [],
            validationTurns: modelTurns(session.turns),
          });
        if (chunks.length > 1) {
          session.review.dataLimits = [...new Set([
            "完整逐字稿已分段分析並統整。",
            ...session.review.dataLimits,
          ])].slice(0, 8);
        }
      }
      const { claimMentions = 0, answerMentions = 0 } = session.anonymity || {};
      if (claimMentions || answerMentions) {
        session.review.dataLimits = [...new Set([
          `匿名保護：${answerMentions ? `回答中有 ${answerMentions} 處` : ""}${answerMentions && claimMentions ? "、" : ""}${claimMentions ? `備審主張中有 ${claimMentions} 處` : ""}疑似學校名稱，已在送交 Agent 前遮蔽。正式面試通常不宜透露就讀學校。`,
          ...session.review.dataLimits,
        ])].slice(0, 8);
      }
      session.status = "completed";
      this.store.emit(session.id, { type: "review.ready", review: session.review });
      if (this.interviewHistoryRepository && session.retentionMode === "saved") {
        try { session.historySaved = this.interviewHistoryRepository.saveCompleted(session); }
        catch (historyError) { session.historySaveError = historyError.code || "HISTORY_SAVE_FAILED"; }
      }
    } catch (error) {
      session.reviewError = error.message;
      session.status = "review_failed";
      this.store.emit(session.id, { type: "review.failed", code: error.code || "REVIEW_FAILED", message: error.message || "復盤暫時無法完成，請稍後重試。" });
    }
  }

  getReview(sessionId) {
    const session = this.#requireSession(sessionId);
    return { status: session.status, review: session.review, error: session.reviewError };
  }

  async transcribeAnswer(sessionId, audioBuffer, mimeType, input = {}) {
    const session = this.#requireActive(sessionId);
    this.#updateProgress(session, input);
    if (!session.voiceEnabled) throw new AgentError("VOICE_NOT_ENABLED", "此場次沒有啟用語音回答，請改用文字輸入。", 400);
    const turnId = session.currentEvent?.turnId;
    if (input.turnId && input.turnId !== turnId) throw new AgentError("STALE_TURN", "這段語音屬於較早的題目，請回答目前的問題。", 409);
    if (input.eventSeq != null && input.eventSeq !== session.currentEvent?.seq) throw new AgentError("STALE_TURN", "題目已更新，請重新回答。", 409);
    if (session.transcribingTurnId) throw new AgentError("TRANSCRIPTION_IN_PROGRESS", "正在辨識上一段回答，請稍候。", 409);
    session.transcribingTurnId = turnId;
    session.activityRevision = (session.activityRevision || 0) + 1;
    try {
      const started = performance.now();
      const text = await this.speechAdapter.transcribe(audioBuffer, mimeType, { claims: session.claims, question: session.currentEvent?.utterance });
      this.#recordTiming(session, "transcription", started, { turnId });
      const accepted = await this.submitAnswer(sessionId, { turnId, text, elapsedSeconds: input.elapsedSeconds, submittedAt: new Date().toISOString() });
      return { transcript: text, ...accepted };
    } finally { session.transcribingTurnId = null; }
  }

  audioForEvent(sessionId, sequence) {
    const session = this.#requireSession(sessionId);
    return session.audioBySequence.get(Number(sequence)) || null;
  }

  deleteSession(sessionId) {
    const session = this.#requireSession(sessionId);
    this.agentService.release?.(sessionId);
    for (const audio of session.audioBySequence.values()) audio.buffer.fill(0);
    return this.store.delete(sessionId);
  }

  #requireSession(sessionId) {
    const session = this.store.get(sessionId);
    if (!session) throw new AgentError("SESSION_NOT_FOUND", "找不到這場面試。", 404);
    return session;
  }

  #requireActive(sessionId) {
    const session = this.#requireSession(sessionId);
    if (session.status !== "active") throw new AgentError("SESSION_NOT_ACTIVE", "這場面試已結束。", 409);
    return session;
  }

  async #askOpening(session) {
    const eligible = Object.values(roles).filter((role) => session.roster.includes(role.speakerId));
    const openingTurnId = randomUUID();
    const started = performance.now();
    this.openingPlanner ||= new OpeningPlanner();
    const openingPlan = this.openingPlanner.choose({ ownerKey: session.ownerUserId || session.guestOwnerHash, profileId: session.profileId, claims: session.claims, eligibleRoles: eligible.map((role) => role.id) });
    session.openingPlan = openingPlan;
    const openingRole = eligible.find((role) => role.id === openingPlan.roleId);
    const openingContext = {
      sessionId:session.id,
      task: "opening",
      practiceBudget: practiceBudget(session),
      openingPlan,
      turnId: openingTurnId,
      answer: "",
      claims: session.claims,
      portfolioEvidence: session.portfolioEvidence,
      sources: compactSources(session.sources),
      turns: [],
      askedQuestions: [],
      profile: session.profileSnapshot,
    };
    const candidates = [await this.agentService.assess(openingRole.id, openingContext)];
    let selected = this.coordinator.select(candidates, session.roster, [], session.seed);
    if (!selected) {
      candidates.push(await this.agentService.assess(openingRole.id, { ...openingContext, retryReason: "上次開場題太長或違反匿名規則（提及或詢問學生就讀的學校），請重新提出。" }));
      selected = this.coordinator.select(candidates.slice(-1), session.roster, [], session.seed);
    }
    this.#recordTiming(session, "opening_question", started, { modelCalls: candidates.length });
    if (!selected) {
      const fallback = { ...candidates.at(-1), candidateQuestion: "你好，可以先用一分鐘簡單介紹一下自己嗎？", questionFocus: "introduction", dialogueAction: "opening", sourceRefs: [] };
      selected = { roleId: openingRole.id, speakerId: openingRole.speakerId, utterance: fallback.candidateQuestion, topic: openingRole.dimension, assessment: fallback };
    }
    const turn = { turnId: openingTurnId, threadId: openingTurnId, threadDepth: 0, roleId: selected.roleId, speakerId: selected.speakerId, questionText: selected.utterance, questionFocus: selected.assessment.questionFocus, answerText: "", sourceRefs: selected.assessment.sourceRefs, followUps: [], createdAt: new Date().toISOString() };
    session.turns.push(turn);
    session.assessments.push(...candidates.filter(Boolean).map((item) => ({ ...item, turnId: turn.turnId })));
    const event = {
      type: "interview.event",
      turnId: turn.turnId,
      phase: "question",
      speakerId: selected.speakerId,
      roleId: selected.roleId,
      utterance: selected.utterance,
      dialogueAction: "opening",
      action: "speaking",
      topic: selected.topic,
      durationMs: Math.min(10000, selected.utterance.length * 160),
      seed: session.seed,
      captionsEnabled: session.captionsEnabled,
      sourceRefs: selected.assessment.sourceRefs,
      mode: this.agentService.mode,
    };
    session.currentEvent = event;
    return event;
  }

  async #processAnswer(session, answeredTurn) {
    if (session.stopAfterCurrentAnswer || session.status !== "active") return;
    const budget = practiceBudget(session);
    const finalQuestion = budget.stage === "final_question";
    const eligible = Object.values(roles).filter((role) => session.roster.includes(role.speakerId));
    const conversation = topicConversation(session, answeredTurn);
    const afterIntroduction = answeredTurn.questionFocus === "introduction";
    // The thread cap is enforced here, not left to the model: one experience
    // gets at most maxFollowUps follow-ups before a different aspect.
    const threadExhausted = !afterIntroduction && conversation.currentThread.followUpsLeft === 0;
    const declined = answeredTurn.answerText.length < 60 && /不知道|不太確定|答不出|想不出|換.{0,3}(題|話題)|跳過/u.test(answeredTurn.answerText);
    const context = {
      sessionId:session.id,
      task: finalQuestion ? "final_question" : declined || threadExhausted ? "switch_topic" : "assessment",
      practiceBudget: budget,
      turnId: answeredTurn.turnId,
      answer: redactSchool(answeredTurn.answerText),
      previousQuestion: answeredTurn.questionText,
      previousFocus: answeredTurn.questionFocus,
      claims: session.claims,
      portfolioEvidence: session.portfolioEvidence,
      sources: compactSources(session.sources),
      turns: compactTurns(session.turns, 3, answeredTurn.turnId),
      askedQuestions: session.turns.slice(-8).map((turn) => String(turn.questionText || "").slice(0, 260)),
      profile: session.profileSnapshot,
      conversation: { ...conversation, ...(threadExhausted ? { reason: "thread_follow_up_limit" } : afterIntroduction ? { reason: "after_introduction" } : {}) },
    };
    const started = performance.now();
    const role = this.coordinator.chooseRole(session.roster, session.turns, answeredTurn.answerText, context.task);
    const assessments = [{ ...await this.agentService.assess(role, context), turnId: answeredTurn.turnId }];
    if (session.stopAfterCurrentAnswer || session.status !== "active") return;
    session.assessments.push(...assessments);
    let selection = this.coordinator.select(assessments, session.roster, session.turns, session.seed);
    let modelCalls = 1;
    if (!selection && !finalQuestion) {
      const fallbackRole = eligible.find((role) => role.id !== answeredTurn.roleId) || eligible[0];
      const fresh = await this.agentService.assess(fallbackRole.id, { ...context, task: "switch_topic", retryReason: retryReasonText });
      modelCalls += 1;
      session.assessments.push({ ...fresh, turnId: answeredTurn.turnId });
      selection = this.coordinator.select([fresh], session.roster, session.turns, session.seed);
    }
    if (!selection) {
      const fallbackRole = finalQuestion ? role : (eligible.find((item) => item.id !== answeredTurn.roleId) || eligible[0]).id;
      const fallback = { ...assessments[0], ...safeQuestion(fallbackRole, finalQuestion) };
      selection = { roleId: fallbackRole, speakerId: roles[fallbackRole].speakerId, utterance: fallback.candidateQuestion, topic: roles[fallbackRole].dimension, assessment: fallback };
    }
    if (session.stopAfterCurrentAnswer || session.status !== "active") return;
    if (practiceBudget(session).remainingSeconds <= 20) { await this.close(session.id, { reason: practiceBudget(session).remainingSeconds === 0 ? "time" : "completed" }); return; }
    this.#recordTiming(session, "next_question", started, { turnId: answeredTurn.turnId, modelCalls });
    // Only an unforced follow-up stays on the current thread.
    const continuesThread = context.task === "assessment" && !afterIntroduction && selection.assessment.dialogueAction !== "switch_topic";
    const nextTurnId = randomUUID();
    const thread = threadOf(answeredTurn);
    const nextTurn = { turnId: nextTurnId, threadId: continuesThread ? thread.threadId : nextTurnId, threadDepth: continuesThread ? thread.threadDepth + 1 : 0, roleId: selection.roleId, speakerId: selection.speakerId, questionText: selection.utterance, questionFocus: selection.assessment.questionFocus, answerText: "", sourceRefs: selection.assessment.sourceRefs, followUps: [], createdAt: new Date().toISOString() };
    session.turns.push(nextTurn);
    nextTurn.finalQuestion = finalQuestion;
    const event = this.store.emit(session.id, {
      type: "interview.event",
      turnId: nextTurn.turnId,
      phase: "question",
      speakerId: selection.speakerId,
      roleId: selection.roleId,
      utterance: selection.utterance,
      dialogueAction: continuesThread ? "follow_up" : "switch_topic",
      action: "speaking",
      topic: selection.topic,
      durationMs: Math.min(10000, selection.utterance.length * 160),
      seed: session.seed,
      captionsEnabled: session.captionsEnabled,
      sourceRefs: selection.assessment.sourceRefs,
      finalQuestion,
      mode: this.agentService.mode,
    });
    session.currentEvent = event;
    session.phase = "question";
    this.store.save(session);
    await this.#maybeSynthesize(session, event);
  }

  async #maybeSynthesize(session, event) {
    if (!session.voiceEnabled) return;
    try {
      const started = performance.now();
      const audio = await this.speechAdapter.synthesize(event.utterance, { speakerId: event.speakerId, allowCloud: session.consentSnapshot?.modelProcessing === true });
      if (!["active", "closing"].includes(session.status) || session.currentEvent?.seq !== event.seq || this.store.get(session.id) !== session) { audio.buffer.fill(0); return; }
      session.audioBySequence.set(event.seq, audio);
      this.#recordTiming(session, "synthesis", started, { turnId: event.turnId, eventSeq: event.seq, provider: audio.provider || "local", ...(audio.fallbackReason ? { fallbackReason: audio.fallbackReason } : {}) });
      event.audioUrl = "/api/sessions/" + session.id + "/events/" + event.seq + "/audio";
      this.store.emit(session.id, { type: "interview.audio.ready", turnId: event.turnId, eventSeq: event.seq, audioUrl: event.audioUrl });
    } catch (error) {
      if (!["active", "closing"].includes(session.status) || session.currentEvent?.seq !== event.seq) return;
      this.store.emit(session.id, { type: "speech.warning", turnId: event.turnId, eventSeq: event.seq, message: error.message || "語音播放暫時無法使用，仍可閱讀字幕。" });
    }
  }

  #recordTiming(session, stage, started, details = {}) {
    session.timings ||= [];
    session.timings.push({ stage, durationMs: Math.round(performance.now() - started), ...details });
    if (session.timings.length > 100) session.timings.shift();
  }
}
