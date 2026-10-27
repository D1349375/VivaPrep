import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { keyedHash } from "./crypto-utils.js";

function nowIso() { return new Date().toISOString(); }
function parseJson(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }
function safeScopeId(value) { return /^[A-Za-z0-9_-]{1,80}$/.test(String(value || "")) ? String(value) : "unknown"; }
function tokenEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function inspectAndMask(text) {
  const findings = [];
  let summary = String(text || "");
  const rules = [
    { type: "email", severity: "high", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
    { type: "phone", severity: "high", pattern: /(?:\+?886[- ]?)?0?9\d{2}[- ]?\d{3}[- ]?\d{3}|(?:\(0\d{1,2}\)[- ]?)?\d{6,8}/g },
    { type: "national_id_like", severity: "high", pattern: /\b[A-Z][12]\d{8}\b/gi },
    { type: "url_or_social_handle", severity: "high", pattern: /(?:https?:\/\/|www\.)\S+|@[A-Za-z0-9_]{2,}/gi },
    { type: "student_or_candidate_id", severity: "high", pattern: /(?:學號|考生(?:編號|號碼)?|准考證(?:號)?|身分證(?:字號)?)[\s：:#-]*[A-Za-z0-9-]{4,}/gi },
    { type: "full_date", severity: "medium", pattern: /(?:民國\s*)?\d{2,4}[年./-]\d{1,2}[月./-]\d{1,2}日?/g },
  ];
  for (const rule of rules) {
    if (rule.type === "full_date") continue;
    const original = summary;
    const matches = [...original.matchAll(rule.pattern)];
    if (!matches.length) continue;
    findings.push(...matches.slice(0, 8).map((match) => ({ type: rule.type, severity: rule.severity, value: match[0] })));
    summary = original.replace(rule.pattern, `【已遮蔽${rule.type === "email" ? "電子郵件" : rule.type === "phone" ? "電話" : rule.type === "national_id_like" ? "識別碼" : rule.type === "url_or_social_handle" ? "連結或帳號" : "考生編號"}】`);
  }
  for (const match of summary.matchAll(rules.at(-1).pattern)) findings.push({ type: "full_date", severity: "medium", value: match[0] });
  if (findings.some((item) => item.type === "full_date")) summary = summary.replace(rules.at(-1).pattern, "【已移除精確日期】");
  return { summary, findings };
}

export class ReportRepository {
  constructor(database, applicationKey) {
    this.database = database;
    this.db = database.connection;
    this.applicationKey = applicationKey;
    this.#holdLegacyReports();
  }

  #holdLegacyReports() {
    const rows = this.db.prepare(`SELECT r.report_id,r.state,r.current_revision_id,r.legacy_import,v.source_json
      FROM community_reports r JOIN report_revisions v ON v.revision_id=r.current_revision_id
      WHERE r.legacy_import=1`).all();
    if (!rows.length) return;
    this.#transaction(() => {
      for (const row of rows) {
        const source = parseJson(row.source_json);
        const withdrawn = row.state === "withdrawn";
        const titleScan = withdrawn ? { summary: "已撤回的匿名心得", findings: [] } : inspectAndMask(String(source.title || "匿名面試心得").slice(0, 120));
        const title = titleScan.summary;
        const summaryScan = withdrawn ? { summary: "", findings: [] } : inspectAndMask(String(source.summary || source.excerpt || "").slice(0, 2500));
        const topicScans = withdrawn ? [] : (Array.isArray(source.topics) ? source.topics : []).slice(0, 12).map((item) => inspectAndMask(String(item).slice(0, 60)));
        const formatScan = inspectAndMask(String(source.format || "unknown").slice(0, 40));
        const findings = [...titleScan.findings, ...summaryScan.findings, ...topicScans.flatMap((item) => item.findings), ...formatScan.findings];
        const status = withdrawn ? "withdrawn" : row.state === "rejected" ? "rejected" : "pending";
        const safeSource = {
          reportId: row.report_id,
          sourceId: "legacy-" + createHash("sha256").update(row.report_id).digest("hex"),
          sourceType: "first_person_report",
          claimType: "reported_experience",
          schoolId: safeScopeId(source.schoolId),
          departmentId: safeScopeId(source.departmentId),
          academicYear: Number.isInteger(source.academicYear) ? source.academicYear : null,
          admissionRoute: safeScopeId(source.admissionRoute),
          format: formatScan.summary,
          title,
          summary: summaryScan.summary,
          excerpt: summaryScan.summary,
          topics: topicScans.map((item) => item.summary),
          stage: "interview",
          isFirstHand: true,
          reportCount: 1,
          confidence: "low",
          reviewStatus: status,
          consentStatus: source.consentStatus || "legacy_unverified",
          deidentificationStatus: "legacy_review_required",
          anonymized: false,
          collectedAt: source.collectedAt || nowIso(),
          publishedAt: null,
          url: null,
          moderation: null,
        };
        const timestamp = nowIso();
        this.db.prepare(`UPDATE report_revisions SET title=?,summary=?,topics_json=?,payload_hash=?,source_json=?,pii_scan_version='legacy-import-rules-v2',pii_scan_json=? WHERE revision_id=?`)
          .run(title, safeSource.summary, JSON.stringify(safeSource.topics), createHash("sha256").update(JSON.stringify(safeSource)).digest("hex"), JSON.stringify(safeSource), JSON.stringify({ findings: findings.map(({ type, severity }) => ({ type, severity })) }), row.current_revision_id);
        if (status === "pending") {
          this.db.prepare("UPDATE community_reports SET source_id=?,state='pending',updated_at=?,approved_at=NULL,expires_at=COALESCE(expires_at,?) WHERE report_id=?")
            .run(safeSource.sourceId, timestamp, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), row.report_id);
          this.db.prepare("UPDATE knowledge_sources SET source_id=?,state='disabled',payload_json=?,updated_at=? WHERE revision_id=?")
            .run(safeSource.sourceId, JSON.stringify({ sourceId: safeSource.sourceId, reviewStatus: "pending" }), timestamp, row.current_revision_id);
          const existing = this.db.prepare("SELECT 1 FROM report_moderation_events WHERE report_id=? AND action='legacy_import_hold'").get(row.report_id);
          if (!existing) this.db.prepare(`INSERT INTO report_moderation_events(event_id,report_id,revision_id,action,reason_code,created_at,from_state,to_state)
            VALUES(?,?,?,'legacy_import_hold','current_consent_and_manual_review_required',?,'approved','pending')`).run(randomUUID(), row.report_id, row.current_revision_id, timestamp);
        } else if (status === "withdrawn") {
          this.db.prepare("UPDATE community_reports SET source_id=?,expires_at=COALESCE(expires_at,?) WHERE report_id=?")
            .run(safeSource.sourceId, timestamp, row.report_id);
          this.db.prepare("UPDATE knowledge_sources SET source_id=?,state='disabled',payload_json=?,updated_at=? WHERE revision_id=?")
            .run(safeSource.sourceId, JSON.stringify({ sourceId: safeSource.sourceId, reviewStatus: "withdrawn" }), timestamp, row.current_revision_id);
        } else {
          this.db.prepare("UPDATE community_reports SET source_id=?,expires_at=COALESCE(expires_at,?) WHERE report_id=?")
            .run(safeSource.sourceId, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), row.report_id);
          this.db.prepare("UPDATE knowledge_sources SET state='disabled',payload_json=?,updated_at=? WHERE revision_id=?")
            .run(JSON.stringify({ sourceId: safeSource.sourceId, reviewStatus: status }), timestamp, row.current_revision_id);
        }
      }
    });
  }

  #transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  expireReports() {
    const expired = this.db.prepare(`SELECT report_id,source_id FROM community_reports
      WHERE state NOT IN ('withdrawn','expired') AND expires_at IS NOT NULL AND expires_at<=?`).all(nowIso());
    if (!expired.length) return 0;
    this.#transaction(() => {
      const timestamp = nowIso();
      for (const report of expired) {
        const tombstone = JSON.stringify({ sourceId: report.source_id, reviewStatus: "expired" });
        this.db.prepare("UPDATE community_reports SET state='expired',updated_at=?,approved_at=NULL WHERE report_id=?").run(timestamp, report.report_id);
        this.db.prepare(`UPDATE report_revisions SET title='已到期的匿名心得',summary='',topics_json='[]',source_json=?,change_reason='retention_expired',superseded_at=COALESCE(superseded_at,?) WHERE report_id=?`)
          .run(tombstone, timestamp, report.report_id);
        this.db.prepare("UPDATE knowledge_sources SET state='disabled',payload_json=?,updated_at=? WHERE revision_id IN (SELECT revision_id FROM report_revisions WHERE report_id=?)")
          .run(tombstone, timestamp, report.report_id);
        this.db.prepare("DELETE FROM report_withdrawal_credentials WHERE report_id=?").run(report.report_id);
        this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`)
          .run(randomUUID(), "report", report.report_id, "report.expired", `report-expired:${report.report_id}`, JSON.stringify({ reportId: report.report_id }), timestamp, timestamp);
      }
    });
    return expired.length;
  }

  sharePolicy() {
    return this.db.prepare(`SELECT purpose,version,locale,notice_text AS noticeText,notice_sha256 AS noticeHash
      FROM consent_policy_versions WHERE purpose='share_experience' AND retired_at IS NULL ORDER BY effective_at DESC LIMIT 1`).get() || null;
  }

  preview(input) {
    const summary = String(input.summary || "").trim();
    if ([...summary].length < 20 || [...summary].length > 2500) {
      throw Object.assign(new Error("心得摘要需介於 20 到 2500 個字元。"), { code: "INVALID_REPORT", status: 400 });
    }
    const required = [input.schoolId, input.departmentId, input.admissionRoute];
    if (required.some((value) => !/^[A-Za-z0-9_-]{1,80}$/.test(String(value || "")))) {
      throw Object.assign(new Error("校系或招生管道資料格式不正確。"), { code: "INVALID_REPORT_SCOPE", status: 400 });
    }
    const academicYear = Number(input.academicYear);
    if (!Number.isInteger(academicYear) || academicYear < 100 || academicYear > 200) {
      throw Object.assign(new Error("請選擇有效學年度。"), { code: "INVALID_REPORT_YEAR", status: 400 });
    }
    const titleScan = inspectAndMask(String(input.title || "使用者自願回報的面試經驗").trim().slice(0, 120));
    const scanned = inspectAndMask(summary);
    const topicScans = Array.isArray(input.topics)
      ? [...new Set(input.topics.map((item) => String(item).trim().slice(0, 60)).filter(Boolean))].slice(0, 12).map(inspectAndMask)
      : [];
    const formatScan = inspectAndMask(String(input.format || "unknown").slice(0, 40));
    const topics = topicScans.map((item) => item.summary);
    const findings = [...titleScan.findings, ...scanned.findings, ...topicScans.flatMap((item) => item.findings), ...formatScan.findings];
    const sanitized = {
      schoolId: String(input.schoolId),
      departmentId: String(input.departmentId),
      academicYear,
      admissionRoute: String(input.admissionRoute),
      format: formatScan.summary,
      title: titleScan.summary,
      topics,
      summary: scanned.summary,
    };
    const previewHash = createHash("sha256").update(JSON.stringify(sanitized)).digest("hex");
    return { sanitized, findings, previewHash, policy: this.sharePolicy() };
  }

  async create(input) {
    const preview = this.preview(input);
    if (!input.consentToShare || !input.confirmNoIdentifiers || input.previewHash !== preview.previewHash) {
      throw Object.assign(new Error("請先確認分享內容預覽與獨立分享同意，再重新送出。"), { code: "SHARING_CONSENT_OR_PREVIEW_REQUIRED", status: 400 });
    }
    const policy = this.sharePolicy();
    if (!policy || input.consentVersion !== policy.version) {
      throw Object.assign(new Error("分享說明已更新，請重新閱讀並確認後再送出。"), { code: "CONSENT_VERSION_OUTDATED", status: 409 });
    }
    const withdrawalToken = randomBytes(32).toString("base64url");
    const reportId = randomUUID();
    const revisionId = randomUUID();
    const sourceId = "report-" + randomUUID();
    const timestamp = nowIso();
    const source = {
      reportId,
      sourceId,
      sourceType: "first_person_report",
      claimType: "reported_experience",
      ...preview.sanitized,
      stage: "interview",
      title: preview.sanitized.title || "使用者自願回報的面試經驗",
      excerpt: preview.sanitized.summary,
      isFirstHand: true,
      reportCount: 1,
      confidence: "low",
      reviewStatus: "pending",
      consentStatus: "opted_in",
      deidentificationStatus: preview.findings.length ? "masked_and_user_confirmed" : "user_confirmed_pending_review",
      anonymized: false,
      collectedAt: timestamp,
      publishedAt: null,
      url: null,
      moderation: null,
    };
    const payloadHash = createHash("sha256").update(JSON.stringify(source)).digest("hex");
    this.#transaction(() => {
      this.db.prepare(`INSERT INTO community_reports(report_id,source_id,state,school_id,department_id,academic_year,admission_route,created_at,updated_at,expires_at,current_revision_id)
        VALUES(?,?,'pending',?,?,?,?,?,?,?,?)`).run(reportId, sourceId, source.schoolId, source.departmentId, source.academicYear, source.admissionRoute, timestamp, timestamp, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), revisionId);
      this.db.prepare(`INSERT INTO report_revisions(revision_id,report_id,revision_no,title,summary,topics_json,payload_hash,source_json,pii_scan_version,pii_scan_json,created_at)
        VALUES(?,?,1,?,?,?,?,?,'rules-v1',?,?)`).run(revisionId, reportId, source.title, source.summary, JSON.stringify(source.topics), payloadHash, JSON.stringify(source), JSON.stringify({ findings: preview.findings.map(({ type, severity }) => ({ type, severity })) }), timestamp);
      this.db.prepare(`INSERT INTO consent_receipts(receipt_id,report_id,revision_id,purpose,policy_version,notice_sha256,action,captured_at)
        VALUES(?,?,?,'share_experience',?,?,'granted',?)`).run(randomUUID(), reportId, revisionId, policy.version, policy.noticeHash, timestamp);
      this.db.prepare(`INSERT INTO report_withdrawal_credentials(report_id,token_hash,hash_version,created_at,expires_at)
        VALUES(?,?,'hmac-v1',?,?)`).run(reportId, keyedHash(this.applicationKey, "report-withdrawal", withdrawalToken), timestamp, new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString());
      this.db.prepare(`INSERT INTO report_moderation_events(event_id,report_id,revision_id,action,reason_code,created_at,from_state,to_state)
        VALUES(?,?,?,'submitted','user_opt_in',?,'draft','pending')`).run(randomUUID(), reportId, revisionId, timestamp);
      this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), "report", reportId, "report.submitted", `report-submitted:${reportId}`, JSON.stringify({ reportId, revisionId }), timestamp, timestamp);
    });
    return { ...source, withdrawalToken, reportId, state: "pending", previewFindings: preview.findings };
  }

  async importLegacyDatabase() {
    const rows = this.db.prepare("SELECT report_id,source_id,review_status,payload_json FROM user_reports").all();
    return this.#importLegacyRecords(rows.map((row) => ({ reportId: row.report_id, sourceId: row.source_id, reviewStatus: row.review_status, ...parseJson(row.payload_json) })));
  }

  async importLegacyJson(filePath) {
    let content;
    try { content = await readFile(filePath, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") return 0; throw error; }
    let records;
    try { records = JSON.parse(content); } catch { throw new Error("LEGACY_REPORT_STORE_INVALID"); }
    if (!Array.isArray(records)) throw new Error("LEGACY_REPORT_STORE_INVALID");
    return this.#importLegacyRecords(records);
  }

  #importLegacyRecords(records) {
    const policy = this.sharePolicy();
    if (!policy) return 0;
    return this.#transaction(() => {
      let imported = 0;
      for (const legacy of records) {
        if (!legacy?.reportId || !legacy?.sourceId || !legacy?.schoolId || !legacy?.departmentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(legacy.reportId))) continue;
        if (this.db.prepare("SELECT 1 FROM community_reports WHERE report_id=?").get(String(legacy.reportId))) continue;
        const parsedCollectedAt = Date.parse(legacy.collectedAt || "");
        const timestamp = Number.isFinite(parsedCollectedAt) ? new Date(parsedCollectedAt).toISOString() : nowIso();
        const oldState = legacy.reviewStatus || "pending";
        const wasWithdrawn = oldState === "withdrawn" || legacy.consentStatus === "withdrawn";
        const state = wasWithdrawn ? "withdrawn" : oldState === "rejected" ? "rejected" : "pending";
        const revisionId = randomUUID();
        const summaryScan = inspectAndMask(String(legacy.summary || legacy.excerpt || "").slice(0, 2500));
        const titleScan = inspectAndMask(String(legacy.title || "使用者自願回報的面試經驗").slice(0, 120));
        const topics = (Array.isArray(legacy.topics) ? legacy.topics : []).slice(0, 12).map((topic) => inspectAndMask(String(topic).slice(0, 60)));
        const formatScan = inspectAndMask(String(legacy.format || "unknown").slice(0, 40));
        const legacyFindings = [...summaryScan.findings, ...titleScan.findings, ...topics.flatMap((item) => item.findings), ...formatScan.findings];
        const reportId = String(legacy.reportId);
        const sourceId = "legacy-" + createHash("sha256").update(reportId).digest("hex");
        const source = {
          reportId,
          sourceId,
          sourceType: "first_person_report",
          claimType: "reported_experience",
          schoolId: safeScopeId(legacy.schoolId),
          departmentId: safeScopeId(legacy.departmentId),
          academicYear: Number.isInteger(legacy.academicYear) ? legacy.academicYear : null,
          admissionRoute: safeScopeId(legacy.admissionRoute),
          format: formatScan.summary,
          title: state === "withdrawn" ? "已撤回的匿名心得" : titleScan.summary,
          summary: state === "withdrawn" ? "" : summaryScan.summary,
          excerpt: state === "withdrawn" ? "" : summaryScan.summary,
          topics: state === "withdrawn" ? [] : topics.map((item) => item.summary),
          reviewStatus: state,
          deidentificationStatus: "legacy_review_required",
          anonymized: false,
          stage: "interview",
          isFirstHand: true,
          reportCount: 1,
          confidence: "low",
          collectedAt: timestamp,
          publishedAt: null,
          url: null,
          moderation: null,
        };
        this.db.prepare(`INSERT INTO community_reports(report_id,source_id,state,school_id,department_id,academic_year,admission_route,created_at,updated_at,expires_at,approved_at,withdrawn_at,current_revision_id,legacy_import)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(reportId, sourceId, state, safeScopeId(legacy.schoolId), safeScopeId(legacy.departmentId), Number.isInteger(legacy.academicYear) ? legacy.academicYear : null, safeScopeId(legacy.admissionRoute), timestamp, timestamp, new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), null, state === "withdrawn" ? (Number.isFinite(Date.parse(legacy.withdrawnAt || "")) ? new Date(legacy.withdrawnAt).toISOString() : timestamp) : null, revisionId);
        this.db.prepare(`INSERT INTO report_revisions(revision_id,report_id,revision_no,title,summary,topics_json,payload_hash,source_json,pii_scan_version,pii_scan_json,created_at)
          VALUES(?,?,1,?,?,?,?,?,'legacy-import-rules-v1',?,?)`).run(revisionId, reportId, String(source.title || "使用者自願回報的面試經驗").slice(0, 120), source.summary, JSON.stringify(source.topics), createHash("sha256").update(JSON.stringify(source)).digest("hex"), JSON.stringify(source), JSON.stringify({ findings: legacyFindings.map(({ type, severity }) => ({ type, severity })) }), timestamp);
        if (legacy.consentStatus === "opted_in" || legacy.consentVersion) {
          this.db.prepare(`INSERT INTO consent_receipts(receipt_id,report_id,revision_id,purpose,policy_version,notice_sha256,action,captured_at,withdrawn_at)
            VALUES(?,?,?,'share_experience',?,? ,?,?,?)`).run(randomUUID(), reportId, revisionId, legacy.consentVersion || "legacy-unversioned", legacy.consentVersion ? "legacy-import" : "legacy-import-no-notice-hash", legacy.consentStatus === "withdrawn" ? "withdrawn" : "granted", Number.isFinite(Date.parse(legacy.consentedAt || "")) ? new Date(legacy.consentedAt).toISOString() : timestamp, Number.isFinite(Date.parse(legacy.withdrawnAt || "")) ? new Date(legacy.withdrawnAt).toISOString() : null);
        }
        if (/^[0-9a-f]{64}$/i.test(String(legacy.withdrawalTokenHash || "")) && state !== "withdrawn") {
          this.db.prepare(`INSERT INTO report_withdrawal_credentials(report_id,token_hash,hash_version,created_at,expires_at)
            VALUES(?,?,'sha256-legacy',?,?)`).run(reportId, String(legacy.withdrawalTokenHash), timestamp, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
        }
        this.db.prepare(`INSERT INTO report_moderation_events(event_id,report_id,revision_id,action,reason_code,created_at,from_state,to_state)
          VALUES(?,?,?,'legacy_import','review_required',?,'legacy',?)`).run(randomUUID(), reportId, revisionId, timestamp, state);
        imported += 1;
      }
      return imported;
    });
  }

  seedOfficialSources(sources) {
    const timestamp = nowIso();
    const upsert = this.db.prepare(`INSERT INTO knowledge_sources(source_id,source_type,claim_type,school_id,department_id,academic_year,admission_route,state,revision_id,payload_json,updated_at)
      VALUES(?,?,?,?,?,?,?,'approved',NULL,?,?) ON CONFLICT(source_id) DO UPDATE SET
        source_type=excluded.source_type,claim_type=excluded.claim_type,school_id=excluded.school_id,department_id=excluded.department_id,
        academic_year=excluded.academic_year,admission_route=excluded.admission_route,state='approved',payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
    for (const source of sources) {
      if (!source?.sourceId || !["official_rule", "official_rubric"].includes(source.sourceType)) continue;
      upsert.run(source.sourceId, source.sourceType, source.claimType || "fact", source.schoolId || null, source.departmentId || null, source.academicYear || null, source.admissionRoute || null, JSON.stringify({ ...source, reviewStatus: "approved" }), timestamp);
    }
  }

  #writeKnowledgeSource(source, revisionId, timestamp) {
    this.db.prepare(`INSERT INTO knowledge_sources(source_id,source_type,claim_type,school_id,department_id,academic_year,admission_route,state,revision_id,payload_json,updated_at)
      VALUES(?,?,?,?,?,?,?,'approved',?,?,?) ON CONFLICT(source_id) DO UPDATE SET state=excluded.state,revision_id=excluded.revision_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(source.sourceId, source.sourceType, source.claimType, source.schoolId, source.departmentId, source.academicYear || null, source.admissionRoute || null, revisionId, JSON.stringify(source), timestamp);
  }

  async approvedSources() {
    const rows = this.db.prepare(`SELECT k.payload_json FROM knowledge_sources k
      LEFT JOIN community_reports r ON r.report_id=k.revision_id OR r.current_revision_id=k.revision_id
      WHERE k.state='approved' AND (k.revision_id IS NULL OR (r.state='approved' AND r.withdrawn_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>?)))`).all(nowIso());
    return rows.map((row) => parseJson(row.payload_json)).filter((source) => source.reviewStatus === "approved");
  }

  async pendingReports() {
    const rows = this.db.prepare(`SELECT r.report_id,r.source_id,r.state,r.created_at,r.school_id,r.department_id,r.academic_year,r.admission_route,r.legacy_import,v.source_json,v.pii_scan_json
      FROM community_reports r JOIN report_revisions v ON v.revision_id=r.current_revision_id WHERE r.state IN ('pending','needs_changes') ORDER BY r.created_at`).all();
    return rows.map((row) => ({ ...parseJson(row.source_json), reportId: row.report_id, sourceId: row.source_id, reviewStatus: row.state, collectedAt: row.created_at, schoolId: row.school_id, departmentId: row.department_id, academicYear: row.academic_year, admissionRoute: row.admission_route, legacyImport: Boolean(row.legacy_import), piiFindings: parseJson(row.pii_scan_json, {}).findings || [] }));
  }

  async review(reportId, decision, note = "", actorUserId = null) {
    if (!["approved", "rejected", "needs_changes"].includes(decision)) throw Object.assign(new Error("INVALID_REVIEW_DECISION"), { code: "INVALID_DECISION", status: 400 });
    return this.#transaction(() => {
      const report = this.db.prepare("SELECT * FROM community_reports WHERE report_id=?").get(reportId);
      if (!report) return null;
      if (!["pending", "needs_changes"].includes(report.state)) return { conflict: true, reportId, state: report.state };
      const revision = this.db.prepare("SELECT * FROM report_revisions WHERE revision_id=? AND report_id=?").get(report.current_revision_id, reportId);
      if (!revision) throw new Error("CURRENT_REPORT_REVISION_MISSING");
      if (decision === "approved") {
        const policy = this.sharePolicy();
        const consent = policy && this.db.prepare(`SELECT 1 FROM consent_receipts
          WHERE report_id=? AND revision_id=? AND purpose='share_experience' AND action='granted'
            AND withdrawn_at IS NULL AND policy_version=? AND notice_sha256=?`).get(reportId, revision.revision_id, policy.version, policy.noticeHash);
        if (!consent) throw Object.assign(new Error("這筆心得沒有目前版本的有效分享同意，必須由提交者依新說明重新送出。"), { code: "REPORT_CURRENT_CONSENT_REQUIRED", status: 409 });
      }
      const timestamp = nowIso();
      const safeNote = inspectAndMask(String(note || "").trim().slice(0, 500)).summary;
      const source = parseJson(revision.source_json);
      source.reviewStatus = decision;
      source.moderation = { decision, reviewedAt: timestamp };
      if (decision !== "approved") source.summary = source.summary.slice(0, 2500);
      this.db.prepare("UPDATE community_reports SET state=?,updated_at=?,approved_at=? WHERE report_id=?").run(decision, timestamp, decision === "approved" ? timestamp : null, reportId);
      this.db.prepare("UPDATE report_revisions SET source_json=? WHERE revision_id=?").run(JSON.stringify(source), revision.revision_id);
      this.db.prepare(`INSERT INTO report_moderation_events(event_id,report_id,revision_id,actor_user_id,action,reason_code,note,created_at,from_state,to_state)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), reportId, revision.revision_id, actorUserId, decision, "moderator_decision", safeNote, timestamp, report.state, decision);
      if (decision === "approved") this.#writeKnowledgeSource(source, revision.revision_id, timestamp);
      else this.db.prepare("UPDATE knowledge_sources SET state='disabled',updated_at=? WHERE revision_id=?").run(timestamp, revision.revision_id);
      this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`).run(randomUUID(), "report", reportId, decision === "approved" ? "report.approved" : "report." + decision, `report-review:${reportId}:${timestamp}`, JSON.stringify({ reportId, revisionId: revision.revision_id, decision }), timestamp, timestamp);
      return { ...source, reportId, sourceId: report.source_id, reviewStatus: decision };
    });
  }

  async withdraw(reportId, token) {
    return this.#transaction(() => {
      const report = this.db.prepare(`SELECT r.*,c.token_hash,c.hash_version,v.revision_id,v.source_json
        FROM community_reports r LEFT JOIN report_withdrawal_credentials c ON c.report_id=r.report_id
        LEFT JOIN report_revisions v ON v.revision_id=r.current_revision_id WHERE r.report_id=?`).get(reportId);
      const providedHash = keyedHash(this.applicationKey, "report-withdrawal", String(token || ""));
      const legacyHash = createHash("sha256").update(String(token || "")).digest("hex");
      const expected = String(report?.token_hash || "");
      const candidate = report?.hash_version === "sha256-legacy" ? legacyHash : providedHash;
      if (!report || !expected || report.state === "withdrawn" || !tokenEqual(candidate, expected)) return { authorized: false };
      const timestamp = nowIso();
      const source = parseJson(report.source_json);
      source.reviewStatus = "withdrawn";
      source.consentStatus = "withdrawn";
      source.summary = "";
      source.excerpt = "";
      source.topics = [];
      source.title = "已撤回的使用者心得";
      this.db.prepare("UPDATE community_reports SET state='withdrawn',updated_at=?,withdrawn_at=? WHERE report_id=?").run(timestamp, timestamp, reportId);
      if (report.revision_id) this.db.prepare("UPDATE report_revisions SET title=?,summary='',topics_json='[]',source_json='{}',superseded_at=? WHERE revision_id=?").run("已撤回的使用者心得", timestamp, report.revision_id);
      this.db.prepare("UPDATE consent_receipts SET action='withdrawn',withdrawn_at=? WHERE report_id=? AND purpose='share_experience'").run(timestamp, reportId);
      this.db.prepare("DELETE FROM report_withdrawal_credentials WHERE report_id=?").run(reportId);
      this.db.prepare("UPDATE knowledge_sources SET state='disabled',payload_json='{}',updated_at=? WHERE revision_id=?").run(timestamp, report.revision_id);
      this.db.prepare(`INSERT INTO report_moderation_events(event_id,report_id,revision_id,action,reason_code,created_at,from_state,to_state)
        VALUES(?,?,?,'withdrawn','user_withdrawal',?,?,?)`).run(randomUUID(), reportId, report.revision_id, timestamp, report.state, "withdrawn");
      this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`).run(randomUUID(), "report", reportId, "report.withdrawn", `report-withdrawn:${reportId}`, JSON.stringify({ reportId, revisionId: report.revision_id }), timestamp, timestamp);
      return { authorized: true, reportId, reviewStatus: "withdrawn" };
    });
  }
}
