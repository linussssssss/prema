"""The fixed time split. Committed in code on purpose — do not move it.

train    <= 2025-12-31
validate    2026-01-01 .. 2026-06-30
test        rolling monthly after (each calendar month >= 2026-07 is its own
            test fold, evaluated once and never used for fitting)

Split key: the market's listing time (listed_at) — the moment a listing-time
ambiguity score would have to be produced. No hindsight leakage.
"""

from datetime import date, datetime, timezone

TRAIN_END = date(2025, 12, 31)
VALIDATE_START = date(2026, 1, 1)
VALIDATE_END = date(2026, 6, 30)


def assign_split(listed_at: "datetime | date") -> str:
    """Return 'train', 'validate', or 'test:YYYY-MM' for a listing timestamp."""
    if isinstance(listed_at, datetime):
        listed_at = listed_at.astimezone(timezone.utc).date() if listed_at.tzinfo else listed_at.date()
    if listed_at <= TRAIN_END:
        return "train"
    if VALIDATE_START <= listed_at <= VALIDATE_END:
        return "validate"
    return f"test:{listed_at.year:04d}-{listed_at.month:02d}"
