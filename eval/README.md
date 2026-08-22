# eval

Python 3.12 backtest & calibration harness. Never in the serving path.

The time split is hard-coded in `src/verdict_eval/split.py` and must not move:
train ≤ 2025-12-31 · validate 2026-01-01→2026-06-30 · test rolling monthly after.

```bash
cd eval
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -e ".[dev]"
pytest
```

Note: the dev machine currently has Python 3.9; this package targets 3.12 and
was not executed in the Phase 0 session (stub + tests only).
