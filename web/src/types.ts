export type DocumentType = "pdf" | "docx"
export type ProcessingStage =
  | "idle"
  | "loading-model"
  | "extracting-text"
  | "detecting-pii"
  | "assembling-document"
  | "completed"
  | "failed"

export interface DetectedSpan {
  label: string
  start: number
  end: number
  text: string
  placeholder: string
  score?: number | null
}

export interface RedactionSummary {
  span_count: number
  by_label: Record<string, number>
  spans: DetectedSpan[]
}

export interface ModelStatus {
  device: "webgpu" | "wasm"
  dtype: "q4" | "q8"
}

export interface RedactionResult {
  file_type: DocumentType
  original_name: string
  output_name: string
  preview_url: string
  download_url: string
  summary: RedactionSummary
  model: ModelStatus
}

export interface ProcessingState {
  stage: ProcessingStage
  message: string
}
