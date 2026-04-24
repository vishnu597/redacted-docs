from __future__ import annotations

import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import Settings
from .schemas import DocumentType, JobOutputs, JobResponse, JobStatus, RedactionSummary
from .utils import MIME_TYPES


@dataclass
class JobRecord:
    job_id: str
    status: JobStatus
    file_type: DocumentType
    original_name: str
    created_at: datetime
    expires_at: datetime
    directory: Path
    input_path: Path
    mime_type: str
    output_path: Path | None = None
    summary: RedactionSummary | None = None
    error: str | None = None


class JobStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._settings.tmp_root.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def create_job(
        self,
        *,
        original_name: str,
        file_type: DocumentType,
        payload: bytes,
    ) -> JobRecord:
        job_id = uuid.uuid4().hex
        directory = self._settings.tmp_root / job_id
        directory.mkdir(parents=True, exist_ok=True)

        input_path = directory / f"source.{file_type}"
        input_path.write_bytes(payload)

        now = datetime.now(UTC)
        record = JobRecord(
            job_id=job_id,
            status="queued",
            file_type=file_type,
            original_name=original_name,
            created_at=now,
            expires_at=now + timedelta(seconds=self._settings.job_ttl_seconds),
            directory=directory,
            input_path=input_path,
            mime_type=MIME_TYPES[file_type],
        )

        with self._lock:
            self._jobs[job_id] = record

        return record

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def mark_processing(self, job_id: str) -> JobRecord:
        with self._lock:
            job = self._jobs[job_id]
            job.status = "processing"
            return job

    def mark_completed(
        self,
        job_id: str,
        *,
        output_path: Path,
        summary: RedactionSummary,
    ) -> JobRecord:
        with self._lock:
            job = self._jobs[job_id]
            job.status = "completed"
            job.output_path = output_path
            job.summary = summary
            return job

    def mark_failed(self, job_id: str, *, error: str) -> JobRecord:
        with self._lock:
            job = self._jobs[job_id]
            job.status = "failed"
            job.error = error
            return job

    def delete(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is not None and job.directory.exists():
            shutil.rmtree(job.directory, ignore_errors=True)

    def cleanup_expired(self) -> None:
        now = datetime.now(UTC)
        expired_ids: list[str] = []
        with self._lock:
            for job_id, job in self._jobs.items():
                if job.expires_at <= now:
                    expired_ids.append(job_id)

        for job_id in expired_ids:
            self.delete(job_id)

    def to_response(self, job: JobRecord, *, base_url: str = "") -> JobResponse:
        outputs = None
        if job.status == "completed" and job.output_path is not None:
            outputs = JobOutputs(
                preview_url=f"{base_url}/api/jobs/{job.job_id}/preview",
                download_url=f"{base_url}/api/jobs/{job.job_id}/download",
            )

        return JobResponse(
            job_id=job.job_id,
            status=job.status,
            file_type=job.file_type,
            original_name=job.original_name,
            created_at=job.created_at,
            expires_at=job.expires_at,
            error=job.error,
            summary=job.summary,
            outputs=outputs,
        )

