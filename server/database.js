import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const schemaVersion = 4;

export class AppDatabase {
  constructor(filePath) {
    this.connection = new DatabaseSync(filePath);
    this.connection.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA secure_delete = ON;
    `);
    this.#migrate();
    this.#seedConsentPolicies();
  }

  #migrate() {
    const currentVersion = this.connection.prepare("PRAGMA user_version").get().user_version;
    if (currentVersion > schemaVersion) throw new Error("DATABASE_SCHEMA_NEWER_THAN_APPLICATION");
    if (currentVersion === schemaVersion) return;

    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS interview_sessions (
          session_id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS interview_sessions_started_at_idx
          ON interview_sessions(started_at);
        CREATE INDEX IF NOT EXISTS interview_sessions_status_idx
          ON interview_sessions(status);

        CREATE TABLE IF NOT EXISTS user_reports (
          report_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL UNIQUE,
          review_status TEXT NOT NULL,
          school_id TEXT NOT NULL,
          department_id TEXT NOT NULL,
          academic_year INTEGER,
          admission_route TEXT,
          collected_at TEXT NOT NULL,
          payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
        ) STRICT;
        CREATE INDEX IF NOT EXISTS user_reports_source_scope_idx
          ON user_reports(school_id, department_id, academic_year, admission_route, review_status);
      `);
      if (currentVersion < 2) {
        this.connection.exec(`
          CREATE TABLE users (
            user_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_verification'
              CHECK (status IN ('pending_verification', 'active', 'pending_deletion', 'disabled', 'deleted')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            email_verified_at TEXT,
            deletion_requested_at TEXT,
            deleted_at TEXT
          ) STRICT;

          CREATE TABLE user_contacts (
            contact_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            contact_type TEXT NOT NULL CHECK (contact_type IN ('email')),
            encrypted_value TEXT NOT NULL,
            lookup_hmac TEXT NOT NULL,
            verified_at TEXT,
            created_at TEXT NOT NULL,
            retired_at TEXT,
            UNIQUE(contact_type, lookup_hmac)
          ) STRICT;
          CREATE INDEX user_contacts_user_idx ON user_contacts(user_id, retired_at);

          CREATE TABLE password_credentials (
            user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
            password_hash TEXT NOT NULL,
            hash_version TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            last_authenticated_at TEXT
          ) STRICT;

          CREATE TABLE user_roles (
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            role_key TEXT NOT NULL CHECK (role_key IN ('user', 'report_reviewer', 'privacy_operator', 'admin')),
            granted_by TEXT,
            granted_at TEXT NOT NULL,
            expires_at TEXT,
            revoked_at TEXT,
            grant_reason TEXT,
            PRIMARY KEY(user_id, role_key, granted_at)
          ) STRICT;
          CREATE INDEX user_roles_active_idx ON user_roles(user_id, revoked_at, expires_at);

          CREATE TABLE auth_sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            csrf_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            idle_expires_at TEXT NOT NULL,
            absolute_expires_at TEXT NOT NULL,
            mfa_verified_at TEXT,
            revoked_at TEXT,
            revoke_reason TEXT
          ) STRICT;
          CREATE INDEX auth_sessions_user_active_idx ON auth_sessions(user_id, revoked_at, idle_expires_at);

          CREATE TABLE auth_action_tokens (
            token_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            purpose TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset', 'deletion_cancel')),
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
          ) STRICT;
          CREATE INDEX auth_action_tokens_expiry_idx ON auth_action_tokens(expires_at, consumed_at);

          CREATE TABLE user_mfa (
            user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
            encrypted_secret TEXT NOT NULL,
            enabled_at TEXT,
            last_counter INTEGER NOT NULL DEFAULT 0
          ) STRICT;

          CREATE TABLE consent_policy_versions (
            policy_id TEXT PRIMARY KEY,
            purpose TEXT NOT NULL,
            version TEXT NOT NULL,
            locale TEXT NOT NULL DEFAULT 'zh-Hant',
            notice_text TEXT NOT NULL,
            notice_sha256 TEXT NOT NULL,
            effective_at TEXT NOT NULL,
            retired_at TEXT,
            UNIQUE(purpose, version, locale)
          ) STRICT;

          CREATE TABLE consent_receipts (
            receipt_id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            interview_session_id TEXT,
            report_id TEXT REFERENCES community_reports(report_id) ON DELETE CASCADE,
            revision_id TEXT REFERENCES report_revisions(revision_id) ON DELETE SET NULL,
            purpose TEXT NOT NULL,
            policy_version TEXT NOT NULL,
            notice_sha256 TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('granted', 'denied', 'withdrawn')),
            captured_at TEXT NOT NULL,
            withdrawn_at TEXT,
            CHECK (
              (purpose = 'share_experience' AND user_id IS NULL AND interview_session_id IS NULL AND report_id IS NOT NULL)
              OR (purpose <> 'share_experience' AND (user_id IS NOT NULL OR interview_session_id IS NOT NULL))
            )
          ) STRICT;
          CREATE INDEX consent_receipts_user_idx ON consent_receipts(user_id, purpose, captured_at);
          CREATE INDEX consent_receipts_report_idx ON consent_receipts(report_id, captured_at);

          CREATE TABLE interview_turns (
            turn_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            sequence INTEGER NOT NULL CHECK (sequence > 0),
            speaker_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            question_json TEXT NOT NULL CHECK (json_valid(question_json)),
            answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
            submitted_at TEXT,
            UNIQUE(session_id, sequence)
          ) STRICT;
          CREATE INDEX interview_turns_session_idx ON interview_turns(session_id, sequence);

          CREATE TABLE interview_history (
            history_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            profile_id TEXT NOT NULL,
            profile_version TEXT NOT NULL,
            admission_route TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            retention_expires_at TEXT NOT NULL,
            session_json TEXT NOT NULL CHECK (json_valid(session_json)),
            created_at TEXT NOT NULL,
            deleted_at TEXT
          ) STRICT;
          CREATE INDEX interview_history_user_recent_idx ON interview_history(user_id, ended_at DESC, deleted_at);
          CREATE INDEX interview_history_expiry_idx ON interview_history(retention_expires_at, deleted_at);

          CREATE TABLE interview_history_turns (
            turn_id TEXT PRIMARY KEY,
            history_id TEXT NOT NULL REFERENCES interview_history(history_id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL CHECK (sequence > 0),
            role_id TEXT NOT NULL,
            speaker_id TEXT NOT NULL,
            question_text TEXT NOT NULL,
            answer_text TEXT NOT NULL,
            followups_json TEXT NOT NULL CHECK (json_valid(followups_json)),
            source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
            UNIQUE(history_id, sequence)
          ) STRICT;
          CREATE INDEX interview_history_turns_idx ON interview_history_turns(history_id, sequence);

          CREATE TABLE interview_reviews (
            history_id TEXT PRIMARY KEY REFERENCES interview_history(history_id) ON DELETE CASCADE,
            review_json TEXT NOT NULL CHECK (json_valid(review_json)),
            model_id TEXT,
            prompt_version TEXT,
            created_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE community_reports (
            report_id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL UNIQUE,
            state TEXT NOT NULL CHECK (state IN ('pending', 'needs_changes', 'approved', 'rejected', 'withdrawn', 'expired')),
            school_id TEXT NOT NULL,
            department_id TEXT NOT NULL,
            academic_year INTEGER,
            admission_route TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            approved_at TEXT,
            expires_at TEXT,
            withdrawn_at TEXT,
            current_revision_id TEXT,
            legacy_import INTEGER NOT NULL DEFAULT 0 CHECK (legacy_import IN (0, 1))
          ) STRICT;
          CREATE INDEX community_reports_scope_idx ON community_reports(school_id, department_id, academic_year, admission_route, state);
          CREATE INDEX community_reports_expiry_idx ON community_reports(expires_at, state);

          CREATE TABLE report_revisions (
            revision_id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES community_reports(report_id) ON DELETE CASCADE,
            revision_no INTEGER NOT NULL CHECK (revision_no > 0),
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            topics_json TEXT NOT NULL CHECK (json_valid(topics_json)),
            payload_hash TEXT NOT NULL,
            source_json TEXT NOT NULL CHECK (json_valid(source_json)),
            pii_scan_version TEXT NOT NULL,
            pii_scan_json TEXT NOT NULL CHECK (json_valid(pii_scan_json)),
            created_at TEXT NOT NULL,
            change_reason TEXT,
            superseded_at TEXT,
            UNIQUE(report_id, revision_no)
          ) STRICT;
          CREATE INDEX report_revisions_current_idx ON report_revisions(report_id, revision_no DESC);

          CREATE TABLE report_withdrawal_credentials (
            report_id TEXT PRIMARY KEY REFERENCES community_reports(report_id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            hash_version TEXT NOT NULL DEFAULT 'hmac-v1',
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT
          ) STRICT;

          CREATE TABLE report_moderation_events (
            event_id TEXT PRIMARY KEY,
            report_id TEXT NOT NULL REFERENCES community_reports(report_id) ON DELETE CASCADE,
            revision_id TEXT REFERENCES report_revisions(revision_id) ON DELETE SET NULL,
            actor_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            reason_code TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            from_state TEXT,
            to_state TEXT
          ) STRICT;
          CREATE INDEX report_moderation_report_idx ON report_moderation_events(report_id, created_at);

          CREATE TABLE knowledge_sources (
            source_id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            claim_type TEXT NOT NULL,
            school_id TEXT,
            department_id TEXT,
            academic_year INTEGER,
            admission_route TEXT,
            state TEXT NOT NULL CHECK (state IN ('approved', 'disabled', 'pending')),
            revision_id TEXT REFERENCES report_revisions(revision_id) ON DELETE SET NULL,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            updated_at TEXT NOT NULL
          ) STRICT;
          CREATE INDEX knowledge_sources_scope_idx ON knowledge_sources(school_id, department_id, academic_year, admission_route, state);

          CREATE TABLE privacy_requests (
            request_id TEXT PRIMARY KEY,
            user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            request_type TEXT NOT NULL CHECK (request_type IN ('access', 'export', 'correction', 'deletion', 'stop_processing')),
            state TEXT NOT NULL,
            created_at TEXT NOT NULL,
            due_at TEXT,
            completed_at TEXT,
            operator_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            note TEXT
          ) STRICT;
          CREATE INDEX privacy_requests_user_idx ON privacy_requests(user_id, created_at DESC);

          CREATE TABLE security_audit_events (
            event_id TEXT PRIMARY KEY,
            actor_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
            actor_role TEXT,
            action_key TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            result_code TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
            created_at TEXT NOT NULL
          ) STRICT;
          CREATE INDEX security_audit_created_idx ON security_audit_events(created_at);
          CREATE INDEX security_audit_target_idx ON security_audit_events(target_type, target_id, created_at);

          CREATE TABLE integration_outbox (
            outbox_id TEXT PRIMARY KEY,
            aggregate_type TEXT NOT NULL,
            aggregate_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
            created_at TEXT NOT NULL,
            available_at TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
            processed_at TEXT,
            last_error_code TEXT
          ) STRICT;
          CREATE INDEX integration_outbox_pending_idx ON integration_outbox(available_at, processed_at);

          ALTER TABLE interview_sessions ADD COLUMN owner_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE;
          ALTER TABLE interview_sessions ADD COLUMN guest_owner_hash TEXT;
          CREATE INDEX interview_sessions_owner_idx ON interview_sessions(owner_user_id, started_at);
          CREATE INDEX interview_sessions_guest_idx ON interview_sessions(guest_owner_hash, started_at);

          INSERT OR IGNORE INTO consent_policy_versions(policy_id, purpose, version, locale, notice_text, notice_sha256, effective_at)
          VALUES ('share-experience-v1', 'share_experience', 'share-report-v1', 'zh-Hant',
            '分享心得僅用於審核後的面試經驗檢索。提交前請移除本人及第三人的識別資訊；分享內容不會連結帳號或練習場次，核准前不會供檢索，且可用一次性撤回碼撤回。',
            'legacy-v1', datetime('now'));
        `);
      }
      if (currentVersion < 3) {
        this.connection.exec(`
          CREATE TABLE user_mfa_recovery_codes (
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            code_hash TEXT NOT NULL UNIQUE,
            hash_version TEXT NOT NULL DEFAULT 'hmac-v1',
            created_at TEXT NOT NULL,
            used_at TEXT,
            PRIMARY KEY(user_id, code_hash)
          ) STRICT;
          CREATE INDEX user_mfa_recovery_active_idx ON user_mfa_recovery_codes(user_id, used_at);
        `);
      }
      if (currentVersion < 4) {
        // Sign in with Google: only a keyed hash of Google's `sub` is stored.
        this.connection.exec(`
          CREATE TABLE federated_identities (
            provider TEXT NOT NULL CHECK (provider IN ('google')),
            subject_hmac TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            last_authenticated_at TEXT,
            PRIMARY KEY(provider, subject_hmac)
          ) STRICT;
          CREATE INDEX federated_identities_user_idx ON federated_identities(user_id);
        `);
      }
      this.connection.exec("PRAGMA user_version = " + schemaVersion);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  #seedConsentPolicies() {
    const policies = [
      ["share-experience-v1", "share_experience", "share-report-v1", "分享心得僅用於審核後的面試經驗檢索。提交前請移除本人及第三人的識別資訊；分享內容不會連結帳號或練習場次，核准前不會供檢索，且可用一次性撤回碼撤回。"],
      ["save-history-v1", "save_history", "save-history-v1", "我同意將本場練習回答與復盤保存於我的帳號，供我跨裝置查看；可自行匯出或刪除。這不代表同意分享給其他使用者。"],
      ["model-processing-v1", "external_model", "model-processing-v1", "本場逐字稿與必要情境會送至設定的外部模型服務處理；不會因此公開或加入共用心得資料。"],
      ["speech-processing-v1", "speech_processing", "speech-processing-v1", "本場錄音會送至設定的語音服務進行辨識；未選擇語音時仍可使用文字回答。"],
      ["speech-processing-v2", "speech_processing", "speech-processing-v2", "本場錄音依所選語音設定進行辨識；本機語音只在本機處理，雲端語音會傳送錄音給服務供應商。未選擇語音時仍可使用文字回答。"],
      ["speech-processing-v3", "speech_processing", "speech-processing-v3", "本場回答語音由瀏覽器串流辨識：瀏覽器會把麥克風音訊即時送至 Google 語音服務轉成文字，面試後端只收到辨識文字；串流辨識無法使用時，改將錄音送至面試後端依所選語音設定辨識。教授語音依所選設定合成。未選擇語音時仍可使用文字回答。"],
      ["speech-processing-v4", "speech_processing", "speech-processing-v4", "本場暖身對談使用 Gemini Live 即時對談：麥克風音訊會持續經面試後端即時送至 Google Gemini Live API，由它理解回答並直接產生教授語音；教授指示包含校系情境與你確認的備審主張，雙方逐字稿會寫入本場紀錄供復盤。使用 Gemini API 免費層時，Google 會使用送出的內容（含語音與逐字稿）改進其產品，並可能由人工審閱。即時對談無法使用、額度用完或中途斷線時，改用回合制（瀏覽器串流辨識或面試後端辨識，教授語音依所選設定合成）。未選擇語音時仍可使用文字回答。"],
      ["camera-metrics-processing-v1", "camera_metrics_processing", "camera-metrics-processing-v1", "只將本機從攝影機影格計算出的逐題摘要數值交給本場 Agent 復盤；不傳送或保存原始畫面、逐影格資料或臉部特徵。若另選保存個人歷史，摘要數值會加密保存至私人練習紀錄，並可隨該筆紀錄刪除。"],
    ];
    const insert = this.connection.prepare(`INSERT OR IGNORE INTO consent_policy_versions(policy_id,purpose,version,locale,notice_text,notice_sha256,effective_at)
      VALUES(?,?,?,'zh-Hant',?,?,?)`);
    const updateLegacy = this.connection.prepare("UPDATE consent_policy_versions SET notice_text=?,notice_sha256=? WHERE purpose=? AND version=? AND notice_sha256='legacy-v1'");
    for (const [id, purpose, version, text] of policies) {
      const hash = createHash("sha256").update(text).digest("hex");
      insert.run(id, purpose, version, text, hash, new Date().toISOString());
      updateLegacy.run(text, hash, purpose, version);
    }
  }

  close() {
    this.connection.close();
  }
}
