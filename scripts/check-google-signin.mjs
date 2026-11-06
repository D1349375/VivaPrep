import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AppDatabase } from "../server/database.js";
import { AuthService } from "../server/auth-service.js";
import { createGoogleTokenVerifier, googleSignInStatus } from "../server/google-signin.js";
import { createHttpHandler } from "../server/http-api.js";
import { hashPassword } from "../server/crypto-utils.js";

const CLIENT_ID = "123-abc.apps.googleusercontent.com";
const now = 1_800_000_000_000;

// ---- 1. Token verification against a fake Google key set.
const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...signer.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
let certFetches = 0;
let publishedKeys = [jwk];
const fetchImpl = async () => { certFetches++; return { ok: true, headers: new Headers({ "cache-control": "public, max-age=600" }), json: async () => ({ keys: publishedKeys }) }; };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims = {}, { kid = "k1", key = signer.privateKey, alg = "RS256" } = {}) {
  const body = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "google-sub-1", email: "Student@Example.com", email_verified: true, iat: now / 1000 - 10, exp: now / 1000 + 3600, name: "真實姓名", picture: "https://example.com/p.jpg", ...claims };
  const head = `${b64({ alg, kid, typ: "JWT" })}.${b64(body)}`;
  return `${head}.${createSign("RSA-SHA256").update(head).sign(key).toString("base64url")}`;
}
const verify = createGoogleTokenVerifier({ clientId: CLIENT_ID, fetchImpl, now: () => now });
assert.deepEqual(await verify(token()), { subject: "google-sub-1", email: "Student@Example.com" }, "Only sub and email are returned; name and photo are dropped");
await verify(token({ iss: "accounts.google.com" }));
assert.equal(certFetches, 1, "Google keys are cached for their max-age");
for (const [label, bad, code] of [
  ["wrong audience", token({ aud: "other.apps.googleusercontent.com" }), "GOOGLE_TOKEN_INVALID"],
  ["wrong issuer", token({ iss: "https://evil.example" }), "GOOGLE_TOKEN_INVALID"],
  ["expired", token({ exp: now / 1000 - 120 }), "GOOGLE_TOKEN_INVALID"],
  ["issued in the future", token({ iat: now / 1000 + 600 }), "GOOGLE_TOKEN_INVALID"],
  ["signed by another key", token({}, { key: stranger.privateKey }), "GOOGLE_TOKEN_INVALID"],
  ["unsigned", `${b64({ alg: "none", kid: "k1" })}.${b64({ sub: "x" })}.`, "GOOGLE_TOKEN_INVALID"],
  ["tampered claims", token().replace(/\.[^.]+\./, `.${b64({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "other", email: "a@b.co", email_verified: true, exp: now / 1000 + 60 })}.`), "GOOGLE_TOKEN_INVALID"],
  ["not a JWT", "abc", "GOOGLE_TOKEN_INVALID"],
  ["unverified email", token({ email_verified: false }), "GOOGLE_EMAIL_UNVERIFIED"],
]) await assert.rejects(verify(bad), (error) => error.code === code && error.status === 401, label);
// A rotated key: unknown kid refetches once, then succeeds.
const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
publishedKeys = [jwk, { ...rotated.publicKey.export({ format: "jwk" }), kid: "k2", alg: "RS256" }];
const before = certFetches;
await verify(token({}, { kid: "k2", key: rotated.privateKey }));
assert.equal(certFetches, before + 1);
await assert.rejects(verify(token({}, { kid: "k9" })), (error) => error.code === "GOOGLE_TOKEN_INVALID", "unknown kid after refetch");
assert.deepEqual(googleSignInStatus({ googleSignInClientId: "" }), { enabled: false });
assert.deepEqual(googleSignInStatus({ googleSignInClientId: CLIENT_ID }), { enabled: true, clientId: CLIENT_ID });

// ---- 2. Account rules (real schema in memory).
const database = new AppDatabase(":memory:");
const db = database.connection;
const auth = new AuthService({ database, applicationKey: randomBytes(32), secureCookies: false });
const contextFor = (cookie) => auth.resolveContext({ headers: { cookie: cookie.split(";")[0] } });

// New Google user: active, verified, generic display name, no password row.
let session = auth.loginWithGoogle({ subject: "sub-new", email: "New@Example.com" });
let context = contextFor(session.cookie);
assert.equal(context.isGuest, false);
assert.equal(context.user.displayName, "VivaPrep 學員", "The Google name must not become the on-screen display name");
assert.equal(context.user.email, "new@example.com");
const newUser = context.userId;
assert.equal(db.prepare("SELECT status FROM users WHERE user_id=?").get(newUser).status, "active");
assert.equal(db.prepare("SELECT COUNT(*) n FROM password_credentials WHERE user_id=?").get(newUser).n, 0);
assert.ok(!JSON.stringify(db.prepare("SELECT * FROM federated_identities").all()).includes("sub-new"), "Google sub is stored only as a keyed hash");
// Same Google account again: same user, no duplicate.
context = contextFor(auth.loginWithGoogle({ subject: "sub-new", email: "new@example.com" }).cookie);
assert.equal(context.userId, newUser);
assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
// Password change gives a clear message; a reset adds a password.
await assert.rejects(auth.changePassword(context, "x", "a-new-long-password"), (error) => error.code === "PASSWORD_NOT_SET");

