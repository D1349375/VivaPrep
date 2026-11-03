// Sign in with Google: the browser gets an ID token from Google Identity Services and
// posts it here. The server checks it against Google's published keys itself, so no
// Google access token or client secret is involved, and only `sub` and the verified
// email are kept (the Google name and photo are ignored to keep the account anonymous).
import { createPublicKey, createVerify } from "node:crypto";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 60;

function rejected(message = "Google 登入驗證失敗，請重新登入。") {
  return Object.assign(new Error(message), { code: "GOOGLE_TOKEN_INVALID", status: 401 });
}

function decodeSegment(segment) {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")); }
  catch { throw rejected(); }
}

export function googleSignInStatus(config) {
  return config.googleSignInClientId ? { enabled: true, clientId: config.googleSignInClientId } : { enabled: false };
}

export function createGoogleTokenVerifier({ clientId, fetchImpl = (...args) => fetch(...args), now = () => Date.now() }) {
  let cached = { keys: new Map(), expiresAt: 0 };

  async function signingKey(kid, refresh = false) {
    if (!refresh && cached.expiresAt > now() && cached.keys.has(kid)) return cached.keys.get(kid);
    const response = await fetchImpl(GOOGLE_CERTS_URL);
    if (!response.ok) throw Object.assign(new Error("暫時無法連到 Google 驗證服務，請稍後再試。"), { code: "GOOGLE_CERTS_UNAVAILABLE", status: 503 });
    const body = await response.json();
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers?.get?.("cache-control") || "")?.[1] || 3600);
    cached = { keys: new Map((body.keys || []).map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: "jwk" })])), expiresAt: now() + maxAge * 1000 };
    return cached.keys.get(kid);
  }

  return async function verify(idToken) {
    const token = String(idToken || "");
    if (token.length > 4096) throw rejected();
    const parts = token.split(".");
    if (parts.length !== 3) throw rejected();
    const header = decodeSegment(parts[0]);
    const claims = decodeSegment(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw rejected();
    // Google rotates keys; an unknown kid triggers one refetch before giving up.
    const key = await signingKey(header.kid) || await signingKey(header.kid, true);
    if (!key) throw rejected();
    const valid = createVerify("RSA-SHA256").update(`${parts[0]}.${parts[1]}`).verify(key, Buffer.from(parts[2], "base64url"));
    if (!valid) throw rejected();
    const seconds = now() / 1000;
    if (!GOOGLE_ISSUERS.has(claims.iss)) throw rejected();
    if (claims.aud !== clientId) throw rejected();
    if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_SECONDS < seconds) throw rejected("Google 登入已逾時，請重新登入。");
    if (Number.isFinite(claims.iat) && claims.iat - CLOCK_SKEW_SECONDS > seconds) throw rejected();
    if (typeof claims.sub !== "string" || !claims.sub) throw rejected();
    if (claims.email_verified !== true || typeof claims.email !== "string") {
      throw Object.assign(new Error("這個 Google 帳號的電子郵件尚未驗證，無法登入。"), { code: "GOOGLE_EMAIL_UNVERIFIED", status: 401 });
    }
    return { subject: claims.sub, email: claims.email };
  };
}
