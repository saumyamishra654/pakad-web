"""CLI schema endpoint: serves pipeline argument schemas for dynamic UI generation."""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/schema", tags=["schema"])


@router.get("/{mode}")
async def get_schema(mode: str):
    """Return the CLI argument schema for a pipeline mode (detect/analyze/preprocess)."""
    try:
        from raga_pipeline.cli_schema import get_mode_schema
        return get_mode_schema(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Schema generation failed: {exc}") from exc
