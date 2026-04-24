import JSZip from "jszip"
import { PDFDocument, rgb } from "pdf-lib"
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist"

import { getTextItemPdfRect, type PdfRect } from "@/lib/pdf-geometry"
import {
  detectSensitiveSpans,
  getPrivacyFilter,
} from "@/lib/privacy-filter"
import type {
  DetectedSpan,
  DocumentType,
  ProcessingState,
  RedactionResult,
  RedactionSummary,
} from "@/types"

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

type StageCallback = (state: ProcessingState) => void

type PdfJsTextItem = {
  str: string
  fontName: string
  hasEOL?: boolean
  width?: number
  height?: number
  transform: number[]
}

type PdfSegment = {
  pageIndex: number
  start: number
  end: number
  rect: PdfRect
  text: string
}

export async function redactDocument(
  file: File,
  onStage?: StageCallback,
): Promise<RedactionResult> {
  const fileType = detectFileType(file.name)

  onStage?.({
    stage: "loading-model",
    message: "Loading the privacy filter model in your browser.",
  })

  const { classifier, model } = await getPrivacyFilter((message) => {
    onStage?.({
      stage: "loading-model",
      message: `Loading the privacy filter model: ${message}.`,
    })
  })

  if (fileType === "pdf") {
    const pdfResult = await redactPdf(file, classifier, onStage)
    return {
      file_type: "pdf",
      original_name: file.name,
      output_name: buildOutputName(file.name),
      model,
      ...pdfResult,
    }
  }

  const docxResult = await redactDocx(file, classifier, onStage)
  return {
    file_type: "docx",
    original_name: file.name,
    output_name: buildOutputName(file.name),
    model,
    ...docxResult,
  }
}

function detectFileType(fileName: string): DocumentType {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".pdf")) {
    return "pdf"
  }
  if (lower.endsWith(".docx")) {
    return "docx"
  }
  throw new Error("Only PDF and DOCX files are supported.")
}

async function redactPdf(
  file: File,
  classifier: Parameters<typeof detectSensitiveSpans>[1],
  onStage?: StageCallback,
) {
  onStage?.({
    stage: "extracting-text",
    message: "Extracting text and layout from the PDF.",
  })

  const sourceBytes = await file.arrayBuffer()
  const pdfJsBytes = new Uint8Array(sourceBytes.slice(0))
  const pdfLibBytes = new Uint8Array(sourceBytes.slice(0))

  const loadingTask = getDocument({ data: pdfJsBytes })
  const pdf = await loadingTask.promise

  const segments: PdfSegment[] = []
  let combinedText = ""

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()

    for (const item of textContent.items) {
      if (!isPdfJsTextItem(item) || !item.str.trim()) {
        continue
      }

      const start = combinedText.length
      combinedText += item.str
      const end = combinedText.length

      const rect = getTextItemPdfRect(
        item,
        textContent.styles[item.fontName] ?? {},
        viewport,
      )

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        combinedText += item.hasEOL ? "\n" : " "
        continue
      }

      segments.push({
        pageIndex: pageNumber - 1,
        start,
        end,
        rect,
        text: item.str,
      })

      combinedText += item.hasEOL ? "\n" : " "
    }
  }

  if (!combinedText.trim() || segments.length === 0) {
    throw new Error(
      "This PDF does not expose extractable text. Scanned or image-only PDFs are not supported in the browser flow.",
    )
  }

  onStage?.({
    stage: "detecting-pii",
    message: "Running the privacy filter model on extracted PDF text.",
  })

  const spans = await detectSensitiveSpans(combinedText, classifier, (index, total) => {
    onStage?.({
      stage: "detecting-pii",
      message: `Running the privacy filter model on extracted PDF text (${index}/${total}).`,
    })
  })

  onStage?.({
    stage: "assembling-document",
    message: "Drawing redaction boxes into a downloadable PDF.",
  })

  const pdfLibDocument = await PDFDocument.load(pdfLibBytes)
  const pageRects = new Map<number, Set<string>>()

  for (const span of spans) {
    for (const segment of segments) {
      if (segment.end <= span.start || segment.start >= span.end) {
        continue
      }

      const signature = buildRectSignature(segment.pageIndex, segment.rect)

      if (!pageRects.has(segment.pageIndex)) {
        pageRects.set(segment.pageIndex, new Set())
      }
      if (pageRects.get(segment.pageIndex)?.has(signature)) {
        continue
      }
      pageRects.get(segment.pageIndex)?.add(signature)

      const page = pdfLibDocument.getPage(segment.pageIndex)
      page.drawRectangle({
        x: segment.rect.x - 0.75,
        y: segment.rect.y - 0.75,
        width: segment.rect.width + 1.5,
        height: segment.rect.height + 1.5,
        color: rgb(0, 0, 0),
        borderWidth: 0,
      })
    }
  }

  const redactedBytes = await pdfLibDocument.save()
  const redactedBlob = new Blob([new Uint8Array(redactedBytes)], {
    type: "application/pdf",
  })

  return {
    preview_url: URL.createObjectURL(redactedBlob),
    download_url: URL.createObjectURL(redactedBlob),
    summary: buildSummary(spans),
  }
}