// Existing active password account with the same verified email: linked, password kept.
const register = async (email) => {
  await auth.register({ email, password: "a-long-password-123", displayName: "原本的名字" }, { sendActionLink: async () => ({ developmentUrl: null }) });
  return db.prepare("SELECT user_id FROM users ORDER BY created_at DESC, rowid DESC LIMIT 1").get().user_id;
};
const activeId = await register("active@example.com");
db.prepare("UPDATE users SET status='active' WHERE user_id=?").run(activeId);
context = contextFor(auth.loginWithGoogle({ subject: "sub-active", email: "active@example.com" }).cookie);
assert.equal(context.userId, activeId, "Same verified email links to the existing account");
assert.equal(context.user.displayName, "原本的名字");
assert.equal(db.prepare("SELECT COUNT(*) n FROM password_credentials WHERE user_id=?").get(activeId).n, 1, "An active account keeps its password");

// Unverified registration under the same email: Google proves ownership, the unproven password is dropped.
const pendingId = await register("pending@example.com");
assert.equal(db.prepare("SELECT status FROM users WHERE user_id=?").get(pendingId).status, "pending_verification");
context = contextFor(auth.loginWithGoogle({ subject: "sub-pending", email: "pending@example.com" }).cookie);
assert.equal(context.userId, pendingId);
assert.equal(db.prepare("SELECT status FROM users WHERE user_id=?").get(pendingId).status, "active");
assert.equal(db.prepare("SELECT COUNT(*) n FROM password_credentials WHERE user_id=?").get(pendingId).n, 0, "Pre-registered password must not survive (account pre-hijacking)");
assert.equal(db.prepare("SELECT COUNT(*) n FROM auth_action_tokens WHERE user_id=? AND consumed_at IS NULL").get(pendingId).n, 0, "Old verification links stop working");
await assert.rejects(auth.login({ email: "pending@example.com", password: "a-long-password-123" }), (error) => error.code === "INVALID_CREDENTIALS");

// An account being deleted cannot be revived through Google, linked or not.
db.prepare("UPDATE users SET status='pending_deletion' WHERE user_id=?").run(activeId);
assert.throws(() => auth.loginWithGoogle({ subject: "sub-active", email: "active@example.com" }), (error) => error.code === "ACCOUNT_NOT_ACTIVE");
const deletingId = await register("deleting@example.com");
db.prepare("UPDATE users SET status='pending_deletion' WHERE user_id=?").run(deletingId);
assert.throws(() => auth.loginWithGoogle({ subject: "sub-deleting", email: "deleting@example.com" }), (error) => error.code === "ACCOUNT_NOT_ACTIVE");
assert.equal(db.prepare("SELECT COUNT(*) n FROM federated_identities WHERE user_id=?").get(deletingId).n, 0, "A refused login leaves no link behind");

// ---- 3. HTTP route: off without a client ID, sets the auth cookie when on.
async function withServer(config, verifyGoogleToken, run) {
  const server = createServer(createHttpHandler({
    root: ".", config: { maxRequestBytes: 65536, maxPdfBytes: 1, ...config },
    orchestrator: { speechStatus: () => ({ available: false }) }, agentService: {}, store: { get: () => null, list: () => [] }, getProfiles: () => [],
    reportRepository: {}, authService: auth, emailDelivery: {}, interviewHistoryRepository: {}, verifyGoogleToken,
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
async function guestCsrf(base) {
  const response = await fetch(base + "/api/auth/session");
  return { csrf: (await response.json()).csrfToken, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}
await withServer({ googleSignInClientId: "" }, null, async (base) => {
  const { csrf, cookie } = await guestCsrf(base);
  const response = await fetch(base + "/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, cookie }, body: JSON.stringify({ credential: "x" }) });
  assert.equal(response.status, 404);
  const health = await fetch(base + "/api/health").then((r) => r.json()).catch(() => null);
  if (health) assert.deepEqual(health.googleSignIn, { enabled: false });
});
await withServer({ googleSignInClientId: CLIENT_ID }, verify, async (base) => {
  const { csrf, cookie } = await guestCsrf(base);
  const send = (credential, csrfToken = csrf) => fetch(base + "/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, cookie }, body: JSON.stringify({ credential }) });
  assert.equal((await send(token({ sub: "sub-http" }), "wrong")).status, 403, "CSRF still applies");
  assert.equal((await send(token({ aud: "other" }))).status, 401);
  const ok = await send(token({ sub: "sub-http", email: "http@example.com" }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.authenticated, true);
  assert.ok(body.csrfToken);
  assert.match(ok.headers.get("set-cookie"), /vivaprep_auth=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
});

// ---- 4. Front end: Google's own button, script only on the login screen, no Google name used.
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
assert.match(app, /renderButton\(slot/, "Uses Google's rendered button (branding rules)");
assert.match(app, /state\.page === "account" && !state\.auth\?\.authenticated && state\.authMode !== "reset"\) mountGoogleSignIn\(\)/, "Script loads only on the login/register screen");
assert.match(app, /\/api\/auth\/google/);
assert.doesNotMatch(app, /given_name|\.picture\b/, "The front end never reads the Google name or photo");
console.log("google sign-in checks passed");
