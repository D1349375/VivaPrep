// Google Drive import: OAuth token, Picker and download all run in this browser tab.
// The token stays in a local variable for one import and is never stored or sent to VivaPrep.
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const PICKER_SCRIPT = "https://apis.google.com/js/api.js";
const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files/";
const PDF_MIME = "application/pdf";
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export class DriveImportCancelled extends Error {}

function loadScriptTag(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("無法載入 Google 服務，請確認網路連線後再試。"));
    document.head.append(script);
  });
}

function driveErrorMessage(status) {
  if (status === 401) return "Google 授權已失效，請重新匯入。";
  if (status === 403) return "Google 未允許讀取這個檔案，請確認帳號權限或稍後再試。";
  if (status === 404) return "找不到這個檔案，或 VivaPrep 未獲授權讀取。";
  return `Google Drive 暫時無法提供檔案（${status}）。`;
}

function pdfFilename(name) {
  const base = String(name || "Drive 文件").split(/[\\/]/).at(-1).slice(0, 116);
  return /\.pdf$/i.test(base) ? base : base + ".pdf";
}

export function createDriveImporter({ clientId, apiKey, appId }, { loadScript = loadScriptTag, fetchImpl = (...args) => fetch(...args), scope = globalThis } = {}) {
  let prepared = null;

  // Popups need a live user gesture, so the app loads these before the button is pressed.
  function prepare() {
    prepared ||= Promise.all([loadScript(GIS_SCRIPT), loadScript(PICKER_SCRIPT)])
      .then(() => new Promise((resolve, reject) => scope.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("無法載入 Google Picker，請稍後再試。")) })))
      .catch((error) => { prepared = null; throw error; });
    return prepared;
  }

  function requestToken() {
    const oauth2 = scope.google.accounts.oauth2;
    return new Promise((resolve, reject) => {
      oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        include_granted_scopes: false,
        prompt: "select_account",
        callback: (response) => {
          if (response.error) return reject(response.error === "access_denied" ? new DriveImportCancelled() : new Error("Google 授權失敗，請再試一次。"));
          if (!oauth2.hasGrantedAllScopes(response, DRIVE_FILE_SCOPE)) return reject(new Error("需要勾選允許存取你選取的 Google Drive 檔案，才能匯入。"));
          resolve(response.access_token);
        },
        error_callback: (error) => {
          if (error?.type === "popup_closed") return reject(new DriveImportCancelled());
          reject(new Error(error?.type === "popup_failed_to_open" ? "瀏覽器擋下了 Google 登入視窗，請允許此網站的彈出式視窗後再試。" : "Google 授權失敗，請再試一次。"));
        },
      }).requestAccessToken();
    });
  }

  function openPicker(token, maxFiles) {
    const { picker } = scope.google;
    return new Promise((resolve, reject) => {
      const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(PDF_MIME).setIncludeFolders(true).setSelectFolderEnabled(false);
      const builder = new picker.PickerBuilder()
        .addView(view)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setOrigin(scope.location.origin)
        .setLocale("zh-TW")
        .setCallback((data) => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.PICKED) resolve(data[picker.Response.DOCUMENTS] || []);
          else if (action === picker.Action.CANCEL) reject(new DriveImportCancelled());
        });
      builder.setMaxItems?.(maxFiles);
      builder.build().setVisible(true);
    });
  }

  async function downloadPdf(fileId, token) {
    const headers = { Authorization: "Bearer " + token };
    const fileUrl = DRIVE_FILES_API + encodeURIComponent(fileId);
    const fields = encodeURIComponent("name,mimeType,size,modifiedTime,capabilities(canDownload)");
    const metaResponse = await fetchImpl(`${fileUrl}?fields=${fields}&supportsAllDrives=true`, { headers });
    if (!metaResponse.ok) throw new Error(driveErrorMessage(metaResponse.status));
    const meta = await metaResponse.json();
    if (meta.mimeType !== PDF_MIME) throw new Error("只能匯入 PDF。");
    if (Number(meta.size) > MAX_PDF_BYTES) throw new Error("PDF 不可大於 8 MB。");
    if (meta.capabilities?.canDownload === false) throw new Error("檔案擁有者不允許下載這份 PDF。");
    const response = await fetchImpl(`${fileUrl}?alt=media&supportsAllDrives=true`, { headers });
    if (!response.ok) throw new Error(driveErrorMessage(response.status));
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) throw new Error("PDF 不可大於 8 MB。");
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("這個檔案不是有效的 PDF。");
    return new File([bytes], pdfFilename(meta.name), { type: PDF_MIME, lastModified: Date.parse(meta.modifiedTime) || 0 });
  }

  // Resolves to the picked PDFs as ordinary File objects; a failed file does not stop the others.
  async function importPdfs({ maxFiles }) {
    await prepare();
    const token = await requestToken();
    const { Document } = scope.google.picker;
    const picked = await openPicker(token, maxFiles);
    const files = [], errors = [];
    if (picked.length > maxFiles) errors.push(`最多再加入 ${maxFiles} 份 PDF，其餘未匯入。`);
    for (const doc of picked.slice(0, maxFiles)) {
      try { files.push(await downloadPdf(doc[Document.ID], token)); }
      catch (error) { errors.push(`${doc[Document.NAME] || "所選檔案"}：${error.message}`); }
    }
    return { files, errors };
  }

  return { prepare, importPdfs };
}
