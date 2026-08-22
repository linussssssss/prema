from datetime import date, datetime, timezone

from verdict_eval.split import assign_split


def test_train_boundary():
    assert assign_split(date(2025, 12, 31)) == "train"
    assert assign_split(date(2024, 1, 1)) == "train"


def test_validate_window():
    assert assign_split(date(2026, 1, 1)) == "validate"
    assert assign_split(date(2026, 6, 30)) == "validate"


def test_rolling_test_folds():
    assert assign_split(date(2026, 7, 1)) == "test:2026-07"
    assert assign_split(date(2026, 8, 22)) == "test:2026-08"


def test_datetime_input_uses_utc():
    assert assign_split(datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)) == "validate"
