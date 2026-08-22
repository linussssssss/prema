"""Phase 1 backtest harness (STUB).

Planned pipeline:
  1. Load data/exports/markets.parquet (built by `pnpm dataset:build`).
  2. assign_split() on listed_at; fit only on 'train'.
  3. Score = linter severities (Phase 0 features) -> logistic baseline;
     Phase 1 adds LLM clause features and isotonic calibration on 'validate'.
  4. Report Brier / log-loss / calibration curve per split and per category,
     feeding the public /calibration page.
"""

from pathlib import Path

EXPORTS = Path(__file__).resolve().parents[3] / "data" / "exports" / "markets.parquet"


def run() -> None:
    raise NotImplementedError(
        "Phase 1: baseline model + isotonic calibration. "
        f"Expects the dataset at {EXPORTS} (run `pnpm dataset:build` first)."
    )


if __name__ == "__main__":
    run()
