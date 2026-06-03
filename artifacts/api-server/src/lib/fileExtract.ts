/**
 * Best-effort text extraction for uploaded files.
 *
 * Supported MIME types / extensions:
 *   - application/pdf   → pdf-parse
 *   - .docx             → mammoth
 *   - .vtt / .srt / .txt → naive UTF-8 decode + cleanup
 *
 * Anything else → throws. We never store the raw bytes — only the text.
 */

import mammoth from "mammoth";

/** Strip WebVTT/SRT cue numbers and timestamps so the transcript text
 *  reads as clean prose for Gemini. */
function cleanTranscript(raw: string): string {
  return raw
    // Remove WEBVTT header
    .replace(/^WEBVTT.*$/m, "")
    // Remove timestamp lines like "00:00:00.000 --> 00:00:05.000"
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*$/gm, "")
    // Remove standalone cue numbers (a line with just digits)
    .replace(/^\d+\s*$/gm, "")
    // Collapse multiple newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract text from a buffer based on filename. Returns the plain-text body.
 * Throws on unsupported format or extraction failure.
 */
export async function extractTextFromUpload(filename: string, buffer: Buffer): Promise<string> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    // pdf-parse v2 exposes a PDFParse class (not a default function as in v1).
    // We import dynamically to avoid loading the heavy PDF.js worker at
    // module-load time — only when a PDF actually needs parsing.
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return (result.text ?? "").trim();
    } finally {
      // Always release the underlying PDF.js document to free memory.
      await parser.destroy().catch(() => undefined);
    }
  }

  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value ?? "").trim();
  }

  if (lower.endsWith(".vtt") || lower.endsWith(".srt") || lower.endsWith(".txt")) {
    const text = buffer.toString("utf8");
    return cleanTranscript(text);
  }

  // Markdown also acceptable (treat as text).
  if (lower.endsWith(".md")) {
    return buffer.toString("utf8").trim();
  }

  throw new Error(`Unsupported file format: ${filename}. Accepts .pdf, .docx, .vtt, .srt, .txt, .md`);
}
