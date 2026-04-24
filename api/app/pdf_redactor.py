from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .detector import PrivacyFilterDetector
from .schemas import DetectedSpan, RedactionSummary
from .utils import UnsupportedDocumentError, build_summary, clamp_excerpt

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover - fallback for older PyMuPDF installs
    import fitz  # type: ignore[no-redef]


@dataclass(frozen=True)
class PdfWord:
    page_index: int
    start: int
    end: int
    rect: tuple[float, float, float, float]
    text: str


def redact_pdf(
    input_path: Path,
    output_path: Path,
    detector: PrivacyFilterDetector,
) -> RedactionSummary:
    document = fitz.open(input_path)
    try:
        text, words = extract_pdf_words(document)
        if not text.strip() or not words:
            raise UnsupportedDocumentError(
                "This PDF does not expose extractable text. Scanned or image-only PDFs are not supported in v1."
            )

        spans = detector.detect(text)
        apply_pdf_redactions(document, words, spans)
        document.save(output_path, garbage=4, clean=True, deflate=True)
        return build_summary(
            [
                span.model_copy(update={"text": clamp_excerpt(span.text)})
                for span in spans
            ]
        )
    finally:
        document.close()


def extract_pdf_words(document: "fitz.Document") -> tuple[str, list[PdfWord]]:
    parts: list[str] = []
    words_out: list[PdfWord] = []
    cursor = 0

    for page_index, page in enumerate(document):
        page_words = page.get_text("words", sort=True)
        if not page_words:
            continue

        active_line: tuple[int, int] | None = None
        line_has_word = False

        for word in page_words:
            line_key = (int(word[5]), int(word[6]))
            if active_line is None:
                active_line = line_key
            elif line_key != active_line:
                parts.append("\n")
                cursor += 1
                active_line = line_key
                line_has_word = False

            if line_has_word:
                parts.append(" ")
                cursor += 1

            value = str(word[4])
            start = cursor
            parts.append(value)
            cursor += len(value)
            end = cursor
            line_has_word = True

            words_out.append(
                PdfWord(
                    page_index=page_index,
                    start=start,
                    end=end,
                    rect=(float(word[0]), float(word[1]), float(word[2]), float(word[3])),
                    text=value,
                )
            )

        parts.append("\n\n")
        cursor += 2

    return "".join(parts), words_out


def apply_pdf_redactions(
    document: "fitz.Document",
    words: list[PdfWord],
    spans: list[DetectedSpan],
) -> None:
    rects_by_page: dict[int, set[tuple[float, float, float, float]]] = defaultdict(set)

    for span in spans:
        for word in words:
            if word.end <= span.start or word.start >= span.end:
                continue
            rects_by_page[word.page_index].add(expand_rect(word.rect))

    for page_index, rects in rects_by_page.items():
        page = document[page_index]
        for rect in rects:
            page.add_redact_annot(rect, fill=(0, 0, 0), cross_out=False)
        page.apply_redactions(images=2, graphics=0, text=0)


def expand_rect(
    rect: tuple[float, float, float, float],
    margin: float = 0.75,
) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = rect
    return (x0 - margin, y0 - margin, x1 + margin, y1 + margin)

