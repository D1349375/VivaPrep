import { decryptText, encryptText } from "./crypto-utils.js";

function serializeSession(session) {
  const payload = {};
  for (const [key, value] of Object.entries(session)) {
    if (key === "audioBySequence" || key === "processingPromise" || key === "transcribingTurnId" || key === "guestOwnerHash") continue;
    payload[key] = key === "nudgeUsedForTurn" && value instanceof Set ? [...value] : value;
  }
  payload.events = (session.events || [])
    .filter((event) => event.type !== "interview.audio.ready")
    .map(({ audioUrl, ...event }) => event);
  if (payload.currentEvent) {
    const { audioUrl, ...currentEvent } = payload.currentEvent;
    payload.currentEvent = currentEvent;
  }
  return JSON.stringify(payload);
}

function restoreSession(payloadJson, applicationKey) {
  let stored = JSON.parse(payloadJson);
  if (stored && typeof stored === "object" && typeof stored.encryptedPayload === "string") {
    stored = JSON.parse(decryptText(applicationKey, "interview-session", stored.encryptedPayload));
  }
  // Earlier versions encoded the already serialized payload a second time.
  if (typeof stored === "string") stored = JSON.parse(stored);
  const session = stored;
  session.audioBySequence = new Map();
  session.nudgeUsedForTurn = new Set(session.nudgeUsedForTurn || []);
  session.processingPromise = null;
  session.transcribingTurnId = null;
  return session;
}

export class SessionStore {
  #sessions = new Map();
  #listeners = new Map();
  #database;
  #sessionTtlMs;
  #upsert;
  #remove;
  #findAll;
  #applicationKey;
  #upsertTurn;

  constructor({ database, sessionTtlMs, applicationKey }) {
    this.#database = database;
    this.#sessionTtlMs = sessionTtlMs;
    this.#applicationKey = applicationKey;
    this.#upsert = database.connection.prepare(`
      INSERT INTO interview_sessions(session_id, started_at, updated_at, status, payload_json, owner_user_id, guest_owner_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        status = excluded.status,
        payload_json = excluded.payload_json,
        owner_user_id = excluded.owner_user_id,
        guest_owner_hash = excluded.guest_owner_hash
    `);
    this.#remove = database.connection.prepare("DELETE FROM interview_sessions WHERE session_id = ?");
    this.#findAll = database.connection.prepare("SELECT session_id, started_at, payload_json, owner_user_id, guest_owner_hash FROM interview_sessions ORDER BY started_at");
    this.#upsertTurn = database.connection.prepare(`
      INSERT INTO interview_turns(turn_id,session_id,sequence,speaker_id,role_id,question_json,answer_json,submitted_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(turn_id) DO UPDATE SET
        sequence=excluded.sequence,speaker_id=excluded.speaker_id,role_id=excluded.role_id,
        question_json=excluded.question_json,answer_json=excluded.answer_json,submitted_at=excluded.submitted_at
    `);
    this.#restorePersistedSessions();
  }

  #restorePersistedSessions() {
    const cutoff = new Date(Date.now() - this.#sessionTtlMs).toISOString();
    this.#database.connection.prepare("DELETE FROM interview_sessions WHERE started_at < ?").run(cutoff);
    for (const row of this.#findAll.all()) {
      try {
        const session = restoreSession(row.payload_json, this.#applicationKey);
        session.ownerUserId = row.owner_user_id || null;
        session.guestOwnerHash = row.guest_owner_hash || null;
        if (session.id !== row.session_id || Date.parse(session.startedAt) < Date.now() - this.#sessionTtlMs) {
          this.#remove.run(row.session_id);
          continue;
        }
        this.#sessions.set(session.id, session);
      } catch {
        this.#remove.run(row.session_id);
      }
    }
    this.#cleanOrphans();
  }

  #cleanOrphans() {
    this.#database.connection.exec(`
      DELETE FROM interview_turns WHERE session_id NOT IN (SELECT session_id FROM interview_sessions);
      DELETE FROM consent_receipts
        WHERE interview_session_id IS NOT NULL
          AND interview_session_id NOT IN (SELECT session_id FROM interview_sessions)
          AND interview_session_id NOT IN (SELECT history_id FROM interview_history);
    `);
  }

  create(session) {
    if (this.#sessions.has(session.id)) throw new Error("SESSION_EXISTS");
    this.#sessions.set(session.id, session);
    this.save(session);
    return session;
  }

  save(session) {
    const serialized = serializeSession(session);
    const encryptedPayload = JSON.stringify({ encryptedPayload: encryptText(this.#applicationKey, "interview-session", serialized) });
    this.#upsert.run(
      session.id,
      session.startedAt,
      new Date().toISOString(),
      session.status,
      encryptedPayload,
      session.ownerUserId || null,
      session.guestOwnerHash || null,
    );
    for (const [sequence, turn] of (session.turns || []).entries()) {
      this.#upsertTurn.run(
        turn.turnId,
        session.id,
        sequence + 1,
        turn.speakerId || "unknown",
        turn.roleId || "unknown",
        JSON.stringify({ encrypted: encryptText(this.#applicationKey, "interview-turn", JSON.stringify({ questionText: turn.questionText || "", followUps: turn.followUps || [] })) }),
        JSON.stringify({ encrypted: encryptText(this.#applicationKey, "interview-turn", JSON.stringify({ answerText: turn.answerText || "" })) }),
        turn.submittedAt || null,
      );
    }
    return session;
  }

  get(sessionId) {
    return this.#sessions.get(sessionId) || null;
  }

  list() {
    return [...this.#sessions.values()];
  }

  delete(sessionId) {
    const session = this.#sessions.get(sessionId);
    for (const audio of session?.audioBySequence?.values?.() || []) audio.buffer?.fill?.(0);
    this.#database.connection.prepare("DELETE FROM interview_turns WHERE session_id = ?").run(sessionId);
    if (session?.retentionMode !== "saved") {
      this.#database.connection.prepare("DELETE FROM consent_receipts WHERE interview_session_id = ?").run(sessionId);
    }
    this.#remove.run(sessionId);
    const existed = this.#sessions.delete(sessionId);
    this.#listeners.delete(sessionId);
    return existed;
  }

  pruneExpired(maxAgeMs = this.#sessionTtlMs) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [sessionId, session] of this.#sessions) {
      if (Date.parse(session.startedAt) < cutoff) {
        this.delete(sessionId);
        removed += 1;
      }
    }
    this.#database.connection.prepare("DELETE FROM interview_sessions WHERE started_at < ?").run(new Date(cutoff).toISOString());
    this.#cleanOrphans();
    return removed;
  }

  emit(sessionId, event) {
    const session = this.get(sessionId);
    if (!session) return;
    session.eventSequence += 1;
    const savedEvent = { ...event, sessionId, seq: session.eventSequence, createdAt: new Date().toISOString() };
    session.events.push(savedEvent);
    if (session.events.length > 300) session.events.splice(0, session.events.length - 300);
    this.save(session);
    for (const listener of this.#listeners.get(sessionId) || []) listener(savedEvent);
    return savedEvent;
  }

  replayAfter(sessionId, sequence = 0) {
    const session = this.get(sessionId);
    if (!session) return [];
    return session.events.filter((event) => event.seq > sequence);
  }

  subscribe(sessionId, listener) {
    const listeners = this.#listeners.get(sessionId) || new Set();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(sessionId);
    };
  }
}
