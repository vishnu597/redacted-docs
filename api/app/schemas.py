from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


DocumentType = Literal["pdf", "docx"]
JobStatus = Literal["queued", "processing", "completed", "failed"]


class DetectedSpan(BaseModel):
    label: str
    start: int
    end: int
    text: str
    placeholder: str
    score: float | None = None


class RedactionSummary(BaseModel):
    span_count: int = 0
    by_label: dict[str, int] = Field(default_factory=dict)
    spans: list[DetectedSpan] = Field(default_factory=list)


class JobOutputs(BaseModel):
    preview_url: str
    download_url: str


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    file_type: DocumentType
    original_name: str
    created_at: datetime
    expires_at: datetime
    error: str | None = None
    summary: RedactionSummary | None = None
    outputs: JobOutputs | None = None

