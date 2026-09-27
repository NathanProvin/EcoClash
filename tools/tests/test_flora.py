"""Rule checks for the M0 flora cell model (gamerules §2.1, §3)."""

import numpy as np
import pytest

from prototype.flora import U16, Flora, load_balance, run


def halves(n):
    left = np.zeros((n, n), bool)
    left[:, : n // 2] = True
    return left, ~left


def test_same_level_frontier_freezes():
    fl = Flora(load_balance())
    st = fl.new_state(16)
    left, right = halves(16)
    fl.plant(st, 1, "grasses", left, frac=1.0)
    fl.plant(st, 2, "grasses", right, frac=1.0)
    before = st.owner.copy()
    for _ in range(200):
        fl.step(st)
    assert (st.owner == before).all()


def test_higher_level_smothers_lower_enemy():
    fl = Flora(load_balance())
    st = fl.new_state(16)
    st.soil[:] = U16
    left, right = halves(16)
    fl.plant(st, 1, "oak", left, frac=1.0)
    fl.plant(st, 2, "grasses", right, frac=1.0)
    for _ in range(100):
        fl.step(st)
    assert (st.owner[:, 8] == 1).all()  # frontier column taken by the trees
    assert (st.owner[:, 12] == 2).all()  # far side untouched so far


@pytest.mark.parametrize("succession", [True, False])
def test_trees_need_developed_soil(succession):
    fl = Flora(load_balance(), succession=succession)
    st = fl.new_state(8)
    left, _ = halves(8)
    st.soil[left] = U16
    assert fl.plant(st, 1, "oak", left, frac=1.0) == 32
    for _ in range(400):
        fl.step(st)
    assert (st.owner[:, 4] == 1).all() != succession


def test_pioneers_establish_on_bare_soil_trees_do_not():
    fl = Flora(load_balance())
    st = fl.new_state(8)
    everywhere = np.ones((8, 8), bool)
    assert fl.plant(st, 1, "oak", everywhere) == 0
    assert fl.plant(st, 1, "lichen", everywhere) == 64


@pytest.mark.parametrize("mode", ["float", "quant"])
def test_mirrored_scenario_is_symmetric(mode):
    fl = Flora(load_balance(), mode, rounding="floor")  # floor: no random draws, exact mirror
    rows, _, st, _ = run(fl, 32, 4, seed=3, builds=("forest", "forest"))
    assert rows[-1]["territory_p1"] == rows[-1]["territory_p2"] > 0
    assert np.array_equal(st.owner == 1, np.rot90(st.owner == 2, 2))


def test_quant_stochastic_is_repeatable():
    def final():
        fl = Flora(load_balance(), "quant", "stochastic", seed=7)
        rows, _, st, _ = run(fl, 32, 4, seed=7)
        return rows, st

    (rows_a, a), (rows_b, b) = final(), final()
    assert rows_a == rows_b
    for f in ("owner", "bio", "soil", "prog", "prog_own"):
        assert np.array_equal(getattr(a, f), getattr(b, f)), f


@pytest.mark.parametrize("rounding", ["stochastic", "floor"])
def test_quant_low_density_still_grows(rounding):
    fl = Flora(load_balance(), "quant", rounding, seed=1)
    st = fl.new_state(4)
    st.soil[:] = U16
    one_cell = np.zeros((4, 4), bool)
    one_cell[1, 1] = True
    oak = fl.idx("oak")
    fl.plant(st, 1, "oak", one_cell, frac=2 / 60000)  # biomass 2: exact growth is < 1 per tick
    assert st.bio[oak, 1, 1] == 2
    for _ in range(200):
        fl.step(st)
    assert st.bio[oak, 1, 1] > 2


def test_same_stratum_species_interpenetrate_and_spread():
    fl = Flora(load_balance())
    st = fl.new_state(16)
    st.soil[:] = U16
    everywhere = np.ones((16, 16), bool)
    fl.plant(st, 1, "grasses", everywhere, frac=1.0)
    patch = np.zeros((16, 16), bool)
    patch[6:10, 6:10] = True
    fl.plant(st, 1, "clover", patch, frac=1.0)
    for _ in range(300):
        fl.step(st)
    clover, grasses = st.bio[fl.idx("clover")], st.bio[fl.idx("grasses")]
    assert (clover[6:10, 3] > 0).all()  # clover spread 3 cells into the meadow...
    assert (grasses > 0).all()  # ...without displacing the grass


def test_mixed_stand_outgrows_monoculture():
    fl = Flora(load_balance(), own_spread=False)
    mono, mixed = fl.new_state(4), fl.new_state(4)
    cells = np.ones((4, 4), bool)
    for st in (mono, mixed):
        st.soil[:] = U16
        fl.plant(st, 1, "grasses", cells)
    fl.plant(mixed, 1, "clover", cells)
    for _ in range(400):
        fl.step(mono)
        fl.step(mixed)
    assert mixed.bio.sum() > 1.2 * mono.bio.sum()


def test_float_and_quant_agree_on_territory():
    final = {}
    for mode in ("float", "quant"):
        rows, _, _, _ = run(Flora(load_balance(), mode, seed=5), 48, 6, seed=5)
        final[mode] = rows[-1]
    for p in (1, 2):
        key = f"territory_p{p}"
        assert final["float"][key] == pytest.approx(final["quant"][key], abs=0.02)
