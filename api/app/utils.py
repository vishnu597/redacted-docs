from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Iterable

from .schemas import DetectedSpan, DocumentType, RedactionSummary


class UnsupportedDocumentError(RuntimeError):
    """Raised when a file cannot be processed by the current v1 pipeline."""


MIME_TYPES: dict[DocumentType, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


PLACEHOLDERS = {
    "account_number": "<ACCOUNT_NUMBER>",
    "private_address": "<PRIVATE_ADDRESS>",
    "private_email": "<PRIVATE_EMAIL>",
    "private_person": "<PRIVATE_PERSON>",
    "private_phone": "<PRIVATE_PHONE>",
    "private_url": "<PRIVATE_URL>",
    "private_date": "<PRIVATE_DATE>",
    "secret": "<SECRET>",
}


def detect_file_type(filename: str) -> DocumentType:
    extension = Path(filename).suffix.lower()
    if extension == ".pdf":
        return "pdf"
    if extension == ".docx":
        return "docx"
    raise UnsupportedDocumentError(
        "Only .pdf and .docx uploads are supported in v1."
    )


def placeholder_for_label(label: str) -> str:
    return PLACEHOLDERS.get(label, "<REDACTED>")


def merge_spans(spans: Iterable[DetectedSpan]) -> list[DetectedSpan]:
    ordered = sorted(spans, key=lambda span: (span.start, span.end))
    merged: list[DetectedSpan] = []

    for span in ordered:
        if not merged:
            merged.append(span)
            continue

        current = merged[-1]
        if span.start <= current.end and span.label == current.label:
            merged[-1] = current.model_copy(
                update={
                    "end": max(current.end, span.end),
                    "text": current.text if len(current.text) >= len(span.text) else span.text,
                    "score": max(
                        current.score or 0.0,
                        span.score or 0.0,
                    ),
                }
            )
            continue

        merged.append(span)

    return merged


def build_summary(spans: Iterable[DetectedSpan]) -> RedactionSummary:
    materialized = list(spans)
    counts = Counter(span.label for span in materialized)
    return RedactionSummary(
        span_count=len(materialized),
        by_label=dict(sorted(counts.items())),
        spans=materialized[:200],
    )


def clamp_excerpt(value: str, max_length: int = 120) -> str:
    compact = " ".join(value.split())
    if len(compact) <= max_length:
        return compact
    return f"{compact[: max_length - 1].rstrip()}…"

