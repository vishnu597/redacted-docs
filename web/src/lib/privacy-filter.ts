import { env, pipeline } from "@huggingface/transformers"

import type { DetectedSpan, ModelStatus } from "@/types"

env.allowLocalModels = false

type ProgressCallback = (message: string) => void

type TokenClassificationResult = {
  entity_group?: string
  score?: number
  start?: number
  end?: number
  word?: string
}

type Classifier = (
  input: string,
  options: { aggregation_strategy: "simple" },
) => Promise<TokenClassificationResult[]>

let classifierPromise: Promise<Classifier> | null = null
let modelStatusPromise: Promise<ModelStatus> | null = null

export async function getPrivacyFilter(
  onProgress?: ProgressCallback,
): Promise<{ classifier: Classifier; model: ModelStatus }> {
  if (!classifierPromise || !modelStatusPromise) {
    const device: ModelStatus["device"] = navigator.gpu ? "webgpu" : "wasm"
    const dtype: ModelStatus["dtype"] = device === "webgpu" ? "q4" : "q8"

    modelStatusPromise = Promise.resolve({ device, dtype })
    classifierPromise = pipeline("token-classification", "openai/privacy-filter", {
      device,
      dtype,
      progress_callback(progress: unknown) {
        const message =
          typeof progress === "object" &&
          progress !== null &&
          "status" in progress &&
          typeof progress.status === "string"
            ? progress.status
            : "Downloading model files"

        onProgress?.(message)
      },
    }) as Promise<Classifier>
  }

  const [classifier, model] = await Promise.all([
    classifierPromise,
    modelStatusPromise,
  ])

  return { classifier, model }
}

export async function detectSensitiveSpans(
  text: string,
  classifier: Classifier,
  onWindow?: (index: number, total: number) => void,
): Promise<DetectedSpan[]> {
  if (!text.trim()) {
    return []
  }

  const windows = chunkText(text)
  const spans: DetectedSpan[] = []
  const seen = new Set<string>()

  for (const [index, window] of windows.entries()) {
    onWindow?.(index + 1, windows.length)
    const results = await classifier(window.text, {
      aggregation_strategy: "simple",
    })
    let searchCursor = 0

    for (const result of results) {
      if (!result.entity_group) {
        continue
      }

      const resolved = resolveRange(result, window.text, searchCursor)
      if (!resolved) {
        continue
      }

      searchCursor = resolved.end
      const start = resolved.start + window.start
      const end = resolved.end + window.start
      const signature = `${result.entity_group}:${start}:${end}`
      if (seen.has(signature)) {
        continue
      }
      seen.add(signature)

      spans.push({
        label: result.entity_group,
        start,
        end,
        text: text.slice(start, end),
        placeholder: placeholderForLabel(result.entity_group),
        score: result.score ?? null,
      })
    }
  }

  return mergeSpans(spans)
}

function resolveRange(
  result: TokenClassificationResult,
  windowText: string,
  searchCursor: number,
) {
  if (typeof result.start === "number" && typeof result.end === "number") {
    return { start: result.start, end: result.end }
  }

  if (!result.word) {
    return null
  }

  const candidates = buildSearchCandidates(result.word)

  for (const candidate of candidates) {
    const nextIndex = windowText.indexOf(candidate, searchCursor)
    if (nextIndex !== -1) {
      return {
        start: nextIndex,
        end: nextIndex + candidate.length,
      }
    }
  }

  for (const candidate of candidates) {
    const nextIndex = windowText.indexOf(candidate)
    if (nextIndex !== -1) {
      return {
        start: nextIndex,
        end: nextIndex + candidate.length,
      }
    }
  }

  return null
}

function buildSearchCandidates(word: string) {
  const normalized = word.replace(/\s+/g, " ")
  const stripped = normalized.trim()
  const tokenized = stripped
    .replace(/^[▁Ġ]+/u, "")
    .replace(/[▁Ġ]+/gu, " ")

  return Array.from(
    new Set(
      [word, normalized, stripped, tokenized, tokenized.trim()]
        .map((value) => value.normalize("NFKC"))
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length)
}

function chunkText(text: string, size = 4000, overlap = 250) {
  if (text.length <= size) {
    return [{ start: 0, text }]
  }

  const chunks: Array<{ start: number; text: string }> = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(text.length, start + size)
    if (end < text.length) {
      while (end > start + size / 2 && !/\s/.test(text[end - 1] ?? "")) {
        end -= 1
      }
      if (end <= start) {
        end = Math.min(text.length, start + size)
      }
    }

    chunks.push({ start, text: text.slice(start, end) })
    if (end >= text.length) {
      break
    }

    start = Math.max(0, end - overlap)
  }

  return chunks
}

function mergeSpans(spans: DetectedSpan[]) {
  const sorted = [...spans].sort((left, right) => left.start - right.start)
  const merged: DetectedSpan[] = []

  for (const span of sorted) {
    const previous = merged.at(-1)
    if (
      previous &&
      span.label === previous.label &&
      span.start <= previous.end
    ) {
      previous.end = Math.max(previous.end, span.end)
      previous.text =
        previous.text.length >= span.text.length ? previous.text : span.text
      previous.score = Math.max(previous.score ?? 0, span.score ?? 0)
      continue
    }

    merged.push({ ...span })
  }

  return merged
}

function placeholderForLabel(label: string) {
  switch (label) {
    case "account_number":
      return "<ACCOUNT_NUMBER>"
    case "private_address":
      return "<PRIVATE_ADDRESS>"
    case "private_email":
      return "<PRIVATE_EMAIL>"
    case "private_person":
      return "<PRIVATE_PERSON>"
    case "private_phone":
      return "<PRIVATE_PHONE>"
    case "private_url":
      return "<PRIVATE_URL>"
    case "private_date":
      return "<PRIVATE_DATE>"
    case "secret":
      return "<SECRET>"
    default:
      return "<REDACTED>"
  }
}
