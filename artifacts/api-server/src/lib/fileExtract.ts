/**
 * Best-effort text extraction for uploaded files.
 *
 * Supported MIME types / extensions:
 *   - application/pdf   → unpdf (serverless pdf.js, no DOM needed)
 *   - .docx             → mammoth
 *   - .vtt / .srt / .txt → naive UTF-8 decode + cleanup
 *
 * Anything else → throws. We never store the raw bytes — only the text.
 */

import mammoth from "mammoth";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * OCR a PDF (or image) by handing the raw bytes to Gemini's multimodal model
 * and asking it to transcribe the text. Used as a fallback for image-only /
 * scanned PDFs that have no selectable text layer (so unpdf returns nothing).
 * Returns "" if Gemini isn't configured or finds no text.
 */
async function ocrWithGemini(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return "";
  // Gemini inline data has a request-size ceiling (~20MB incl. encoding); skip
  // very large files rather than erroring.
  if (buffer.byteLength > 14 * 1024 * 1024) return "";
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent([
    { inlineData: { mimeType, data: buffer.toString("base64") } },
    { text: "Transcribe ALL text content from this document, preserving the reading order and structure (headings, bullets, tables as text). Output only the transcribed text with no commentary, labels, or markdown fences." },
  ]);
  return (result.response.text() ?? "").trim();
}

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
    // Use `unpdf` — a serverless/Node-safe build of pdf.js. The default
    // `pdf-parse`/`pdfjs-dist` browser build references DOM globals (DOMMatrix,
    // Path2D, ImageData) that don't exist under Node and throws
    // "DOMMatrix is not defined" on upload. unpdf ships a build that runs in
    // plain Node with no DOM, canvas, or worker setup.
    //
    // Imported dynamically so the (large) pdf.js bundle only loads when a PDF
    // is actually parsed.
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    let out = (Array.isArray(text) ? text.join("\n\n") : text ?? "").trim();
    // Image-only / scanned PDF → no text layer. Fall back to OCR via Gemini so
    // these still work (e.g. a Strategic Canvas exported as an image PDF).
    if (out.length < 20) {
      const ocr = await ocrWithGemini(buffer, "application/pdf");
      if (ocr.length > out.length) out = ocr;
    }
    return out.trim();
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