async function redactDocx(
  file: File,
  classifier: Parameters<typeof detectSensitiveSpans>[1],
  onStage?: StageCallback,
) {
  onStage?.({
    stage: "extracting-text",
    message: "Reading the DOCX package and extracting text nodes.",
  })

  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const xmlEntries = Object.keys(zip.files).filter((path) =>
    /^word\/(document|header\d+|footer\d+)\.xml$/.test(path),
  )

  const allSpans: DetectedSpan[] = []
  let globalOffset = 0

  for (const path of xmlEntries) {
    const fileEntry = zip.file(path)
    if (!fileEntry) {
      continue
    }

    const xmlText = await fileEntry.async("text")
    const parsed = new DOMParser().parseFromString(xmlText, "application/xml")
    const paragraphs = Array.from(parsed.getElementsByTagNameNS(WORD_NAMESPACE, "p"))

    for (const paragraph of paragraphs) {
      const textNodes = Array.from(
        paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "t"),
      )
      if (textNodes.length === 0) {
        continue
      }

      let paragraphText = ""
      const ranges: Array<{ node: Element; start: number; end: number }> = []

      for (const node of textNodes) {
        const value = node.textContent ?? ""
        const start = paragraphText.length
        paragraphText += value
        ranges.push({ node, start, end: paragraphText.length })
      }

      if (!paragraphText.trim()) {
        globalOffset += paragraphText.length + 2
        continue
      }

      onStage?.({
        stage: "detecting-pii",
        message: "Running the privacy filter model on DOCX text.",
      })

      const spans = await detectSensitiveSpans(paragraphText, classifier)
      if (spans.length === 0) {
        globalOffset += paragraphText.length + 2
        continue
      }

      const redactedParagraph = applyRedactionsToText(paragraphText, spans)
      for (const range of ranges) {
        const nextValue = redactedParagraph.slice(range.start, range.end)
        range.node.textContent = nextValue
        if (/^\s|\s$/.test(nextValue)) {
          range.node.setAttribute("xml:space", "preserve")
        }
      }

      allSpans.push(
        ...spans.map((span) => ({
          ...span,
          start: span.start + globalOffset,
          end: span.end + globalOffset,
        })),
      )
      globalOffset += paragraphText.length + 2
    }

    const serialized = new XMLSerializer().serializeToString(parsed)
    zip.file(path, serialized)
  }

  onStage?.({
    stage: "assembling-document",
    message: "Packaging the redacted DOCX for preview and download.",
  })

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  })

  return {
    preview_url: URL.createObjectURL(blob),
    download_url: URL.createObjectURL(blob),
    summary: buildSummary(allSpans),
  }
}

function applyRedactionsToText(text: string, spans: DetectedSpan[]) {
  if (spans.length === 0) {
    return text
  }

  const chars = [...text]
  for (const span of spans) {
    for (let index = span.start; index < span.end; index += 1) {
      if (chars[index] && !/\s/.test(chars[index])) {
        chars[index] = "█"
      }
    }
  }
  return chars.join("")
}

function buildSummary(spans: DetectedSpan[]): RedactionSummary {
  const byLabel: Record<string, number> = {}
  for (const span of spans) {
    byLabel[span.label] = (byLabel[span.label] ?? 0) + 1
  }

  return {
    span_count: spans.length,
    by_label: byLabel,
    spans: spans.slice(0, 200).map((span) => ({
      ...span,
      text: clampText(span.text),
    })),
  }
}

function buildOutputName(fileName: string) {
  const index = fileName.lastIndexOf(".")
  if (index === -1) {
    return `${fileName}.redacted`
  }
  return `${fileName.slice(0, index)}.redacted${fileName.slice(index)}`
}

function clampText(text: string, maxLength = 120) {
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= maxLength) {
    return compact
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`
}

function isPdfJsTextItem(value: unknown): value is PdfJsTextItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "str" in value &&
    typeof value.str === "string" &&
    "fontName" in value &&
    typeof value.fontName === "string" &&
    "transform" in value &&
    Array.isArray(value.transform)
  )
}

function buildRectSignature(pageIndex: number, rect: PdfRect) {
  return [
    pageIndex,
    Math.round(rect.x * 100),
    Math.round(rect.y * 100),
    Math.round(rect.width * 100),
    Math.round(rect.height * 100),
  ].join(":")
}
