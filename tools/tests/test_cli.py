"""sim-cli (Rust) against the prototype's quant mode: identical metrics on every flora tick."""

import shutil

import pytest

from prototype.cli_check import check
from prototype.flora import load_balance


@pytest.mark.skipif(shutil.which("cargo") is None, reason="needs cargo to build sim-cli")
def test_sim_cli_matches_the_prototype():
    every = load_balance()["sim"]["flora_every_ticks"]
    assert check(n=32, ticks=600) == -(-600 // every)  # flora ticks: 0, every, 2 every, ...
