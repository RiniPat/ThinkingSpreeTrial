// artifacts/api-server/src/lib/pdf-text.ts
//
// ============================================================================
// PDF text extraction — server-side, no Web Worker.
// ============================================================================
//
// THE BUG you were hitting:
//
//   "Setting up fake worker failed: Cannot find module
//    '/opt/render/project/src/artifacts/api-server/dist/pdf.worker.mjs'"
//
// Why it happened: pdf-parse@2.x was rewritten on top of pdfjs-dist's modern
// build, which expects a Web Worker file (`pdf.worker.mjs`) sitting next to
// the main module. When esbuild bundles your api-server into
// `artifacts/api-server/dist/index.mjs`, that worker file does NOT get copied
// into `dist/`. So at runtime pdfjs tries to load it, fails, throws.
//
// The fix: use pdfjs-dist's `legacy` build directly with the worker disabled.
// The legacy build runs synchronously on the main thread — perfect for a
// Node API server where we don't want workers anyway.
//
// REPLACEMENT INSTRUCTIONS:
//   1. Wherever your code does `import pdfParse from "pdf-parse"` (probably
//      in artifacts/api-server/src/routes/builder-growth-reports.ts per
//      CHANGES-v5_4.md), change it to:
//          import { extractPdfText } from "../lib/pdf-text.js";
//   2. Replace `const { text } = await pdfParse(buffer)` with
//          const text = await extractPdfText(buffer);
//   3. You can leave pdf-parse in package.json or remove it — your call.
//      pdfjs-dist is already a transitive dep so you don't add anything new.
//
// You no longer need any "copy the worker into dist/" build step. The worker
// is explicitly disabled below.
// ============================================================================

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

// Disable the worker entirely. Required on Node — workers are a browser
// concept. pdfjs runs synchronously on the main thread in legacy mode.
//
// The cast is needed because the .d.ts types expect a string URL; passing
// false is supported at runtime and documented in pdfjs-dist.
(GlobalWorkerOptions as unknown as { workerSrc: unknown }).workerSrc = false;

export type ExtractPdfOptions = {
    /** Hard cap on extracted characters. Default 2,000,000 (~700 pages). */
    maxChars?: number;
    /** If set, stop after this many pages even if more exist. */
    maxPages?: number;
};

/**
 * Extract selectable text from a PDF.
 *
 * Throws if the PDF is image-only (no extractable text). Caller can catch
 * this and surface "Text must be selectable (not scanned image)" — which
 * matches the user-facing message your Builder already shows.
 */
export async function extractPdfText(
    input: Buffer | Uint8Array | ArrayBuffer,
    opts: ExtractPdfOptions = {},
): Promise<string> {
    const { maxChars = 2_000_000, maxPages } = opts;

    // pdfjs wants a Uint8Array. Buffer is one already; coerce ArrayBuffer.
    const data =
        input instanceof Uint8Array
            ? input
            : input instanceof ArrayBuffer
                ? new Uint8Array(input)
                : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

    const loadingTask = getDocument({
        data,
        // Don't fetch fonts/cmaps over the network — the bundle ships its own.
        useSystemFonts: true,
        // Quieter logs in production.
        verbosity: 0,
    });

    const pdf = await loadingTask.promise;
    const pageCount = maxPages ? Math.min(pdf.numPages, maxPages) : pdf.numPages;

    const chunks: string[] = [];
    let totalChars = 0;

    for (let p = 1; p <= pageCount; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();

        // Reassemble text. pdfjs gives us positioned text fragments; we
        // join with spaces and insert a newline at the end of each page.
        const pageText = content.items
            .map((item) => (typeof (item as { str?: string }).str === "string" ? (item as { str: string }).str : ""))
            .join(" ")
            .replace(/\s+\n/g, "\n")
            .replace(/[ \t]+/g, " ")
            .trim();

        chunks.push(pageText);
        totalChars += pageText.length;

        // Release page resources promptly — long PDFs can otherwise pin
        // hundreds of MB.
        page.cleanup();

        if (totalChars >= maxChars) break;
    }

    await pdf.destroy();

    const out = chunks.join("\n\n").slice(0, maxChars).trim();

    if (out.length < 20) {
        // PDFs that are 100% scanned images return ~empty text. Tell the
        // caller in a way the Builder UI can show without surprising the user.
        throw new Error(
            "PDF contains no selectable text. Looks like a scanned image — re-export it as a text PDF or run OCR first.",
        );
    }

    return out;
}
