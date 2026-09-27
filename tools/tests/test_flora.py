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


def test_mirrored_scenario_is_symmetric_and_repeatable():
    fl = Flora(load_balance())
    rows, _, st, _ = run(fl, 32, 4, seed=3, builds=("forest", "forest"))
    assert rows[-1]["territory_p1"] == rows[-1]["territory_p2"] > 0
    assert np.array_equal(st.owner == 1, np.rot90(st.owner == 2, 2))
    again, _, _, _ = run(fl, 32, 4, seed=3, builds=("forest", "forest"))
    assert rows == again
