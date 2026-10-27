import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";

const scrypt = promisify(scryptCallback);

export async function loadApplicationKey({ dataDirectory, secret, production }) {
  if (secret) {
    const key = Buffer.from(String(secret), "utf8");
    if (key.length < 32) throw new Error("VIVAPREP_APP_SECRET_MUST_BE_AT_LEAST_32_BYTES");
    return createHash("sha256").update(key).digest();
  }
  if (production) throw new Error("VIVAPREP_APP_SECRET_REQUIRED_IN_PRODUCTION");

  const keyPath = join(dataDirectory, "application.key");
  try {
    const encoded = (await readFile(keyPath, "utf8")).trim();
    const key = Buffer.from(encoded, "base64url");
    if (key.length !== 32) throw new Error("INVALID_LOCAL_APPLICATION_KEY");
    return key;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  try {
    await writeFile(keyPath, key.toString("base64url"), { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const encoded = (await readFile(keyPath, "utf8")).trim();
    const concurrentKey = Buffer.from(encoded, "base64url");
    if (concurrentKey.length !== 32) throw new Error("INVALID_LOCAL_APPLICATION_KEY");
    return concurrentKey;
  }
}

export function keyedHash(key, namespace, value) {
  return createHmac("sha256", key).update(namespace).update("\0").update(String(value)).digest("hex");
}

export function encryptText(key, namespace, value) {
  const derived = createHmac("sha256", key).update("vivaprep/encryption/").update(namespace).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  cipher.setAAD(Buffer.from(namespace));
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptText(key, namespace, encrypted) {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = String(encrypted).split(".");
  if (!ivEncoded || !tagEncoded || ciphertextEncoded === undefined) throw new Error("INVALID_ENCRYPTED_VALUE");
  const derived = createHmac("sha256", key).update("vivaprep/encryption/").update(namespace).digest();
  const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(ivEncoded, "base64url"));
  decipher.setAAD(Buffer.from(namespace));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const derived = await scrypt(String(password), salt, 64, options);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, nText, rText, pText, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !nText || !rText || !pText || !saltText || !hashText) return false;
  const N = Number(nText), r = Number(rText), p = Number(pText);
  if (!Number.isInteger(N) || N < 16384 || N > 131072 || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return false;
  const expected = Buffer.from(hashText, "base64url");
  if (expected.length !== 64) return false;
  const actual = Buffer.from(await scrypt(String(password), Buffer.from(saltText, "base64url"), expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 }));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

