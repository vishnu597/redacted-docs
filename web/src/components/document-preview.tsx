import { useEffect, useRef, useState } from "react"
import { FileText, LoaderCircle } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import type { DocumentType } from "@/types"

interface DocumentPreviewProps {
  fileType: DocumentType | null
  previewUrl: string | null
  loading: boolean
}

export function DocumentPreview({
  fileType,
  previewUrl,
  loading,
}: DocumentPreviewProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null)
  const [docxError, setDocxError] = useState<string | null>(null)

  useEffect(() => {
    if (fileType !== "docx" || !previewUrl || !docxContainerRef.current) {
      return
    }

    let disposed = false
    const container = docxContainerRef.current
    container.innerHTML = ""
    setDocxError(null)

    void (async () => {
      try {
        const previewBlob = await fetch(previewUrl).then((response) => {
          if (!response.ok) {
            throw new Error("Failed to load the redacted DOCX preview.")
          }
          return response.blob()
        })

        if (disposed) {
          return
        }

        const { renderAsync } = await import("docx-preview")
        await renderAsync(previewBlob, container, container, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          useBase64URL: true,
          ignoreLastRenderedPageBreak: true,
        })
      } catch (error) {
        if (!disposed) {
          setDocxError(
            error instanceof Error ? error.message : "Failed to render the DOCX preview.",
          )
        }
      }
    })()

    return () => {
      disposed = true
      container.innerHTML = ""
    }
  }, [fileType, previewUrl])

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-40 rounded-full" />
        <Skeleton className="h-[36rem] w-full rounded-[1.75rem]" />
      </div>
    )
  }

  if (!previewUrl || !fileType) {
    return (
      <div className="flex min-h-[36rem] flex-col items-center justify-center gap-4 rounded-[1.75rem] border border-dashed border-border/80 bg-muted/40 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <FileText className="size-7" />
        </div>
        <div className="space-y-2">
          <p className="font-heading text-xl font-semibold">Preview appears here</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Upload a PDF or DOCX to generate a redacted version with the privacy
            filter model.
          </p>
        </div>
      </div>
    )
  }

  if (fileType === "pdf") {
    return (
      <iframe
        className="preview-frame"
        src={previewUrl}
        title="Redacted PDF preview"
      />
    )
  }

  return (
    <div className="docx-preview-surface">
      {docxError ? (
        <div className="flex min-h-[36rem] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin text-primary" />
          <p>{docxError}</p>
        </div>
      ) : (
        <div ref={docxContainerRef} className="min-h-[36rem]" />
      )}
    </div>
  )
}
