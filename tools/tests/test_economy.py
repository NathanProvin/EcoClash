"""Rule checks for the M0.5 economy (gamerules §4, §7, §11.3; D-018, D-023)."""

from prototype.economy import Economy
from prototype.fauna import Fauna
from prototype.flora import Flora, load_balance
from prototype.match import run


def economy(bal=None):
    bal = bal or load_balance()
    fl = Flora(bal)
    return Economy(bal, fl, Fauna(bal, fl))


def test_start_unlocks_and_tier_path():
    ec = economy()
    assert ec.missing(1, "grasses") == [] and ec.missing(1, "earthworms") == []
    assert ec.missing(1, "bramble") == [("L", 1, 2), ("L", 1, 3)]


def test_animals_need_their_habitat_unlocked_first():
    ec = economy()
    assert ec.missing(1, "fox") == [("L", 2, 1), *[("F", 5, 1)]]


def test_prepare_buys_one_card_at_a_time_when_affordable():
    ec = economy()
    ec.bank[1] = ec.unlock_cost(("L", 1, 2)) + 10
    assert not ec.prepare(1, "bramble")  # bought L1 T2, T3 still missing
    assert ec.bank[1] == 10 and ("L", 1, 2) in ec.unlocked[1]
    assert not ec.prepare(1, "bramble")  # cannot afford T3: nothing charged
    assert ec.bank[1] == 10
    ec.bank[1] += ec.unlock_cost(("L", 1, 3))
    assert ec.prepare(1, "bramble") and ec.bank[1] == 10


def test_costs():
    ec = economy()
    assert ec.unlock_cost(("F", 1, 3)) == round(200 * 1.5**2)
    assert ec.plant_cost("oak", 4) == 4 * 150
    fox = ec.spawn_cost("fox", 1)
    assert ec.spawn_cost("fox", 1, outside=True) == round(fox * 1.5)
    assert ec.spawn_cost("rabbits", 4, outside=True) == ec.spawn_cost("rabbits", 4)


def test_victory_rules():
    ec = economy()
    terr, even = {1: 0.61, 2: 0.2}, {1: 5.0, 2: 5.0}
    assert ec.winner(10, terr, even) == (1, "territory")  # fixed 60 %
    assert ec.winner(10, {1: 0.5, 2: 0.4}, even) is None  # not yet decided
    limit = ec.time_limit
    assert ec.winner(limit, {1: 0.5, 2: 0.4}, {1: 1.0, 2: 2.0}) == (2, "biomass")
    assert ec.winner(limit, {1: 0.5, 2: 0.4}, even) == (1, "territory share")
    assert ec.winner(limit, {1: 0.4, 2: 0.4}, even) == (0, "draw")


def test_decaying_threshold_switch():
    bal = load_balance()
    bal["match"]["territory_decay"] = True
    ec = economy(bal)
    assert ec.threshold(0) == 0.75
    assert abs(ec.threshold(ec.time_limit / 2) - 0.65) < 1e-9
    assert ec.threshold(ec.time_limit) == 0.55


def test_match_with_economy_ends_at_the_time_limit():
    bal = load_balance()
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

    import numpy as np

    from prototype.match import FIELD_EVERY, export_replay

    bal = load_balance()
    fl = Flora(bal)
    fa = Fauna(bal, fl)
    record = []
    rows, _, _, log = run(fl, 24, 3, seed=1, fauna=fa, economy=Economy(bal, fl, fa), record=record)
    export_replay(tmp_path / "r", fl, fa, 24, record, rows, log, ("forest", "meadow"))
    meta = json.loads((tmp_path / "r" / "replay.json").read_text(encoding="utf-8"))
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8")) == ["r"]
    assert meta["ticks"] == len(record) and len(meta["series"]["t_s"]) == len(rows)
    data = gzip.decompress((tmp_path / "r" / "frames.bin.gz").read_bytes())
    pos, fields, animals = 0, 0, 0
    for tick in range(meta["ticks"]):
        count = int(np.frombuffer(data, "<u4", 1, pos)[0])
        pos += 4 + 10 * count
        animals = max(animals, count)
        if tick % FIELD_EVERY == 0:
            owner = np.frombuffer(data, "u1", 24 * 24, pos)
            assert set(owner.tolist()) <= {0, 1, 2}
            pos += 4 * 24 * 24
            fields += 1
    assert pos == len(data) and fields == (meta["ticks"] - 1) // FIELD_EVERY + 1
    assert animals > 0
