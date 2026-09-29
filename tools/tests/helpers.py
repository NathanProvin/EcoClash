"""Shared test setup."""

from prototype.flora import load_balance


def uncapped() -> dict:
    """The real balance with plant caps lifted: caps are map shares (D-045), and the rule tests
    fill most of their tiny maps. The cap rule has its own test."""
    bal = load_balance()
    for s in bal["flora"].values():
        if isinstance(s, dict):
            s["cap"] = 1.0
    return bal
