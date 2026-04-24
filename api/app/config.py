from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Privacy Filter Redactor"
    model_name: str = "openai/privacy-filter"
    tmp_root: Path = Path("./api/tmp")
    job_ttl_seconds: int = 1800
    cleanup_interval_seconds: int = 300
    max_upload_size_mb: int = 25
    allowed_origins_csv: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_prefix="REDACTOR_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.allowed_origins_csv.split(",")
            if origin.strip()
        ]

