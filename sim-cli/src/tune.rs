//! `sim-cli tune` (Alpha 1.7, B2): a (1+1) self-play search over the Hard bot's play
//! (`[bots.hard]`). Each round nudges one or two knobs of the champion by about 20 % and plays
//! the challenger against it: both seats, the same income, balanced style. A challenger that wins
//! WIN_PCT % of the decided matches becomes the champion. Fewer than 24 seeds (48 matches) per round
//! keeps noise: at 8, a challenger kept 11/16 then lost 18/48 to the champion it replaced. Prints one line per round, then the
//! champion as a `[bots.hard]` table to paste into balance.toml.
//!
//! sim-cli tune [--rounds 20] [--seeds 24] [--size 38] [--minutes 45] [--threads K] [--seed 1]
//!
//! The champion plays from the Normal slot of a copy of the balance, with Hard's income: the
//! bench runner seats bots by level, and a level's play is all in its table (B1).

use std::fmt::Write as _;

use sim_ai::{Level, Style};
use sim_core::balance::{Balance, BotLevel};
use sim_core::rng::Pcg32;

use crate::bench::{self, Seat};

/// A challenger must win this share (%) of the decided matches to replace the champion.
const WIN_PCT: u64 = 58;

/// The knobs the search moves, with their bounds (the booleans stay as the level has them).
const KNOBS: [(&str, i64, i64); 9] = [
    ("period_ticks", 5, 60),
    ("actions", 1, 8),
    ("raid_s", 10, 300),
    ("raid_herd", 2, 16),
    ("drop_s", 0, 300),
    ("grazer_cards", 2, 16),
    ("reaction_s", 0, 60),
    ("adapt_s", 0, 300),
    ("adapt_shift", 0, 40),
];

/// Knob `k` of a level, as an integer.
fn get(lv: &BotLevel, k: usize) -> i64 {
    let v = match k {
        0 => lv.period_ticks,
        1 => lv.actions as u64,
        2 => lv.raid_s,
        3 => lv.raid_herd as u64,
        4 => lv.drop_s,
        5 => return lv.grazer_cards,
        6 => lv.reaction_s,
        7 => lv.adapt_s,
        _ => return lv.adapt_shift,
    };
    i64::try_from(v).unwrap_or(i64::MAX)
}

fn set(lv: &mut BotLevel, k: usize, v: i64) {
    let u = u64::try_from(v).unwrap_or(0);
    match k {
        0 => lv.period_ticks = u,
        1 => lv.actions = usize::try_from(u).unwrap_or(1),
        2 => lv.raid_s = u,
        3 => lv.raid_herd = usize::try_from(u).unwrap_or(2),
        4 => lv.drop_s = u,
        5 => lv.grazer_cards = v,
        6 => lv.reaction_s = u,
        7 => lv.adapt_s = u,
        _ => lv.adapt_shift = v,
    }
}

/// The champion with one or two knobs nudged up or down by a fifth (at least 1), within bounds;
/// and what moved.
fn mutate(lv: &BotLevel, rng: &mut Pcg32) -> (BotLevel, String) {
    let mut c = *lv;
    let mut what = Vec::new();
    for _ in 0..=rng.below(2) {
        let k = rng.below(9) as usize;
        let (name, lo, hi) = KNOBS[k];
        let x = get(&c, k);
        let d = (x / 5).max(1);
        let y = if rng.chance(1, 2) { x + d } else { x - d }.clamp(lo, hi);
        set(&mut c, k, y);
        what.push(format!("{name} {x}->{y}"));
    }
    (c, what.join(", "))
}

/// Challenger against champion over `seeds` maps in both seat orders: (challenger wins,
/// decided matches).
fn duel(b: &Balance, champ: BotLevel, chal: BotLevel, opts: &Opts) -> (u64, u64) {
    let mut v = b.clone();
    v.bots.normal = champ;
    v.bots.hard = chal;
    v.bots.income[1] = v.bots.income[2];
    let seat = |level| Seat {
        level,
        style: Style::Balanced,
        adapt: true,
    };
    let (mut wins, mut decided) = (0, 0);
    for seats in [
        [seat(Level::Normal), seat(Level::Hard)],
        [seat(Level::Hard), seat(Level::Normal)],
    ] {
        for m in bench::run(&v, opts.seeds, opts.size, seats, opts.minutes, opts.threads) {
            if let Some((winner @ 1..=2, ..)) = m.end {
                decided += 1;
                wins += u64::from(seats[usize::from(winner) - 1].level == Level::Hard);
            }
        }
    }
    (wins, decided)
}

pub struct Opts {
    pub rounds: u64,
    pub seeds: u64,
    pub size: usize,
    pub minutes: u64,
    pub threads: usize,
    pub seed: u64,
}

/// The search; returns its log and the final table.
#[must_use]
pub fn tune(b: &Balance, opts: &Opts) -> String {
    let mut rng = Pcg32::new(opts.seed, 7);
    let mut champ = b.bots.hard;
    let mut out = String::new();
    for round in 1..=opts.rounds {
        let (chal, what) = mutate(&champ, &mut rng);
        let (wins, decided) = duel(b, champ, chal, opts);
        let kept = decided > 0 && wins * 100 >= WIN_PCT * decided;
        if kept {
            champ = chal;
        }
        let verdict = if kept { "kept" } else { "dropped" };
        let line = format!("round {round:>2}: {what}: {wins}/{decided} {verdict}");
        eprintln!("{line}"); // progress while the rounds run
        let _ = writeln!(out, "{line}");
    }
    let (wins, decided) = duel(b, b.bots.hard, champ, opts);
    let _ = writeln!(
        out,
        "champion vs shipped hard: {wins}/{decided}\n[bots.hard]\n{}",
        table(&champ)
    );
    out
}

/// A level as balance.toml lines.
fn table(lv: &BotLevel) -> String {
    let mut t = format!(
        "found_ticks = {}
",
        lv.found_ticks
    );
    for (k, (name, ..)) in KNOBS.iter().enumerate() {
        let _ = writeln!(t, "{name} = {}", get(lv, k));
    }
    let _ = write!(
        t,
        "stalkers = {}\nanticipate = {}\ncasts = {}",
        lv.stalkers, lv.anticipate, lv.casts
    );
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutations_stay_in_bounds_and_replay() {
        let lv = BotLevel::hard();
        let (mut r1, mut r2) = (Pcg32::new(3, 7), Pcg32::new(3, 7));
        for _ in 0..200 {
            let (a, wa) = mutate(&lv, &mut r1);
            let (b, wb) = mutate(&lv, &mut r2);
            assert_eq!((a, wa), (b, wb), "same seed, same challenger");
            for (k, &(_, lo, hi)) in KNOBS.iter().enumerate() {
                assert!((lo..=hi).contains(&get(&a, k)), "{a:?}");
            }
        }
    }

    #[test]
    fn a_table_reads_back_as_the_level() {
        let lv = BotLevel::hard();
        let mut back = BotLevel::easy();
        for (k, _) in KNOBS.iter().enumerate() {
            set(&mut back, k, get(&lv, k));
        }
        (back.stalkers, back.anticipate, back.casts) = (lv.stalkers, lv.anticipate, lv.casts);
        back.found_ticks = lv.found_ticks;
        assert_eq!(back, lv);
        assert!(table(&lv).contains("period_ticks = 15"));
    }
}
