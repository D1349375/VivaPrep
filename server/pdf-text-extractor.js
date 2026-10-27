import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { AgentError } from "./agent-provider.js";

const maxPages = 100;
const maxExtractedCharacters = 84_000;
// Some PDF fonts map common characters to Kangxi / CJK radical code points (⾼ for 高) and
// emit a space after each glyph. Map only those blocks; full NFKC would also turn ，。 into ASCII.
const radicalPattern = /[⺀-⻿⼀-⿟]/gu;
const cjk = "\\u3000-\\u303F\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF";
const spaceBetweenCjk = new RegExp(`(?<=[${cjk}]) +(?=[${cjk}])`, "gu");

export function normalizeExtractedText(text) {
  return text.replace(radicalPattern, (ch) => ch.normalize("NFKC")).replace(spaceBetweenCjk, "");
}

export async function extractPdfTextPages(pdfBuffer) {
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      isEvalSupported: false,
      useSystemFonts: true,
      stopAtErrors: true,
      enableXfa: false,
    });
    const document = await loadingTask.promise;
    if (document.numPages > maxPages) {
      throw new AgentError("PDF_TOO_MANY_PAGES", `這份 PDF 有 ${document.numPages} 頁；目前單次最多處理 ${maxPages} 頁。`, 413);
    }

    const pages = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ includeMarkedContent: false });
        const pieces = [];
        for (const item of content.items) {
          if (typeof item?.str !== "string" || !item.str) continue;
          pieces.push(item.str);
          pieces.push(item.hasEOL ? "\n" : " ");
        }
        const text = normalizeExtractedText(pieces.join(""))
          .replace(/[\t ]+\n/gu, "\n")
          .replace(/\n{3,}/gu, "\n\n")
          .trim();
        if (text) {
          characterCount += text.length;
          if (characterCount > maxExtractedCharacters) {
            throw new AgentError("PDF_TEXT_TOO_LARGE", "這份 PDF 可擷取文字超過目前單次處理上限，請拆成較小的文件再試。", 413);
          }
          pages.push({ pageNumber, text });
        }
      } finally {
        page.cleanup();
      }
    }

    if (!pages.length) {
      throw new AgentError("PDF_NO_TEXT", "這份 PDF 沒有可擷取的文字，可能是掃描影像。請先對文件做 OCR，或手動新增備審主張。", 422);
    }
    return pages;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    if (/password|encrypt/i.test(String(error?.name || "") + " " + String(error?.message || ""))) {
      throw new AgentError("PDF_ENCRYPTED", "這份 PDF 受到密碼保護，請解除保護後再試。", 422);
    }
    throw new AgentError("PDF_TEXT_EXTRACTION_FAILED", "無法從這份 PDF 擷取文字。請確認檔案未損毀；掃描影像 PDF 需先做 OCR。", 422);
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
