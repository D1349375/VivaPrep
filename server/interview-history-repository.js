import { randomUUID } from "node:crypto";
import { decryptText, encryptText } from "./crypto-utils.js";
import { summarizeCameraMetrics } from "./camera-metrics.js";

function timestamp() { return new Date().toISOString(); }
function setMonths(dateText, months) {
  const date = new Date(dateText);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

function pack(key, namespace, value) {
  return JSON.stringify({ encrypted: encryptText(key, namespace, JSON.stringify(value)) });
}
function unpack(key, namespace, value) {
  const decoded = JSON.parse(value);
  if (decoded?.encrypted) return JSON.parse(decryptText(key, namespace, decoded.encrypted));
  return decoded;
}

export class InterviewHistoryRepository {
  constructor({ database, applicationKey, retentionMonths = 24 }) {
    this.db = database.connection;
    this.applicationKey = applicationKey;
    this.retentionMonths = retentionMonths;
  }

  recordConsent({ sessionId, userId, purpose, granted, version }) {
    const policy = this.db.prepare("SELECT notice_sha256 FROM consent_policy_versions WHERE purpose=? AND version=? ORDER BY effective_at DESC LIMIT 1").get(purpose, version);
    if (!policy) throw new Error("CONSENT_POLICY_VERSION_NOT_FOUND:" + purpose + ":" + version);
    this.db.prepare(`INSERT INTO consent_receipts(receipt_id,user_id,interview_session_id,purpose,policy_version,notice_sha256,action,captured_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), userId || null, sessionId, purpose, version, policy.notice_sha256, granted ? "granted" : "denied", timestamp());
  }

  saveCompleted(session) {
    if (session.retentionMode !== "saved" || !session.ownerUserId || session.status !== "completed") return false;
    const endedAt = session.endedAt || timestamp();
    const expiresAt = setMonths(endedAt, this.retentionMonths);
    const metadata = {
      profileSnapshot: session.profileSnapshot,
      durationMinutes: session.durationMinutes,
      mode: session.mode,
      roster: session.roster,
      seed: session.seed,
      startedAt: session.startedAt,
      endedAt,
      claims: session.claims,
      sourceRefs: (session.sources || []).map((source) => source.sourceId),
      consentSnapshot: session.consentSnapshot,
      ...(session.consentSnapshot?.cameraMetricsProcessing && session.cameraMetrics
        ? { cameraMetrics: session.cameraMetrics }
        : {}),
    };
    const rows = session.turns || [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO interview_history(history_id,user_id,profile_id,profile_version,admission_route,status,started_at,ended_at,retention_expires_at,session_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(history_id) DO UPDATE SET
          status=excluded.status,ended_at=excluded.ended_at,retention_expires_at=excluded.retention_expires_at,session_json=excluded.session_json,deleted_at=NULL`)
        .run(session.id, session.ownerUserId, session.profileId, session.profileVersion, session.profileSnapshot.admissionRoute || "unknown", session.status, session.startedAt, endedAt, expiresAt, pack(this.applicationKey, "saved-interview-metadata", metadata), timestamp());
      const upsertTurn = this.db.prepare(`INSERT INTO interview_history_turns(turn_id,history_id,sequence,role_id,speaker_id,question_text,answer_text,followups_json,source_refs_json)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(turn_id) DO UPDATE SET
          role_id=excluded.role_id,speaker_id=excluded.speaker_id,question_text=excluded.question_text,answer_text=excluded.answer_text,
          followups_json=excluded.followups_json,source_refs_json=excluded.source_refs_json`);
      rows.forEach((turn, index) => upsertTurn.run(
        turn.turnId,
        session.id,
        index + 1,
        turn.roleId || "unknown",
        turn.speakerId || "unknown",
        pack(this.applicationKey, "saved-interview-turn", { value: turn.questionText || "" }),
        pack(this.applicationKey, "saved-interview-turn", { value: turn.answerText || "" }),
        pack(this.applicationKey, "saved-interview-turn", { value: turn.followUps || [] }),
        pack(this.applicationKey, "saved-interview-turn", { value: turn.sourceRefs || [] }),
      ));
      this.db.prepare(`INSERT INTO interview_reviews(history_id,review_json,model_id,prompt_version,created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(history_id) DO UPDATE SET review_json=excluded.review_json,model_id=excluded.model_id,prompt_version=excluded.prompt_version,created_at=excluded.created_at`)
        .run(session.id, pack(this.applicationKey, "saved-interview-review", session.review || {}), session.review?.modelId || null, session.review?.promptVersion || null, timestamp());
      this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
        .run(randomUUID(), "interview_history", session.id, "interview_history.saved", `history-saved:${session.id}`, JSON.stringify({ historyId: session.id, userId: session.ownerUserId }), timestamp(), timestamp());
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(userId) {
    return this.db.prepare(`SELECT history_id,profile_id,profile_version,admission_route,status,started_at,ended_at,retention_expires_at,session_json
      FROM interview_history WHERE user_id=? AND deleted_at IS NULL AND retention_expires_at>? ORDER BY ended_at DESC LIMIT 100`).all(userId, timestamp()).map((row) => {
      const metadata = unpack(this.applicationKey, "saved-interview-metadata", row.session_json);
      const { session_json, ...session } = row;
      return { ...session, cameraMetricsSummary: summarizeCameraMetrics(metadata.cameraMetrics) };
    });
  }

  get(userId, historyId) {
    const session = this.db.prepare(`SELECT history_id,profile_id,profile_version,admission_route,status,started_at,ended_at,retention_expires_at,session_json
      FROM interview_history WHERE user_id=? AND history_id=? AND deleted_at IS NULL AND retention_expires_at>?`).get(userId, historyId, timestamp());
    if (!session) return null;
    const turns = this.db.prepare(`SELECT turn_id,sequence,role_id,speaker_id,question_text,answer_text,followups_json,source_refs_json
      FROM interview_history_turns WHERE history_id=? ORDER BY sequence`).all(historyId).map((turn) => ({
      turnId: turn.turn_id,
      sequence: turn.sequence,
      roleId: turn.role_id,
      speakerId: turn.speaker_id,
      questionText: unpack(this.applicationKey, "saved-interview-turn", turn.question_text).value,
      answerText: unpack(this.applicationKey, "saved-interview-turn", turn.answer_text).value,
      followUps: unpack(this.applicationKey, "saved-interview-turn", turn.followups_json).value,
      sourceRefs: unpack(this.applicationKey, "saved-interview-turn", turn.source_refs_json).value,
    }));
    const review = this.db.prepare("SELECT review_json FROM interview_reviews WHERE history_id=?").get(historyId);
    const metadata = unpack(this.applicationKey, "saved-interview-metadata", session.session_json);
    return {
      historyId: session.history_id,
      profileId: session.profile_id,
      profileVersion: session.profile_version,
      admissionRoute: session.admission_route,
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      retentionExpiresAt: session.retention_expires_at,
      metadata,
      cameraMetricsSummary: summarizeCameraMetrics(metadata.cameraMetrics),
      turns,
      review: review ? unpack(this.applicationKey, "saved-interview-review", review.review_json) : null,
    };
  }

  delete(userId, historyId) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM consent_receipts WHERE user_id=? AND interview_session_id=?").run(userId, historyId);
      const result = this.db.prepare("DELETE FROM interview_history WHERE user_id=? AND history_id=?").run(userId, historyId);
      if (result.changes) this.db.prepare(`INSERT INTO security_audit_events(event_id,actor_user_id,actor_role,action_key,target_type,target_id,result_code,metadata_json,created_at)
        VALUES(?,?,'user','privacy.practice_history_deleted','interview_history',?,'ok','{}',?)`).run(randomUUID(), userId, historyId, timestamp());
      this.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  pruneExpired() {
    const now = timestamp();
    return this.db.prepare("DELETE FROM interview_history WHERE retention_expires_at <= ?").run(now).changes;
  }
}
