import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { decryptText, encryptText, hashPassword, keyedHash, safeEqualText, verifyPassword } from "./crypto-utils.js";

const AUTH_COOKIE = "vivaprep_auth";
const GUEST_COOKIE = "vivaprep_guest";
const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
const ACTION_TTL_MS = 30 * 60 * 1000;
const DELETION_CANCEL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function revealField(key, namespace, value) {
  try { return decryptText(key, namespace, value); } catch { return String(value || ""); }
}

function normalizeEmail(value) {
  const email = String(value || "").trim().normalize("NFKC").toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("請輸入有效的電子郵件地址。"), { code: "INVALID_EMAIL", status: 400 });
  }
  return email;
}

function validatePassword(password) {
  const value = String(password || "");
  const length = [...value].length;
  if (length < 12 || length > 128 || Buffer.byteLength(value, "utf8") > 1024) {
    throw Object.assign(new Error("密碼需為 12 至 128 個字元。"), { code: "INVALID_PASSWORD", status: 400 });
  }
  return value;
}

function parseCookies(header = "") {
  const result = {};
  for (const pair of String(header).split(";")) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { result[key] = ""; }
  }
  return result;
}

function cookieName(base, secure) { return secure ? `__Host-${base}` : base; }

function cookieHeader(name, value, { secure, clear = false } = {}) {
  const parts = [`${name}=${clear ? "" : encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  if (clear) parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of String(value).toUpperCase().replace(/=+$/g, "")) {
    const digit = BASE32.indexOf(char);
    if (digit < 0) throw new Error("INVALID_BASE32_SECRET");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}
function totpAt(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}
function verifyTotp(secret, rawCode, lastCounter = -1) {
  const code = String(rawCode || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(Date.now() / 30_000);
  for (const counter of [current - 1, current, current + 1]) {
    if (counter > lastCounter && safeEqualText(totpAt(secret, counter), code)) return counter;
  }
  return null;
}

export function appendSetCookie(response, value) {
  if (!value) return;
  const existing = response.getHeader("Set-Cookie");
  response.setHeader("Set-Cookie", existing ? [...(Array.isArray(existing) ? existing : [existing]), value] : [value]);
}

export class AuthService {
  constructor({ database, applicationKey, secureCookies, bootstrapAdminEmail }) {
    this.db = database.connection;
    this.applicationKey = applicationKey;
    this.secureCookies = secureCookies;
    this.bootstrapAdminEmail = bootstrapAdminEmail ? String(bootstrapAdminEmail).trim().toLowerCase() : "";
    this.authCookieName = cookieName(AUTH_COOKIE, secureCookies);
    this.guestCookieName = cookieName(GUEST_COOKIE, secureCookies);
    this.loginAttempts = new Map();
  }

  #emailHash(email) { return keyedHash(this.applicationKey, "email-lookup", email); }
  #tokenHash(token, purpose) { return keyedHash(this.applicationKey, `action-token:${purpose}`, token); }
  #cookieHash(token) { return keyedHash(this.applicationKey, "auth-session", token); }
  #guestHash(token) { return keyedHash(this.applicationKey, "guest-session", token); }
  #csrfFor(token) { return keyedHash(this.applicationKey, "csrf-token", token); }

  resolveContext(request) {
    const cookies = parseCookies(request.headers.cookie);
    const authToken = cookies[this.authCookieName] || "";
    const guestToken = cookies[this.guestCookieName] || "";
    const authSession = authToken ? this.db.prepare(`
      SELECT s.session_id, s.user_id, s.csrf_hash, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
             s.revoked_at, s.mfa_verified_at, u.display_name, u.status
      FROM auth_sessions s JOIN users u ON u.user_id = s.user_id
      WHERE s.token_hash = ?
    `).get(this.#cookieHash(authToken)) : null;

    const now = Date.now();
    if (authSession && !authSession.revoked_at && authSession.status === "active" &&
        Date.parse(authSession.idle_expires_at) > now && Date.parse(authSession.absolute_expires_at) > now) {
      const csrfToken = this.#csrfFor(authToken);
      const csrfHash = keyedHash(this.applicationKey, "csrf-session", csrfToken);
      if (safeEqualText(csrfHash, authSession.csrf_hash)) {
        const lastSeen = Date.parse(authSession.last_seen_at || "");
        if (!Number.isFinite(lastSeen) || now - lastSeen > 5 * 60 * 1000) {
          this.db.prepare("UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE session_id = ?")
            .run(nowIso(), new Date(Math.min(now + SESSION_IDLE_MS, Date.parse(authSession.absolute_expires_at))).toISOString(), authSession.session_id);
        }
        const contact = this.db.prepare("SELECT encrypted_value FROM user_contacts WHERE user_id = ? AND contact_type = 'email' AND retired_at IS NULL ORDER BY created_at LIMIT 1").get(authSession.user_id);
        const roles = this.db.prepare("SELECT role_key FROM user_roles WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").all(authSession.user_id, nowIso()).map((row) => row.role_key);
        return {
          isGuest: false,
          user: { userId: authSession.user_id, displayName: revealField(this.applicationKey, "user-display-name", authSession.display_name), email: contact ? decryptText(this.applicationKey, "user-contact", contact.encrypted_value) : null },
          userId: authSession.user_id,
          roles,
          authSessionId: authSession.session_id,
          mfaVerifiedAt: authSession.mfa_verified_at,
          csrfToken,
          guestToken: null,
          guestOwnerHash: null,
          cookiesToSet: [],
        };
      }
    }

    const token = /^[A-Za-z0-9_-]{40,60}$/.test(guestToken) ? guestToken : randomBytes(32).toString("base64url");
    return {
      isGuest: true,
      user: null,
      userId: null,
      roles: [],
      authSessionId: null,
      mfaVerifiedAt: null,
      csrfToken: this.#csrfFor(token),
      guestToken: token,
      guestOwnerHash: this.#guestHash(token),
      cookiesToSet: guestToken === token ? [] : [cookieHeader(this.guestCookieName, token, { secure: this.secureCookies })],
    };
  }

  setAuthCookie(token) { return cookieHeader(this.authCookieName, token, { secure: this.secureCookies }); }
  clearAuthCookie() { return cookieHeader(this.authCookieName, "", { secure: this.secureCookies, clear: true }); }
  clearGuestCookie() { return cookieHeader(this.guestCookieName, "", { secure: this.secureCookies, clear: true }); }

  assertCsrf(context, request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin && host) {
      let originHost = "";
      try { originHost = new URL(origin).host; } catch {}
      if (originHost !== host) throw Object.assign(new Error("跨站請求已拒絕。"), { code: "CSRF_REJECTED", status: 403 });
    }
    const provided = request.headers["x-csrf-token"];
    if (!safeEqualText(provided, context.csrfToken)) {
      throw Object.assign(new Error("頁面驗證已過期，請重新整理後再試。"), { code: "CSRF_REJECTED", status: 403 });
    }
  }

  requireUser(context) {
    if (!context?.userId) throw Object.assign(new Error("請先登入再使用此功能。"), { code: "AUTH_REQUIRED", status: 401 });
    return context.user;
  }

  requireRole(context, role) {
    this.requireUser(context);
    if (!context.roles.includes(role) && !context.roles.includes("admin")) {
      throw Object.assign(new Error("目前帳號沒有此操作權限。"), { code: "FORBIDDEN", status: 403 });
    }
    if ((role === "admin" || role === "report_reviewer" || role === "privacy_operator") &&
        (!context.mfaVerifiedAt || Date.now() - Date.parse(context.mfaVerifiedAt) > 12 * 60 * 60 * 1000)) {
      throw Object.assign(new Error("請先完成管理者雙重驗證。"), { code: "MFA_REQUIRED", status: 403 });
    }
  }

  ownsInterviewSession(context, session) {
    if (!session) return false;
    if (session.ownerUserId) return session.ownerUserId === context.userId;
    return Boolean(context.isGuest && session.guestOwnerHash && safeEqualText(session.guestOwnerHash, context.guestOwnerHash));
  }

  #recordAttempt(scope, identity) {
    const key = keyedHash(this.applicationKey, `rate:${scope}`, identity);
    const now = Date.now();
    const record = this.loginAttempts.get(key) || { start: now, count: 0 };
    if (now - record.start > 15 * 60 * 1000) { record.start = now; record.count = 0; }
    record.count += 1;
    this.loginAttempts.set(key, record);
    if (this.loginAttempts.size > 5000) {
      for (const [oldKey, oldValue] of this.loginAttempts) if (now - oldValue.start > 30 * 60 * 1000) this.loginAttempts.delete(oldKey);
    }
    if (record.count > 12) throw Object.assign(new Error("嘗試次數過多，請 15 分鐘後再試。"), { code: "RATE_LIMITED", status: 429 });
  }

  rateLimit(scope, identity, maximum = 12, windowMs = 15 * 60 * 1000) {
    const key = keyedHash(this.applicationKey, `rate:${scope}`, String(identity || "missing"));
    const now = Date.now();
    const record = this.loginAttempts.get(key) || { start: now, count: 0 };
    if (now - record.start > windowMs) { record.start = now; record.count = 0; }
    record.count += 1;
    this.loginAttempts.set(key, record);
    if (this.loginAttempts.size > 5000) {
      for (const [oldKey, oldValue] of this.loginAttempts) if (now - oldValue.start > 30 * 60 * 1000) this.loginAttempts.delete(oldKey);
    }
    if (record.count > maximum) throw Object.assign(new Error("操作次數過多，請稍後再試。"), { code: "RATE_LIMITED", status: 429 });
  }

  #createAuthSession(userId) {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = this.#csrfFor(token);
    const createdAt = nowIso();
    const absoluteExpiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS).toISOString();
    const idleExpiresAt = new Date(Date.now() + SESSION_IDLE_MS).toISOString();
    const sessionId = randomUUID();
    this.db.prepare(`INSERT INTO auth_sessions(session_id,user_id,token_hash,csrf_hash,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(sessionId, userId, this.#cookieHash(token), keyedHash(this.applicationKey, "csrf-session", csrfToken), createdAt, createdAt, idleExpiresAt, absoluteExpiresAt);
    return { token, csrfToken, cookie: this.setAuthCookie(token), sessionId };
  }

  #audit(userId, actionKey, targetId = null, resultCode = "ok", metadata = {}) {
    const roleRow = userId ? this.db.prepare(`SELECT role_key FROM user_roles WHERE user_id=? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>?) ORDER BY CASE role_key WHEN 'admin' THEN 0 WHEN 'privacy_operator' THEN 1 WHEN 'report_reviewer' THEN 2 ELSE 3 END LIMIT 1`).get(userId, nowIso()) : null;
    const targetType = targetId ? actionKey.includes("report") ? "report" : actionKey.includes("session") ? "auth_session" : actionKey.includes("request") ? "privacy_request" : "user" : null;
    this.db.prepare(`INSERT INTO security_audit_events(event_id,actor_user_id,actor_role,action_key,target_type,target_id,result_code,metadata_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), userId, roleRow?.role_key || (userId ? "user" : "guest"), actionKey, targetType, targetId, resultCode, JSON.stringify(metadata), nowIso());
  }

  async register(input, emailDelivery) {
    const email = normalizeEmail(input.email);
    const password = validatePassword(input.password);
    const displayName = String(input.displayName || "").trim().slice(0, 60);
    if ([...displayName].length < 1) throw Object.assign(new Error("請輸入顯示名稱。"), { code: "INVALID_DISPLAY_NAME", status: 400 });
    this.#recordAttempt("register", email);
    const lookup = this.#emailHash(email);
    if (this.db.prepare("SELECT 1 FROM user_contacts WHERE contact_type = 'email' AND lookup_hmac = ? AND retired_at IS NULL").get(lookup)) {
      return { accepted: true, developmentUrl: null };
    }

    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const timestamp = nowIso();
    const token = this.#createAccountTransaction({ userId, displayName, email, lookup, passwordHash, timestamp });
    let delivery;
    try { delivery = await emailDelivery.sendActionLink({ email, purpose: "email_verify", token }); }
    catch (error) { this.#audit(userId, "auth.email_verification.delivery_failed", userId, error.code || "delivery_failed"); throw error; }
    this.#audit(userId, "auth.register", userId);
    return { accepted: true, developmentUrl: delivery.developmentUrl || null };
  }

  #createAccountTransaction({ userId, displayName, email, lookup, passwordHash, timestamp }) {
    const token = randomBytes(32).toString("base64url");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO users(user_id,display_name,status,created_at,updated_at) VALUES(?,?,'pending_verification',?,?)").run(userId, encryptText(this.applicationKey, "user-display-name", displayName), timestamp, timestamp);
      this.db.prepare(`INSERT INTO user_contacts(contact_id,user_id,contact_type,encrypted_value,lookup_hmac,created_at)
        VALUES(?,?,'email',?,?,?)`).run(randomUUID(), userId, encryptText(this.applicationKey, "user-contact", email), lookup, timestamp);
      this.db.prepare("INSERT INTO password_credentials(user_id,password_hash,hash_version,changed_at) VALUES(?,?,?,?)").run(userId, passwordHash, "scrypt-n32768-r8-p1-v1", timestamp);
      this.db.prepare("INSERT INTO user_roles(user_id,role_key,granted_at,grant_reason) VALUES(?,'user',?,'registration')").run(userId, timestamp);
      this.db.prepare(`INSERT INTO auth_action_tokens(token_id,user_id,purpose,token_hash,created_at,expires_at)
        VALUES(?,?,'email_verify',?,?,?)`).run(randomUUID(), userId, this.#tokenHash(token, "email_verify"), timestamp, new Date(Date.now() + ACTION_TTL_MS).toISOString());
      this.db.prepare("INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(randomUUID(), "user", userId, "auth.email_verification_requested", `email-verify:${userId}:${timestamp}`, JSON.stringify({ userId }), timestamp, timestamp);
      this.db.exec("COMMIT");
      return token;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (String(error?.message).includes("UNIQUE constraint failed")) throw Object.assign(new Error("無法建立帳號，請檢查資料後再試。"), { code: "ACCOUNT_CREATE_CONFLICT", status: 409 });
      throw error;
    }
  }

  async login(input) {
    let email;
    try { email = normalizeEmail(input.email); } catch { email = String(input.email || "").trim().toLowerCase().slice(0, 254); }
    this.#recordAttempt("login", email || "missing");
    const lookup = this.#emailHash(email);
    const record = this.db.prepare(`SELECT u.user_id,u.status,c.password_hash
      FROM user_contacts e JOIN users u ON u.user_id=e.user_id
      JOIN password_credentials c ON c.user_id=u.user_id
      WHERE e.contact_type='email' AND e.lookup_hmac=? AND e.retired_at IS NULL`).get(lookup);
    const password = String(input.password || "");
    const valid = await verifyPassword(password, record?.password_hash || "").catch(() => false);
    if (!record || record.status !== "active" || !valid) {
      this.#audit(null, "auth.login", null, "invalid_credentials");
      throw Object.assign(new Error("電子郵件、密碼或驗證狀態不正確。"), { code: "INVALID_CREDENTIALS", status: 401 });
    }
    this.db.prepare("UPDATE password_credentials SET last_authenticated_at = ? WHERE user_id = ?").run(nowIso(), record.user_id);
    this.#audit(record.user_id, "auth.login", record.user_id);
    return this.#createAuthSession(record.user_id);
  }

  // `identity` comes from a verified Google ID token ({ subject, email }, email verified).
  loginWithGoogle(identity) {
    const subjectHash = keyedHash(this.applicationKey, "google-subject", identity.subject);
    const email = normalizeEmail(identity.email);
    const lookup = this.#emailHash(email);
    const timestamp = nowIso();
    const notActive = () => Object.assign(new Error("這個帳號目前無法登入（可能正在刪除流程中）。"), { code: "ACCOUNT_NOT_ACTIVE", status: 403 });
    let userId;
    let actionKey = "auth.login_google";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const linked = this.db.prepare(`SELECT u.user_id,u.status FROM federated_identities f JOIN users u ON u.user_id=f.user_id
        WHERE f.provider='google' AND f.subject_hmac=?`).get(subjectHash);
      if (linked) {
        if (linked.status !== "active") throw notActive();
        userId = linked.user_id;
        this.db.prepare("UPDATE federated_identities SET last_authenticated_at=? WHERE provider='google' AND subject_hmac=?").run(timestamp, subjectHash);
      } else {
        const existing = this.db.prepare(`SELECT u.user_id,u.status FROM user_contacts e JOIN users u ON u.user_id=e.user_id
          WHERE e.contact_type='email' AND e.lookup_hmac=? AND e.retired_at IS NULL`).get(lookup);
        if (existing && !["active", "pending_verification"].includes(existing.status)) throw notActive();
        if (existing) {
          userId = existing.user_id;
          actionKey = "auth.google_linked";
          if (existing.status === "pending_verification") {
            // Someone registered this address but never proved they own it. Google just did,
            // so the unproven password is dropped rather than inherited (account pre-hijacking).
            this.db.prepare("DELETE FROM password_credentials WHERE user_id=?").run(userId);
            this.db.prepare("UPDATE auth_action_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").run(timestamp, userId);
            this.db.prepare("UPDATE users SET status='active',email_verified_at=?,updated_at=? WHERE user_id=?").run(timestamp, timestamp, userId);
            this.db.prepare("UPDATE user_contacts SET verified_at=? WHERE user_id=? AND lookup_hmac=?").run(timestamp, userId, lookup);
          }
        } else {
          // The Google name is not used: the display name shows on screen during practice.
          userId = randomUUID();
          actionKey = "auth.register_google";
          this.db.prepare("INSERT INTO users(user_id,display_name,status,created_at,updated_at,email_verified_at) VALUES(?,?,'active',?,?,?)")
            .run(userId, encryptText(this.applicationKey, "user-display-name", "VivaPrep 學員"), timestamp, timestamp, timestamp);
          this.db.prepare(`INSERT INTO user_contacts(contact_id,user_id,contact_type,encrypted_value,lookup_hmac,verified_at,created_at)
            VALUES(?,?,'email',?,?,?,?)`).run(randomUUID(), userId, encryptText(this.applicationKey, "user-contact", email), lookup, timestamp, timestamp);
          this.db.prepare("INSERT INTO user_roles(user_id,role_key,granted_at,grant_reason) VALUES(?,'user',?,'google_sign_in')").run(userId, timestamp);
        }
        this.db.prepare("INSERT INTO federated_identities(provider,subject_hmac,user_id,created_at,last_authenticated_at) VALUES('google',?,?,?,?)")
          .run(subjectHash, userId, timestamp, timestamp);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(userId, actionKey, userId);
    return this.#createAuthSession(userId);
  }

  async verifyEmail(rawToken) {
    const tokenHash = this.#tokenHash(String(rawToken || ""), "email_verify");
    const row = this.db.prepare(`SELECT t.token_id,t.user_id,t.expires_at,t.consumed_at,e.lookup_hmac
      FROM auth_action_tokens t JOIN user_contacts e ON e.user_id=t.user_id AND e.contact_type='email' AND e.retired_at IS NULL
      WHERE t.token_hash=? AND t.purpose='email_verify'`).get(tokenHash);
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
      throw Object.assign(new Error("驗證連結無效或已過期，請重新申請驗證信。"), { code: "ACTION_TOKEN_INVALID", status: 400 });
    }
    const timestamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET status='active', email_verified_at=?, updated_at=? WHERE user_id=? AND status='pending_verification'").run(timestamp, timestamp, row.user_id);
      this.db.prepare("UPDATE user_contacts SET verified_at=? WHERE user_id=? AND contact_type='email' AND retired_at IS NULL").run(timestamp, row.user_id);
      this.db.prepare("UPDATE auth_action_tokens SET consumed_at=? WHERE token_id=? AND consumed_at IS NULL").run(timestamp, row.token_id);
      if (this.bootstrapAdminEmail && row.lookup_hmac === this.#emailHash(this.bootstrapAdminEmail)) {
        this.db.prepare(`INSERT OR IGNORE INTO user_roles(user_id,role_key,granted_at,grant_reason)
          VALUES(?,'admin',?,'bootstrap-admin-email')`).run(row.user_id, timestamp);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(row.user_id, "auth.email_verified", row.user_id);
    return this.#createAuthSession(row.user_id);
  }

  async requestPasswordReset(input, emailDelivery) {
    let email;
    try { email = normalizeEmail(input.email); } catch { return { accepted: true, developmentUrl: null }; }
    this.#recordAttempt("password-reset", email);
    const lookup = this.#emailHash(email);
    const row = this.db.prepare(`SELECT u.user_id,u.status FROM user_contacts e JOIN users u ON u.user_id=e.user_id
      WHERE e.contact_type='email' AND e.lookup_hmac=? AND e.retired_at IS NULL`).get(lookup);
    if (!row || row.status !== "active") return { accepted: true, developmentUrl: null };
    const token = this.#createActionToken(row.user_id, "password_reset");
    try {
      const delivery = await emailDelivery.sendActionLink({ email, purpose: "password_reset", token });
      this.#audit(row.user_id, "auth.password_reset_requested", row.user_id);
      return { accepted: true, developmentUrl: delivery.developmentUrl || null };
    } catch (error) {
      this.#audit(row.user_id, "auth.password_reset.delivery_failed", row.user_id, error.code || "delivery_failed");
      throw error;
    }
  }

  async resetPassword(rawToken, rawPassword) {
    const password = validatePassword(rawPassword);
    const tokenHash = this.#tokenHash(String(rawToken || ""), "password_reset");
    const row = this.db.prepare(`SELECT token_id,user_id,expires_at,consumed_at FROM auth_action_tokens
      WHERE token_hash=? AND purpose='password_reset'`).get(tokenHash);
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
      throw Object.assign(new Error("重設連結無效或已過期，請重新申請。"), { code: "ACTION_TOKEN_INVALID", status: 400 });
    }
    const passwordHash = await hashPassword(password);
    const timestamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Accounts created with Google have no password row; a reset adds one.
      this.db.prepare(`INSERT INTO password_credentials(user_id,password_hash,hash_version,changed_at) VALUES(?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,hash_version=excluded.hash_version,changed_at=excluded.changed_at`)
        .run(row.user_id, passwordHash, "scrypt-n32768-r8-p1-v1", timestamp);
      this.db.prepare("UPDATE auth_action_tokens SET consumed_at=? WHERE token_id=? AND consumed_at IS NULL").run(timestamp, row.token_id);
      this.db.prepare("UPDATE auth_sessions SET revoked_at=?,revoke_reason='password_reset' WHERE user_id=? AND revoked_at IS NULL").run(timestamp, row.user_id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(row.user_id, "auth.password_reset_completed", row.user_id);
    return true;
  }

  logout(context, all = false) {
    if (context.authSessionId) {
      const timestamp = nowIso();
      if (all) this.db.prepare("UPDATE auth_sessions SET revoked_at=?,revoke_reason='logout_all' WHERE user_id=? AND revoked_at IS NULL").run(timestamp, context.userId);
      else this.db.prepare("UPDATE auth_sessions SET revoked_at=?,revoke_reason='logout' WHERE session_id=? AND user_id=?").run(timestamp, context.authSessionId, context.userId);
      this.#audit(context.userId, all ? "auth.logout_all" : "auth.logout", context.userId);
    }
  }

  publicSession(context) {
    const mfa = context.userId ? this.db.prepare("SELECT enabled_at FROM user_mfa WHERE user_id=?").get(context.userId) : null;
    const elevatedRole = context.roles.some((role) => ["admin", "report_reviewer", "privacy_operator"].includes(role));
    const mfaFresh = Boolean(context.mfaVerifiedAt && Date.now() - Date.parse(context.mfaVerifiedAt) <= 12 * 60 * 60 * 1000);
    return {
      authenticated: Boolean(context.userId),
      csrfToken: context.csrfToken,
      user: context.user ? { displayName: context.user.displayName, email: context.user.email } : null,
      capabilities: {
        saveHistory: Boolean(context.userId),
        shareReport: true,
        roles: context.roles,
        mfaEnabled: Boolean(mfa?.enabled_at),
        mfaSetupAllowed: Boolean(elevatedRole),
        mfaRequired: elevatedRole && !mfaFresh,
      },
    };
  }

  account(context) {
    const user = this.requireUser(context);
    const sessions = this.db.prepare(`SELECT session_id,created_at,last_seen_at,absolute_expires_at,mfa_verified_at
      FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL AND absolute_expires_at>? ORDER BY created_at DESC`).all(user.userId, nowIso());
    const counts = this.db.prepare(`SELECT COUNT(*) AS total FROM interview_history WHERE user_id=? AND deleted_at IS NULL AND retention_expires_at>?`).get(user.userId, nowIso());
    return { user, roles: context.roles, sessions, currentSessionId: context.authSessionId, savedPracticeCount: counts.total };
  }

  updateDisplayName(context, rawName) {
    const user = this.requireUser(context);
    const displayName = String(rawName || "").trim().normalize("NFKC");
    if ([...displayName].length < 1 || [...displayName].length > 60) throw Object.assign(new Error("顯示名稱需介於 1 至 60 個字元。"), { code: "INVALID_DISPLAY_NAME", status: 400 });
    this.db.prepare("UPDATE users SET display_name=?,updated_at=? WHERE user_id=? AND status='active'")
      .run(encryptText(this.applicationKey, "user-display-name", displayName), nowIso(), user.userId);
    this.#audit(user.userId, "account.display_name_updated", user.userId);
    return { updated: true };
  }

  async changePassword(context, currentPassword, newPassword) {
    const user = this.requireUser(context);
    const credential = this.db.prepare("SELECT password_hash FROM password_credentials WHERE user_id=?").get(user.userId);
    if (!credential) throw Object.assign(new Error("這個帳號用 Google 登入，尚未設定密碼；請登出後用「忘記密碼」設定。"), { code: "PASSWORD_NOT_SET", status: 400 });
    if (!await verifyPassword(String(currentPassword || ""), credential.password_hash).catch(() => false)) {
      throw Object.assign(new Error("目前密碼不正確。"), { code: "CURRENT_PASSWORD_INVALID", status: 400 });
    }
    const password = validatePassword(newPassword);
    const passwordHash = await hashPassword(password);
    const timestamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE password_credentials SET password_hash=?,hash_version=?,changed_at=? WHERE user_id=?")
        .run(passwordHash, "scrypt-n32768-r8-p1-v1", timestamp, user.userId);
      this.db.prepare("UPDATE auth_sessions SET revoked_at=?,revoke_reason='password_changed' WHERE user_id=? AND session_id<>? AND revoked_at IS NULL")
        .run(timestamp, user.userId, context.authSessionId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(user.userId, "auth.password_changed", user.userId);
    return { changed: true, otherSessionsRevoked: true };
  }

  async requestDeletion(context, emailDelivery) {
    const user = this.requireUser(context);
    const requestId = randomUUID();
    const now = nowIso();
    const cancelUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const token = this.#createActionToken(user.userId, "deletion_cancel");
    try {
      await emailDelivery.sendActionLink({ email: user.email, purpose: "deletion_cancel", token });
    } catch (error) {
      this.db.prepare("DELETE FROM auth_action_tokens WHERE user_id=? AND purpose='deletion_cancel' AND consumed_at IS NULL").run(user.userId);
      throw error;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO privacy_requests(request_id,user_id,request_type,state,created_at,due_at) VALUES(?,?,'deletion','pending',?,?)").run(requestId, user.userId, now, cancelUntil);
      this.db.prepare("UPDATE users SET status='pending_deletion',deletion_requested_at=?,updated_at=? WHERE user_id=?").run(now, now, user.userId);
      this.db.prepare("UPDATE auth_sessions SET revoked_at=?,revoke_reason='account_deletion' WHERE user_id=? AND revoked_at IS NULL").run(now, user.userId);
      this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), "privacy_request", requestId, "privacy.deletion_requested", `privacy-deletion:${requestId}`, JSON.stringify({ requestId, userId: user.userId }), now, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.prepare("DELETE FROM auth_action_tokens WHERE token_hash=? AND purpose='deletion_cancel'").run(this.#tokenHash(token, "deletion_cancel"));
      throw error;
    }
    this.#audit(user.userId, "privacy.account_deletion_requested", requestId);
    return { requested: true, cancelUntil, cancellationEmailSent: true, keptIndependentShares: true };
  }

  cancelDeletion(context, requestId) {
    const user = this.requireUser(context);
    const request = this.db.prepare("SELECT request_id,due_at,state FROM privacy_requests WHERE request_id=? AND user_id=? AND request_type='deletion'").get(requestId, user.userId);
    if (!request || request.state !== "pending" || Date.parse(request.due_at) <= Date.now()) {
      throw Object.assign(new Error("找不到可取消的刪除申請。"), { code: "DELETION_REQUEST_NOT_CANCELABLE", status: 404 });
    }
    const timestamp = nowIso();
    this.db.prepare("UPDATE privacy_requests SET state='cancelled',completed_at=? WHERE request_id=?").run(timestamp, requestId);
    this.db.prepare("UPDATE users SET status='active',deletion_requested_at=NULL,updated_at=? WHERE user_id=? AND status='pending_deletion'").run(timestamp, user.userId);
    this.#audit(user.userId, "privacy.account_deletion_cancelled", requestId);
    return { cancelled: true };
  }

  cancelDeletionWithToken(rawToken) {
    const tokenHash = this.#tokenHash(String(rawToken || ""), "deletion_cancel");
    const row = this.db.prepare(`SELECT t.token_id,t.user_id,t.expires_at,t.consumed_at
      FROM auth_action_tokens t JOIN users u ON u.user_id=t.user_id
      WHERE t.token_hash=? AND t.purpose='deletion_cancel' AND u.status='pending_deletion'`).get(tokenHash);
    const request = row && this.db.prepare(`SELECT request_id,due_at,state FROM privacy_requests
      WHERE user_id=? AND request_type='deletion' AND state='pending' ORDER BY created_at DESC LIMIT 1`).get(row.user_id);
    if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now() || !request || Date.parse(request.due_at) <= Date.now()) {
      throw Object.assign(new Error("取消連結無效或已過期，請聯絡服務管理者。"), { code: "ACTION_TOKEN_INVALID", status: 400 });
    }
    const timestamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE privacy_requests SET state='cancelled',completed_at=? WHERE request_id=? AND state='pending'").run(timestamp, request.request_id);
      this.db.prepare("UPDATE users SET status='active',deletion_requested_at=NULL,updated_at=? WHERE user_id=? AND status='pending_deletion'").run(timestamp, row.user_id);
      this.db.prepare("UPDATE auth_action_tokens SET consumed_at=? WHERE token_id=? AND consumed_at IS NULL").run(timestamp, row.token_id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(row.user_id, "privacy.account_deletion_cancelled", request.request_id);
    return this.#createAuthSession(row.user_id);
  }

  purgeExpiredDeletionRequests() {
    const due = this.db.prepare(`SELECT request_id,user_id FROM privacy_requests
      WHERE request_type='deletion' AND state='pending' AND due_at IS NOT NULL AND due_at<=?`).all(nowIso());
    let deleted = 0;
    for (const item of due) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const requests = this.db.prepare("SELECT request_id FROM privacy_requests WHERE user_id=?").all(item.user_id);
        const completedAt = nowIso();
        this.db.prepare(`UPDATE privacy_requests SET
          state=CASE WHEN request_id=? THEN 'completed' WHEN state='pending' THEN 'cancelled' ELSE state END,
          completed_at=COALESCE(completed_at,?),user_id=NULL WHERE user_id=? OR request_id=?`)
          .run(item.request_id, completedAt, item.user_id, item.request_id);
        this.db.prepare("DELETE FROM consent_receipts WHERE user_id=?").run(item.user_id);
        this.db.prepare("UPDATE integration_outbox SET payload_json='{}',processed_at=?,last_error_code='subject_deleted' WHERE aggregate_type='user' AND aggregate_id=?").run(nowIso(), item.user_id);
        for (const request of requests) this.db.prepare("UPDATE integration_outbox SET payload_json='{}',processed_at=?,last_error_code='subject_deleted' WHERE aggregate_type='privacy_request' AND aggregate_id=?").run(nowIso(), request.request_id);
        this.db.prepare("DELETE FROM users WHERE user_id=? AND status='pending_deletion'").run(item.user_id);
        this.db.exec("COMMIT");
        deleted += 1;
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
    return deleted;
  }

  mfaStatus(context) {
    const user = this.requireUser(context);
    const row = this.db.prepare("SELECT enabled_at FROM user_mfa WHERE user_id=?").get(user.userId);
    return { enabled: Boolean(row?.enabled_at), verifiedForSession: Boolean(context.mfaVerifiedAt && Date.now() - Date.parse(context.mfaVerifiedAt) <= 12 * 60 * 60 * 1000) };
  }

  beginMfaSetup(context) {
    const user = this.requireUser(context);
    const elevated = context.roles.some((role) => ["admin", "report_reviewer", "privacy_operator"].includes(role));
    if (!elevated) throw Object.assign(new Error("此帳號不需要設定管理者雙重驗證。"), { code: "FORBIDDEN", status: 403 });
    const current = this.db.prepare("SELECT enabled_at FROM user_mfa WHERE user_id=?").get(user.userId);
    if (current?.enabled_at) throw Object.assign(new Error("此帳號已啟用雙重驗證。"), { code: "MFA_ALREADY_ENABLED", status: 409 });
    const secret = encodeBase32(randomBytes(20));
    this.db.prepare(`INSERT INTO user_mfa(user_id,encrypted_secret,enabled_at,last_counter) VALUES(?,?,NULL,0)
      ON CONFLICT(user_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,enabled_at=NULL,last_counter=0`)
      .run(user.userId, encryptText(this.applicationKey, "user-mfa", secret));
    const label = encodeURIComponent(`VivaPrep:${user.email}`);
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=VivaPrep&algorithm=SHA1&digits=6&period=30`;
    this.#audit(user.userId, "auth.mfa_setup_started", user.userId);
    return { secret, otpauthUri: uri };
  }

  confirmMfaSetup(context, code) {
    const user = this.requireUser(context);
    this.rateLimit("mfa-confirm", user.userId, 10, 15 * 60 * 1000);
    const row = this.db.prepare("SELECT encrypted_secret,enabled_at,last_counter FROM user_mfa WHERE user_id=?").get(user.userId);
    if (!row || row.enabled_at) throw Object.assign(new Error("請先開始雙重驗證設定。"), { code: "MFA_SETUP_NOT_STARTED", status: 409 });
    const secret = decryptText(this.applicationKey, "user-mfa", row.encrypted_secret);
    const counter = verifyTotp(decodeBase32(secret), code, row.last_counter);
    if (counter === null) throw Object.assign(new Error("驗證碼不正確或已使用，請再試一次。"), { code: "MFA_CODE_INVALID", status: 400 });
    const timestamp = nowIso();
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(10).toString("base64url").toUpperCase());
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE user_mfa SET enabled_at=?,last_counter=? WHERE user_id=? AND enabled_at IS NULL").run(timestamp, counter, user.userId);
      this.db.prepare("UPDATE auth_sessions SET mfa_verified_at=? WHERE session_id=? AND user_id=?").run(timestamp, context.authSessionId, user.userId);
      this.db.prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id=?").run(user.userId);
      const insertRecovery = this.db.prepare(`INSERT INTO user_mfa_recovery_codes(user_id,code_hash,hash_version,created_at)
        VALUES(?,?,'hmac-v1',?)`);
      for (const recoveryCode of recoveryCodes) insertRecovery.run(user.userId, keyedHash(this.applicationKey, "mfa-recovery", recoveryCode), timestamp);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(user.userId, "auth.mfa_enabled", user.userId);
    return { enabled: true, verifiedAt: timestamp, recoveryCodes };
  }

  verifyMfa(context, code) {
    const user = this.requireUser(context);
    this.rateLimit("mfa-verify", user.userId, 10, 15 * 60 * 1000);
    const row = this.db.prepare("SELECT encrypted_secret,last_counter,enabled_at FROM user_mfa WHERE user_id=?").get(user.userId);
    if (!row?.enabled_at) throw Object.assign(new Error("此帳號尚未設定雙重驗證。"), { code: "MFA_NOT_ENABLED", status: 409 });
    let counter = null;
    let recoveryCodeHash = null;
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (/^\d{6}$/.test(normalizedCode)) {
      const secret = decryptText(this.applicationKey, "user-mfa", row.encrypted_secret);
      counter = verifyTotp(decodeBase32(secret), normalizedCode, row.last_counter);
    } else {
      recoveryCodeHash = keyedHash(this.applicationKey, "mfa-recovery", normalizedCode);
      const recovery = this.db.prepare("SELECT code_hash FROM user_mfa_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL").get(user.userId, recoveryCodeHash);
      if (recovery) counter = row.last_counter;
    }
    if (counter === null) throw Object.assign(new Error("驗證碼不正確、已使用或已過期，請再試一次。"), { code: "MFA_CODE_INVALID", status: 400 });
    const timestamp = nowIso();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (recoveryCodeHash) {
        const consumed = this.db.prepare("UPDATE user_mfa_recovery_codes SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL").run(timestamp, user.userId, recoveryCodeHash);
        if (!consumed.changes) throw Object.assign(new Error("復原碼已使用或無效。"), { code: "MFA_CODE_REPLAYED", status: 409 });
      } else {
        const update = this.db.prepare("UPDATE user_mfa SET last_counter=? WHERE user_id=? AND last_counter<?").run(counter, user.userId, counter);
        if (!update.changes) throw Object.assign(new Error("此驗證碼已使用，請輸入新的驗證碼。"), { code: "MFA_CODE_REPLAYED", status: 409 });
      }
      this.db.prepare("UPDATE auth_sessions SET mfa_verified_at=? WHERE session_id=? AND user_id=? AND revoked_at IS NULL").run(timestamp, context.authSessionId, user.userId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.#audit(user.userId, "auth.mfa_verified", user.userId);
    return { verified: true, verifiedAt: timestamp };
  }

  exportAccount(context, historyRepository) {
    const user = this.requireUser(context);
    this.#audit(user.userId, "privacy.account_exported", user.userId);
    return {
      exportedAt: nowIso(),
      account: { userId: user.userId, displayName: user.displayName, email: user.email },
      roles: context.roles,
      loginSessions: this.db.prepare(`SELECT created_at,last_seen_at,absolute_expires_at,revoked_at
        FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC`).all(user.userId),
      practiceSessions: historyRepository.list(user.userId).map((item) => historyRepository.get(user.userId, item.history_id)).filter(Boolean),
      consentReceipts: this.db.prepare(`SELECT purpose,policy_version,notice_sha256,action,captured_at,withdrawn_at
        FROM consent_receipts WHERE user_id=? ORDER BY captured_at`).all(user.userId),
      privacyRequests: this.db.prepare(`SELECT request_type,state,created_at,due_at,completed_at
        FROM privacy_requests WHERE user_id=? ORDER BY created_at`).all(user.userId),
    };
  }

  createPrivacyRequest(context, requestType) {
    const user = this.requireUser(context);
    if (!["access", "correction", "stop_processing"].includes(requestType)) throw Object.assign(new Error("個資申請類型不正確。"), { code: "INVALID_PRIVACY_REQUEST", status: 400 });
    const requestId = randomUUID();
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO privacy_requests(request_id,user_id,request_type,state,created_at)
      VALUES(?,?,?,'pending',?)`).run(requestId, user.userId, requestType, timestamp);
    this.db.prepare(`INSERT INTO integration_outbox(outbox_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload_json,created_at,available_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), "privacy_request", requestId, "privacy.requested", `privacy-request:${requestId}`, JSON.stringify({ requestId, userId: user.userId, requestType }), timestamp, timestamp);
    this.#audit(user.userId, `privacy.${requestType}_requested`);
    return { requestId, state: "pending" };
  }

  pendingPrivacyRequests(context) {
    this.requireRole(context, "privacy_operator");
    return this.db.prepare(`SELECT request_id,request_type,state,created_at,due_at,completed_at
      FROM privacy_requests WHERE state='pending' ORDER BY created_at LIMIT 200`).all();
  }

  completePrivacyRequest(context, requestId) {
    this.requireRole(context, "privacy_operator");
    const timestamp = nowIso();
    const result = this.db.prepare(`UPDATE privacy_requests SET state='completed',completed_at=?,operator_user_id=?
      WHERE request_id=? AND state='pending'`).run(timestamp, context.userId, requestId);
    if (!result.changes) throw Object.assign(new Error("找不到待處理的個資申請。"), { code: "PRIVACY_REQUEST_NOT_FOUND", status: 404 });
    this.#audit(context.userId, "privacy.request_completed", requestId);
    return { completed: true };
  }

  practiceSessions(context) {
    const user = this.requireUser(context);
    return this.db.prepare(`SELECT history_id,profile_id,profile_version,admission_route,status,started_at,ended_at
      FROM interview_history WHERE user_id=? AND deleted_at IS NULL AND retention_expires_at>? ORDER BY ended_at DESC LIMIT 100`).all(user.userId, nowIso());
  }

  deleteAuthSession(context, sessionId) {
    const user = this.requireUser(context);
    const result = this.db.prepare("UPDATE auth_sessions SET revoked_at=?,revoke_reason='user_revoked' WHERE session_id=? AND user_id=? AND revoked_at IS NULL").run(nowIso(), sessionId, user.userId);
    if (!result.changes) throw Object.assign(new Error("找不到這個登入裝置。"), { code: "AUTH_SESSION_NOT_FOUND", status: 404 });
    this.#audit(user.userId, "auth.session_revoked", sessionId);
    return { revoked: true };
  }

  #createActionToken(userId, purpose) {
    const token = randomBytes(32).toString("base64url");
    const timestamp = nowIso();
    this.db.prepare("DELETE FROM auth_action_tokens WHERE user_id=? AND purpose=? AND consumed_at IS NULL").run(userId, purpose);
    this.db.prepare(`INSERT INTO auth_action_tokens(token_id,user_id,purpose,token_hash,created_at,expires_at)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), userId, purpose, this.#tokenHash(token, purpose), timestamp, new Date(Date.now() + (purpose === "deletion_cancel" ? DELETION_CANCEL_TTL_MS : ACTION_TTL_MS)).toISOString());
    return token;
  }

  async sendVerificationAgain(input, emailDelivery) {
    let email;
    try { email = normalizeEmail(input.email); } catch { return { accepted: true, developmentUrl: null }; }
    this.#recordAttempt("verification-resend", email);
    const row = this.db.prepare(`SELECT u.user_id,u.status,e.encrypted_value FROM user_contacts e JOIN users u ON u.user_id=e.user_id
      WHERE e.contact_type='email' AND e.lookup_hmac=? AND e.retired_at IS NULL`).get(this.#emailHash(email));
    if (!row || row.status !== "pending_verification") return { accepted: true, developmentUrl: null };
    const token = this.#createActionToken(row.user_id, "email_verify");
    const delivered = await emailDelivery.sendActionLink({ email, purpose: "email_verify", token });
    return { accepted: true, developmentUrl: delivered.developmentUrl || null };
  }
}
