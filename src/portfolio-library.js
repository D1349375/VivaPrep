export const PORTFOLIO_PARSER_VERSION = "portfolio-v2-neutral-fast";
let databasePromise;
let writeQueue = Promise.resolve();

function database() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open("vivaprep-portfolio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("libraries");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("資料庫正被其他頁面使用。"));
  }).catch((error) => { databasePromise = null; throw error; });
  return databasePromise;
}

// Explicit whitelist: no File/Blob, PDF bytes, credentials or interview answers.
export function librarySnapshot(files, claims, origin) {
  const documents = files.filter((file) => file.status === "done").slice(0, 5).map((file) => ({
    id: file.id, name: String(file.name).slice(0, 120), size: file.size, lastModified: file.lastModified,
    hash: file.hash, parserVersion: file.parserVersion, selected: file.selected !== false,
    status: "done", message: file.message, analyzedAt: file.analyzedAt,
    ...(file.source === "drive" ? { source: "drive" } : {}),
  }));
  const ids = new Set(documents.map((file) => file.id));
  const savedClaims = origin === "sample" ? [] : claims.filter((claim) => !claim.documentId || ids.has(claim.documentId)).slice(0, 80).map((claim) => ({
    id: String(claim.id).slice(0, 120), text: String(claim.text || "").slice(0, 500),
    documentId: claim.documentId, sourceFilename: claim.sourceFilename,
    sourcePage: claim.sourcePage, evidenceQuote: String(claim.evidenceQuote || "").slice(0, 240),
    claimType: claim.claimType, confidence: claim.confidence,
  }));
  return { version: 1, documents, claims: savedClaims, origin: origin === "sample" ? "manual" : origin, updatedAt: new Date().toISOString() };
}

export async function readPortfolioLibrary(scope) {
  await writeQueue.catch(() => {});
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("libraries", "readonly").objectStore("libraries").get(scope);
    request.onsuccess = () => {
      const saved = request.result;
      if (!saved || saved.version !== 1 || !Array.isArray(saved.documents) || !Array.isArray(saved.claims)) return resolve(null);
      resolve(librarySnapshot(saved.documents, saved.claims, saved.origin));
    };
    request.onerror = () => reject(request.error);
  });
}

export function writePortfolioLibrary(scope, snapshot) {
  return enqueue(async () => {
    const db = await database();
    await transaction(db, (store) => store.put(snapshot, scope));
  });
}

export function deletePortfolioLibrary(scope) {
  return enqueue(async () => {
    const db = await database();
    await transaction(db, (store) => store.delete(scope));
  });
}

function enqueue(operation) {
  const result = writeQueue.catch(() => {}).then(operation);
  writeQueue = result;
  return result;
}
function transaction(db, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("libraries", "readwrite");
    operation(tx.objectStore("libraries"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function portfolioFileHash(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
