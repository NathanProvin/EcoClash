"""Sanity checks on data/balance.toml, the contract shared by every target."""

import tomllib
from pathlib import Path

BALANCE = Path(__file__).resolve().parents[2] / "data" / "balance.toml"


def test_balance_invariants():
    b = tomllib.loads(BALANCE.read_text(encoding="utf-8"))
    sim, match = b["sim"], b["match"]
    assert sim["tick_hz"] > 0
    assert sim["flora_every_ticks"] > 0 and sim["env_every_ticks"] > 0
    assert sim["grid_size"] > 0 and sim["chunk_size"] > 0  # edge chunks may be partial (D-070)
    assert 0 < match["victory_territory"] <= 1
    assert match["time_limit_s"] > 0
    assert b["net"]["input_delay_ticks"] >= 1
