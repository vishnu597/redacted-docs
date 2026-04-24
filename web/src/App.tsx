import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  AlertCircle,
  Download,
  FileBadge2,
  FileScan,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react"

import "./App.css"
import { DocumentPreview } from "@/components/document-preview"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type {
  DetectedSpan,
  ProcessingStage,
  ProcessingState,
  RedactionResult,
} from "@/types"

const SUPPORTED_EXTENSIONS = [".pdf", ".docx"]

const STAGE_LABELS: Record<ProcessingStage, string> = {
  idle: "Waiting",
  "loading-model": "Loading model",
  "extracting-text": "Extracting text",
  "detecting-pii": "Detecting PII",
  "assembling-document": "Building output",
  completed: "Ready",
  failed: "Failed",
}

const STAGE_PROGRESS: Record<ProcessingStage, number> = {
  idle: 0,
  "loading-model": 18,
  "extracting-text": 36,
  "detecting-pii": 72,
  "assembling-document": 90,
  completed: 100,
  failed: 100,
}

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [result, setResult] = useState<RedactionResult | null>(null)
  const [processingState, setProcessingState] = useState<ProcessingState>({
    stage: "idle",
    message: "Load a PDF or DOCX to start local redaction.",
  })
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const spans = useMemo<DetectedSpan[]>(
    () => result?.summary.spans ?? [],
    [result?.summary.spans],
  )

  const labelEntries = useMemo(
    () => Object.entries(result?.summary.by_label ?? {}),
    [result?.summary.by_label],
  )

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  function replacePreviewUrl(nextUrl: string | null) {
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current)
      }
      return nextUrl
    })
  }

  async function beginUpload(file: File) {
    if (!SUPPORTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      setError("Only PDF and DOCX files are supported.")
      return
    }

    setProcessing(true)
    setSelectedFileName(file.name)
    setError(null)
    setResult(null)
    replacePreviewUrl(null)
    setProcessingState({
      stage: "loading-model",
      message: "Loading the privacy filter model in your browser.",
    })

    try {
      const { redactDocument } = await import("@/lib/redact")
      const nextResult = await redactDocument(file, (nextState) => {
        setProcessingState(nextState)
      })

      setResult(nextResult)
      replacePreviewUrl(nextResult.preview_url)
      setProcessingState({
        stage: "completed",
        message:
          nextResult.model.device === "webgpu"
            ? "Redaction complete. The model ran locally with WebGPU."
            : "Redaction complete. The model ran locally with WASM.",
      })
    } catch (uploadError) {
      setProcessingState({
        stage: "failed",
        message: "Processing stopped.",
      })
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Redaction failed. Try again.",
      )
    } finally {
      setProcessing(false)
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (nextFile) {
      void beginUpload(nextFile)
    }
    event.target.value = ""
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    const nextFile = event.dataTransfer.files?.[0]
    if (nextFile) {
      void beginUpload(nextFile)
    }
  }

  function openPicker() {
    fileInputRef.current?.click()
  }

  const stage = processingState.stage
  const downloadUrl = result?.download_url ?? null

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(91,80,255,0.12),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(246,247,251,0.96))] text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:py-10">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-background/90 px-6 py-8 shadow-[0_24px_80px_rgba(38,45,67,0.08)] backdrop-blur xl:px-10">
          <div className="hero-orb hero-orb-left" />
          <div className="hero-orb hero-orb-right" />
          <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] xl:items-end">
            <div className="space-y-5">
              <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1">
                <Sparkles className="size-3.5" />
                OpenAI Privacy Filter + Transformers.js
              </Badge>
              <div className="space-y-3">
                <h1 className="max-w-3xl font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
                  Redact sensitive text in PDF and Word documents directly in
                  your browser.
                </h1>
                <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
                  Upload a file, run OpenAI&apos;s privacy filter model locally
                  with Transformers.js, preview the masked output, and download
                  a redacted copy.
                </p>
              </div>
            </div>
            <Card className="border-white/70 bg-white/80 shadow-none">
              <CardHeader>
                <CardTitle>What this version supports</CardTitle>
                <CardDescription>
                  Browser-only redaction with cached model downloads.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3">
                  <ScanSearch className="mt-0.5 size-4 text-primary" />
                  <p>Local PDF text extraction plus downloadable masked PDF output.</p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3">
                  <FileBadge2 className="mt-0.5 size-4 text-primary" />
                  <p>DOCX redaction for paragraphs, tables, headers, and footers.</p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-muted/60 p-3">
                  <ShieldAlert className="mt-0.5 size-4 text-primary" />
                  <p>Model files are downloaded once and then reused from browser cache.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
          <div className="flex flex-col gap-6">
            <Card className="border-white/70 bg-background/90 shadow-[0_20px_60px_rgba(42,46,68,0.08)]">
              <CardHeader>
                <CardTitle>Upload a document</CardTitle>
                <CardDescription>
                  Drag in a file or browse for a PDF or DOCX to process locally.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault()
                    setIsDragging(false)
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  className={cn(
                    "dropzone-surface relative flex min-h-64 flex-col items-center justify-center gap-4 overflow-hidden rounded-[1.75rem] border border-dashed border-border px-6 py-10 text-center transition-all",
                    isDragging && "border-primary bg-primary/6 shadow-[inset_0_0_0_1px_rgba(87,82,255,0.15)]",
                  )}
                >
                  <div className="flex size-16 items-center justify-center rounded-[1.35rem] bg-primary/12 text-primary shadow-inner">
                    <Upload className="size-7" />
                  </div>
                  <div className="space-y-2">
                    <p className="font-heading text-2xl font-semibold">
                      Drop a document to redact
                    </p>
                    <p className="max-w-xl text-sm text-muted-foreground">
                      The browser downloads the model once, runs detection
                      locally, and builds a previewable redacted output without a
                      server round trip.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button onClick={openPicker} disabled={processing}>
                      {processing ? "Processing..." : "Choose file"}
                    </Button>
                    <Badge variant="outline" className="rounded-full px-3 py-1">
                      PDF + DOCX
                    </Badge>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={handleInputChange}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <MetricCard
                    label="Latest upload"
                    value={selectedFileName ?? "None yet"}
                    icon={<FileScan className="size-4" />}
                  />
                  <MetricCard
                    label="Status"
                    value={STAGE_LABELS[stage]}
                    icon={<Sparkles className="size-4" />}
                  />
                  <MetricCard
                    label="Detected spans"
                    value={result?.summary.span_count?.toString() ?? "0"}
                    icon={<ShieldAlert className="size-4" />}
                  />
                </div>

                <div className="space-y-3 rounded-[1.25rem] border border-border/70 bg-muted/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Processing progress</p>
                      <p className="text-sm text-muted-foreground">
                        {processingState.message}
                      </p>
                    </div>
                    <Badge>{STAGE_LABELS[stage]}</Badge>
                  </div>
                  <Progress value={STAGE_PROGRESS[stage]} className="h-2" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/70 bg-background/90 shadow-[0_20px_60px_rgba(42,46,68,0.08)]">
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Redacted preview</CardTitle>
                    <CardDescription>
                      Preview the locally generated redacted file before downloading it.
                    </CardDescription>
                  </div>
                  {downloadUrl ? (
                    <Button asChild>
                      <a href={downloadUrl} download={result?.output_name}>
                        <Download className="size-4" />
                        Download redacted file
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <DocumentPreview
                  fileType={result?.file_type ?? null}
                  previewUrl={previewUrl}
                  loading={processing}
                />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card className="border-white/70 bg-background/90 shadow-[0_20px_60px_rgba(42,46,68,0.08)]">
              <CardHeader>
                <CardTitle>Detection summary</CardTitle>
                <CardDescription>
                  The app keeps typed spans for review while the exported
                  document stays in black-box mode.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {labelEntries.length ? (
                    labelEntries.map(([label, count]) => (
                      <Badge key={label} variant="secondary" className="rounded-full px-3 py-1">
                        {humanizeLabel(label)} · {count}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Label counts will appear here after processing.
                    </p>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Detected spans</p>
                    <Badge variant="outline" className="rounded-full px-3 py-1">
                      {spans.length}
                    </Badge>
                  </div>
                  <ScrollArea className="h-[22rem] pr-4">
                    <div className="space-y-3">
                      {spans.length ? (
                        spans.map((span, index) => (
                          <div
                            key={`${span.label}-${span.start}-${span.end}-${index}`}
                            className="rounded-[1.15rem] border border-border/70 bg-muted/35 p-4"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <Badge variant="outline">{humanizeLabel(span.label)}</Badge>
                              <span className="text-xs text-muted-foreground">
                                {span.placeholder}
                              </span>
                            </div>
                            <p className="text-sm font-medium leading-6 text-foreground">
                              {span.text || "(content masked)"}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[1.25rem] border border-dashed border-border/80 p-5 text-sm text-muted-foreground">
                          No spans to show yet.
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>

            <Alert>
              <ShieldAlert className="size-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                This app is a redaction aid. Review the preview before sharing
                output, especially for scanned PDFs, complex Word layouts,
                documents with embedded shapes or comments, and PDF files where
                visual masking may not fully remove the underlying text layer.
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </main>
  )
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-[1.35rem] border border-border/70 bg-muted/35 p-4">
      <div className="mb-3 flex size-10 items-center justify-center rounded-2xl bg-background text-primary shadow-xs">
        {icon}
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-heading text-lg font-semibold">{value}</p>
    </div>
  )
}

function humanizeLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export default App
