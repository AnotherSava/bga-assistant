"""FastAPI server that receives extracted BGA data from the Chrome extension.

Provides a POST /extract endpoint that accepts raw game data, saves it to disk,
runs the processing pipeline, and returns a summary.

Usage: uvicorn bga_tracker.innovation.server:app --port 8787
"""

import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from bga_tracker.innovation.pipeline import run_pipeline

# Serialize pipeline executions to prevent concurrent requests from interleaving
# reads/writes to the same table directory's files (raw_log.json, game_state.json, etc.)
_pipeline_lock = threading.Lock()


class RawData(BaseModel):
    players: dict[str, str]
    gamedatas: dict | None = None
    packets: list


class ExtractRequest(BaseModel):
    url: str
    raw_data: RawData


class ExtractResponse(BaseModel):
    status: str
    table_dir: str
    summary_path: str


app = FastAPI(title="BGA Innovation Tracker")


@app.exception_handler(ValueError)
def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(Exception)
def general_error_handler(request: Request, exc: Exception) -> JSONResponse:
    import logging

    logging.getLogger(__name__).exception("Pipeline error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["POST"],
    allow_headers=["*"],
)


@app.post("/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest) -> ExtractResponse:
    """Receive raw game data from the Chrome extension and run the pipeline."""
    with _pipeline_lock:
        result = run_pipeline(
            request.url,
            no_open=True,
            raw_data=request.raw_data.model_dump(),
        )

    return ExtractResponse(
        status="ok",
        table_dir=result["table_dir"],
        summary_path=result["summary_path"],
    )
