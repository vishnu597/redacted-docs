from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Iterator

from .config import Settings
from .schemas import DetectedSpan
from .utils import merge_spans, placeholder_for_label

try:
    from transformers import pipeline
except ImportError:  # pragma: no cover - handled at runtime in deployment
    pipeline = None


@dataclass(frozen=True)
class TextWindow:
    start: int
    end: int
    text: str


class PrivacyFilterDetector:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._pipeline = None
        self._lock = threading.Lock()

    def load(self) -> None:
        with self._lock:
            if self._pipeline is not None:
                return
            if pipeline is None:
                raise RuntimeError(
                    "transformers is not installed. Install api/requirements.txt first."
                )

            self._pipeline = pipeline(
                task="token-classification",
                model=self._settings.model_name,
                tokenizer=self._settings.model_name,
            )

    def detect(self, text: str) -> list[DetectedSpan]:
        if not text.strip():
            return []

        self.load()

        spans: list[DetectedSpan] = []
        seen: set[tuple[str, int, int]] = set()

        for window in iter_text_windows(text):
            predictions = self._pipeline(  # type: ignore[operator]
                window.text,
                aggregation_strategy="simple",
            )
            for prediction in predictions:
                start = int(prediction["start"]) + window.start
                end = int(prediction["end"]) + window.start
                label = str(prediction["entity_group"])
                signature = (label, start, end)
                if signature in seen:
                    continue
                seen.add(signature)
                spans.append(
                    DetectedSpan(
                        label=label,
                        start=start,
                        end=end,
                        text=text[start:end],
                        placeholder=placeholder_for_label(label),
                        score=float(prediction.get("score", 0.0)),
                    )
                )

        return merge_spans(spans)


def iter_text_windows(
    text: str,
    max_chars: int = 6000,
    overlap: int = 300,
) -> Iterator[TextWindow]:
    if len(text) <= max_chars:
        yield TextWindow(start=0, end=len(text), text=text)
        return

    start = 0
    minimum_boundary = max_chars // 2

    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            while end > start + minimum_boundary and not text[end - 1].isspace():
                end -= 1
            if end <= start:
                end = min(len(text), start + max_chars)

        yield TextWindow(start=start, end=end, text=text[start:end])

        if end >= len(text):
            break

        start = max(0, end - overlap)
        while start < len(text) and start > 0 and not text[start - 1].isspace():
            start += 1

