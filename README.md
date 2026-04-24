# Privacy Filter Redactor

A simple document redaction web app built with:

- React + Vite
- shadcn/ui with preset `b67f2r1cyO`
- Transformers.js
- PDF.js + PDF-Lib
- JSZip
- OpenAI's `openai/privacy-filter` model

The app accepts `.pdf` and `.docx` files, detects PII, produces a redacted document, previews it in the browser, and lets the user download the result.

## Project Layout

- `web/`: React frontend and browser-side redaction pipeline
- `api/`: legacy FastAPI prototype retained from the earlier server-side approach

## Frontend Setup

```bash
cd web
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173`.

## Notes

- PDF support is limited to text-based PDFs in v1. Scanned or image-only PDFs are rejected.
- DOCX support covers body content, tables, headers, and footers.
- The first run downloads the model files into browser cache, so it can take a while.
- The app prefers `WebGPU` when available and falls back to `WASM`.
- The current browser PDF flow derives redaction rectangles from PDF.js text geometry and draws black masks over detected text regions. Review PDFs carefully before sharing if permanent removal of the underlying text layer is required.
