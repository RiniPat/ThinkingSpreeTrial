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
    // pdf-parse v2 bundles pdfjs-dist's web build, which uses DOMMatrix,
    // ImageData, and Path2D at runtime. On a stock Node server (like Render
    // without native canvas), these are undefined and the parser throws
    // "DOMMatrix is not defined" before extracting a single character.
    //
    // pdf-parse tries to load @napi-rs/canvas internally, but if that
    // package isn't installed (or fails to build on the host), the
    // polyfill silently fails. We do the polyfill ourselves: try the
    // native package first, then fall back to no-op stubs that are
    // sufficient for text extraction (text extraction never actually
    // rasterizes anything, so the math operations on DOMMatrix go
    // unused — what matters is that the constructor doesn't throw).
    await ensurePdfGlobals();

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

// --- DOMMatrix / ImageData / Path2D polyfill ---------------------------------
//
// Idempotent: once we've installed globals (real or stubbed), we don't try
// again. Runs at most once per process.
let pdfGlobalsReady: Promise<void> | null = null;

function ensurePdfGlobals(): Promise<void> {
  if (pdfGlobalsReady) return pdfGlobalsReady;
  pdfGlobalsReady = (async () => {
    const g = globalThis as any;
    if (g.DOMMatrix && g.ImageData && g.Path2D) return;

    // Prefer the real native implementations from @napi-rs/canvas if
    // installed — they support full matrix math, which matters if anything
    // downstream of getText() (rare) actually computes transforms.
    try {
      const canvas: any = await import("@napi-rs/canvas").catch(() => null);
      if (canvas?.DOMMatrix) g.DOMMatrix ??= canvas.DOMMatrix;
      if (canvas?.ImageData) g.ImageData ??= canvas.ImageData;
      if (canvas?.Path2D) g.Path2D ??= canvas.Path2D;
    } catch {
      // ignore — fall through to manual stubs below
    }

    // If anything is still missing, install minimal stubs. Text extraction
    // doesn't actually invoke matrix math on these — it just needs the
    // constructors to exist so pdf-parse's module-load doesn't crash.
    if (!g.DOMMatrix) {
      class DOMMatrixStub {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        m11 = 1; m12 = 0; m13 = 0; m14 = 0;
        m21 = 0; m22 = 1; m23 = 0; m24 = 0;
        m31 = 0; m32 = 0; m33 = 1; m34 = 0;
        m41 = 0; m42 = 0; m43 = 0; m44 = 1;
        is2D = true;
        isIdentity = true;
        constructor(init?: any) {
          if (Array.isArray(init) && init.length === 6) {
            this.a = this.m11 = init[0];
            this.b = this.m12 = init[1];
            this.c = this.m21 = init[2];
            this.d = this.m22 = init[3];
            this.e = this.m41 = init[4];
            this.f = this.m42 = init[5];
          }
        }
        multiply() { return new DOMMatrixStub(); }
        multiplySelf() { return this; }
        translate() { return new DOMMatrixStub(); }
        scale() { return new DOMMatrixStub(); }
        rotate() { return new DOMMatrixStub(); }
        invertSelf() { return this; }
        inverse() { return new DOMMatrixStub(); }
      }
      g.DOMMatrix = DOMMatrixStub;
    }
    if (!g.ImageData) {
      class ImageDataStub {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(dataOrWidth: any, widthOrHeight: number, height?: number) {
          if (dataOrWidth instanceof Uint8ClampedArray) {
            this.data = dataOrWidth;
            this.width = widthOrHeight;
            this.height = height ?? dataOrWidth.length / (4 * widthOrHeight);
          } else {
            this.width = dataOrWidth;
            this.height = widthOrHeight;
            this.data = new Uint8ClampedArray(dataOrWidth * widthOrHeight * 4);
          }
        }
      }
      g.ImageData = ImageDataStub;
    }
    if (!g.Path2D) {
      class Path2DStub {
        addPath() {}
        moveTo() {}
        lineTo() {}
        bezierCurveTo() {}
        quadraticCurveTo() {}
        arc() {}
        arcTo() {}
        ellipse() {}
        rect() {}
        roundRect() {}
        closePath() {}
      }
      g.Path2D = Path2DStub;
    }
  })();
  return pdfGlobalsReady;
}
