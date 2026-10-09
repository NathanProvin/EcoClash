"""Shared test setup."""

from prototype.flora import load_balance


def uncapped() -> dict:
    """The real balance with plant caps lifted: caps are map shares (D-045), and the rule tests
    fill most of their tiny maps. The cap rule has its own test. Land plants also get the neutral
    water need of V1 (0.5, tolerance 0.6): since D-239 each has its own, which the flat test maps
    (moisture 0.5) would favour or slow; the rule tests check mechanisms, not the tuned data."""
    bal = load_balance()
    for s in bal["flora"].values():
        if isinstance(s, dict):
            s["cap"] = 1.0
            if s.get("family") != "W":
                s["water_optimum"], s["water_tolerance"] = 0.5, 0.6
    return bal
