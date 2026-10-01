"""Rule checks for the M0.5 economy (gamerules §4, §7, §11.3; D-018, D-023)."""

import numpy as np
from helpers import uncapped

from prototype.economy import Economy
from prototype.fauna import Agents, Fauna
from prototype.flora import Flora
from prototype.match import run


def economy(bal=None):
    bal = bal or uncapped()
    fl = Flora(bal)
    return Economy(bal, fl, Fauna(bal, fl))


def test_start_unlocks_and_tier_path():
    ec = economy()
    assert ec.missing(1, "lichen_and_moss") == []  # the only card free at start (D-118)
    assert ec.missing(1, "grasses") == ["grasses"] and ec.missing(1, "earthworms") == ["earthworms"]
    # the family's lower tiers first (D-087)
    assert ec.missing(1, "bramble") == ["ferns", "nettle", "bramble"]


def test_animals_need_their_habitat_unlocked_first():
    ec = economy()
    assert ec.missing(1, "lynx") == ["oak", "lynx"]


def test_prepare_buys_one_species_at_a_time_when_affordable():
    ec = economy()
    ec.bank[1] = ec.stat("ferns", "unlock_cost") + 10
    assert not ec.prepare(1, "nettle")  # bought ferns; nettle still missing
    assert ec.bank[1] == 10 and "ferns" in ec.unlocked[1]
    assert ec.events == [(1, "ferns", ec.stat("ferns", "unlock_cost"))]
    assert not ec.prepare(1, "nettle")  # cannot afford nettle: nothing charged
    assert ec.bank[1] == 10
    ec.bank[1] += ec.stat("nettle", "unlock_cost")
    assert ec.prepare(1, "nettle") and ec.bank[1] == 10


def test_costs_come_from_the_stat_sheet():
    ec = economy()
    assert ec.plant_cost("oak", 4) == 4 * ec.stat("oak", "spawn_cost")
    fox = ec.spawn_cost("fox", 1)
    assert fox == ec.stat("fox", "spawn_cost")
    assert ec.spawn_cost("fox", 1, outside=True) == fox * 1.5
    assert ec.spawn_cost("rabbits", 4, outside=True) == ec.spawn_cost("rabbits", 4)


def test_income_is_the_sum_of_species_yields():
    bal = uncapped()
    fl = Flora(bal)
    fa = Fauna(bal, fl)
    ec = Economy(bal, fl, fa)
    st = fl.new_state(4)
    fl.plant(st, 1, "grasses", np.ones((4, 4), bool), frac=1.0)  # 16 fully covered cells
    ag = Agents.empty().append([fa.idx("fox")] * 2, [1, 1], [0, 0], [0, 0], [1, 1])
    expected = 16 * ec.stat("grasses", "yield") + 2 * ec.stat("fox", "yield")
    assert abs(ec.income(1, st, ag) - expected) < 1e-9
    assert ec.income(2, st, ag) == 0


def test_victory_rules():
    ec = economy()
    terr, even = {1: 0.91, 2: 0.05}, {1: 5.0, 2: 5.0}
    assert ec.winner(10, terr, even) == (1, "territory")  # fixed 90 % (D-094)
    assert ec.winner(10, {1: 0.5, 2: 0.4}, even) is None  # not yet decided
    limit = ec.time_limit
    assert ec.winner(limit, {1: 0.5, 2: 0.4}, {1: 1.0, 2: 2.0}) == (2, "biomass")
    assert ec.winner(limit, {1: 0.5, 2: 0.4}, even) == (1, "territory share")
    assert ec.winner(limit, {1: 0.4, 2: 0.4}, even) == (0, "draw")


def test_decaying_threshold_switch():
    bal = uncapped()
    bal["match"]["territory_decay"] = True
    ec = economy(bal)
    assert ec.threshold(0) == 0.75
    assert abs(ec.threshold(ec.time_limit / 2) - 0.65) < 1e-9
    assert ec.threshold(ec.time_limit) == 0.55


def test_match_with_economy_ends_at_the_time_limit():
    bal = uncapped()
    bal["match"]["time_limit_s"] = 120
    fl = Flora(bal)
    fa = Fauna(bal, fl)
    rows, _, _, log = run(fl, 32, 5, seed=1, fauna=fa, economy=Economy(bal, fl, fa))
    assert rows[-1]["t_s"] == 120  # stopped at the limit, not at 5 min
    assert log[-1][2].startswith("end: ")
    assert all(r["bank_p1"] >= 0 and r["bank_p2"] >= 0 for r in rows)


def test_replay_export_round_trips(tmp_path):
    import gzip
    import json

    from prototype.match import FIELD_EVERY, export_replay

    bal = uncapped()
    fl = Flora(bal)
    fa = Fauna(bal, fl)
    record = []
    rows, _, _, log = run(fl, 24, 3, seed=1, fauna=fa, economy=Economy(bal, fl, fa), record=record)
    export_replay(tmp_path / "r", bal, fl, fa, 24, record, rows, log, ("forest", "meadow"))
    meta = json.loads((tmp_path / "r" / "replay.json").read_text(encoding="utf-8"))
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8")) == ["r"]
    assert meta["ticks"] == len(record) and len(meta["series"]["t_s"]) == len(rows)
    assert len(meta["species"]) == 45 and meta["species"][0]["stats"]["effect"]
    assert len(meta["counts"]) == (meta["ticks"] - 1) // FIELD_EVERY + 1
    assert all(len(c) == 2 and len(c[0]) == 45 for c in meta["counts"])
    data = gzip.decompress((tmp_path / "r" / "frames.bin.gz").read_bytes())
    pos, fields, animals = 0, 0, 0
    for tick in range(meta["ticks"]):
        count = int(np.frombuffer(data, "<u4", 1, pos)[0])
        pos += 4 + 10 * count
        animals = max(animals, count)
        if tick % FIELD_EVERY == 0:
            owner = np.frombuffer(data, "u1", 24 * 24, pos)
            assert set(owner.tolist()) <= {0, 1, 2}
            pos += (2 + len(fl.names)) * 24 * 24
            fields += 1
    assert pos == len(data) and fields == (meta["ticks"] - 1) // FIELD_EVERY + 1
    assert animals > 0
