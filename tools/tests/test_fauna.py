"""Rule checks for the M0.4 fauna agents (gamerules §6; D-023)."""

import numpy as np
from helpers import uncapped

from prototype.fauna import Agents, Fauna
from prototype.flora import ONE, U16, Flora
from prototype.match import run


def world(n=8, bal=None):
    bal = bal or uncapped()
    fl = Flora(bal)
    return bal, fl, Fauna(bal, fl), fl.new_state(n)


def animals(fa, *rows):
    """rows: (species, owner, y, x, energy or None for body // 2)."""
    ag = Agents.empty()
    for name, p, y, x, e in rows:
        s = fa.idx(name)
        ag = ag.append([s], [p], [y], [x], [fa.body[s] * ONE // 2 if e is None else e])
    return ag


def everywhere(n):
    return np.ones((n, n), bool)


def test_herbivores_graze_enemy_flora():
    _, fl, fa, st = world()
    fl.plant(st, 2, "grasses", everywhere(8), frac=1.0)
    ag = animals(fa, ("rabbits", 1, 4, 4, None))
    before = st.bio[fl.idx("grasses"), 4, 4]
    e0 = ag.energy[0]
    ag, stats = fa.step(st, ag)
    assert st.bio[fl.idx("grasses"), 4, 4] < before
    assert stats["grazed_p1"] > 0 and st.dead[4, 4] > 0
    assert ag.energy[0] > e0  # the meal outweighs one tick of upkeep


def test_own_grazing_is_slower():
    eaten = {}
    for owner in (1, 2):
        _, fl, fa, st = world()
        fl.plant(st, owner, "grasses", everywhere(8), frac=1.0)
        g = fl.idx("grasses")
        before = st.bio[g].sum()
        fa.step(st, animals(fa, ("rabbits", 1, 4, 4, None)))
        eaten[owner] = before - st.bio[g].sum()
    assert 0 < eaten[1] < eaten[2] / 3  # own_graze = 0.2


def test_predator_kills_prey_but_not_in_refuge():
    for refuge in (False, True):
        _, fl, fa, st = world()
        st.soil[:] = U16
        fl.plant(st, 2, "grasses", everywhere(8), frac=1.0)
        if refuge:
            fl.plant(st, 2, "hawthorn", everywhere(8), frac=1.0)
        ag = animals(fa, ("fox", 1, 4, 4, None), ("rabbits", 2, 4, 4, None))
        ag, stats = fa.step(st, ag)
        assert stats["kills_p1"] == (0 if refuge else 1)
        assert (fa.idx("rabbits") in ag.sp) == refuge


def test_starvation_leaves_a_carcass():
    _, fl, fa, st = world()
    ag, _ = fa.step(st, animals(fa, ("fox", 1, 4, 4, 1)))
    assert len(ag) == 0
    assert st.dead.sum() == fa.body[fa.idx("fox")] // 2


def test_reproduction_respects_the_player_cap():
    bal = uncapped()
    bal["agents"]["max_agents"] = 6  # 3 per player
    _, fl, fa, st = world(bal=bal)
    body = int(fa.body[fa.idx("earthworms")])
    ag = animals(fa, *[("earthworms", 1, 2, 2, 4 * body * ONE)] * 2)
    ag, _ = fa.step(st, ag)
    assert len(ag) == 3  # one split, then the cap stops the second


def test_decomposers_turn_dead_biomass_into_soil():
    _, fl, fa, st = world()
    st.dead[4, 4] = 1000
    fa.step(st, animals(fa, ("earthworms", 1, 4, 4, None)))
    assert st.dead[4, 4] < 1000 and st.soil[4, 4] > 0


def test_spawn_conditions():
    _, fl, fa, st = world(16)
    st.soil[:] = U16
    left = np.zeros((16, 16), bool)
    left[:, :8] = True
    fl.plant(st, 1, "grasses", left, frac=1.0)
    ag = Agents.empty()
    ag, n = fa.spawn(st, ag, 1, "fox", (4, 4))
    assert n == 0  # no enemy prey
    ag, n = fa.spawn(st, ag, 1, "rabbits", (4, 4))
    assert n == 0  # no enemy food in range
    fl.plant(st, 2, "grasses", ~left, frac=1.0)
    ag, n = fa.spawn(st, ag, 1, "rabbits", (4, 4))
    assert n == fa.group[fa.idx("rabbits")] and (ag.x == 7).all()  # at the front
    ag, n = fa.spawn(st, ag, 2, "badger", (4, 12))
    assert n == 0  # no own shrub habitat (and no badger prey)
    ag, n = fa.spawn(st, ag, 2, "fox", (4, 12))  # the fox lives on meadows too (D-187)
    assert n == 1 and ag.x[-1] == 7  # dropped on the prey


def test_match_with_animals_is_repeatable():
    def play():
        bal = uncapped()
        fl = Flora(bal, "quant", seed=2)
        rows, _, _, log = run(fl, 48, 10, seed=2, fauna=Fauna(bal, fl, 2))
        return rows, log

    (rows, log), (again, _) = play(), play()
    assert rows == again
    assert max(r["herbivores_p1"] + r["herbivores_p2"] for r in rows) > 0
    assert any(name == "earthworms" for _, _, name, _ in log)


def test_breeding_waits_for_the_cooldown_and_the_species_cap():
    bal = uncapped()
    bal["fauna"]["earthworms"]["cap"] = 3
    _, fl, fa, st = world(bal=bal)
    body = int(fa.body[fa.idx("earthworms")])
    st.dead[:] = 10**6  # plenty of food
    ag = animals(fa, ("earthworms", 1, 2, 2, 16 * body * ONE))
    ag, _ = fa.step(st, ag)
    assert len(ag) == 2  # one birth, then the parent cools down
    assert (ag.cooldown == fa.breed[fa.idx("earthworms")]).all()
    for _ in range(int(fa.breed[fa.idx("earthworms")])):
        ag, _ = fa.step(st, ag)
    assert len(ag) == 3  # the species cap stops the fourth


def test_spawn_respects_the_species_cap():
    bal = uncapped()
    bal["fauna"]["earthworms"]["cap"] = 4
    _, fl, fa, st = world(bal=bal)
    fl.plant(st, 1, "grasses", everywhere(8), frac=1.0)
    ag, n = fa.spawn(st, Agents.empty(), 1, "earthworms", (4, 4))
    assert n == 4 < fa.group[fa.idx("earthworms")]
