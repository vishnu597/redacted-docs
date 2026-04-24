from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import Settings
from .detector import PrivacyFilterDetector
from .docx_redactor import redact_docx
from .jobs import JobStore
from .pdf_redactor import redact_pdf
from .schemas import JobResponse
from .utils import UnsupportedDocumentError, detect_file_type


async def cleanup_loop(job_store: JobStore, interval_seconds: int) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        await asyncio.to_thread(job_store.cleanup_expired)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    job_store = JobStore(settings)
    detector = PrivacyFilterDetector(settings)

    await asyncio.to_thread(detector.load)

    cleanup_task = asyncio.create_task(
        cleanup_loop(job_store, settings.cleanup_interval_seconds)
    )

    app.state.settings = settings
    app.state.job_store = job_store
    app.state.detector = detector

    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(title="Privacy Filter Redactor API", lifespan=lifespan)


def build_base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


app.add_middleware(
    CORSMiddleware,
    allow_origins=Settings().allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/jobs", response_model=JobResponse, status_code=202)
async def create_job(request: Request, file: UploadFile = File(...)) -> JobResponse:
    settings: Settings = request.app.state.settings
    job_store: JobStore = request.app.state.job_store

    if not file.filename:
        raise HTTPException(status_code=400, detail="A file name is required.")

    try:
        file_type = detect_file_type(file.filename)
    except UnsupportedDocumentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(payload) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Files larger than {settings.max_upload_size_mb} MB are not supported in v1.",
        )

    job = job_store.create_job(
        original_name=file.filename,
        file_type=file_type,
        payload=payload,
    )

    asyncio.create_task(process_job(request.app, job.job_id))
    return job_store.to_response(job, base_url=build_base_url(request))


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(request: Request, job_id: str) -> JobResponse:
    job_store: JobStore = request.app.state.job_store
    await asyncio.to_thread(job_store.cleanup_expired)
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job_store.to_response(job, base_url=build_base_url(request))


@app.get("/api/jobs/{job_id}/preview")
async def preview_file(request: Request, job_id: str) -> FileResponse:
    job = require_completed_job(request, job_id)
    return FileResponse(
        path=job.output_path,
        media_type=job.mime_type,
        filename=f"preview-{job.original_name}",
    )


@app.get("/api/jobs/{job_id}/download")
async def download_file(request: Request, job_id: str) -> FileResponse:
    job = require_completed_job(request, job_id)
    return FileResponse(
        path=job.output_path,
        media_type=job.mime_type,
        filename=redacted_filename(job.original_name),
    )


def require_completed_job(request: Request, job_id: str):
    job_store: JobStore = request.app.state.job_store
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != "completed" or job.output_path is None:
        raise HTTPException(status_code=409, detail="The redacted file is not ready yet.")
    return job


def redacted_filename(original_name: str) -> str:
    path = Path(original_name)
    return f"{path.stem}.redacted{path.suffix}"


async def process_job(app: FastAPI, job_id: str) -> None:
    await asyncio.to_thread(process_job_sync, app, job_id)


def process_job_sync(app: FastAPI, job_id: str) -> None:
    job_store: JobStore = app.state.job_store
    detector: PrivacyFilterDetector = app.state.detector

    job = job_store.mark_processing(job_id)
    output_path = job.directory / f"redacted.{job.file_type}"

    try:
        if job.file_type == "pdf":
            summary = redact_pdf(job.input_path, output_path, detector)
        else:
            summary = redact_docx(job.input_path, output_path, detector)
        job_store.mark_completed(job.job_id, output_path=output_path, summary=summary)
    except UnsupportedDocumentError as exc:
        job_store.mark_failed(job.job_id, error=str(exc))
    except Exception as exc:  # pragma: no cover - safety path for runtime failures
        job_store.mark_failed(
            job.job_id,
            error=f"Redaction failed: {exc}",
        )
