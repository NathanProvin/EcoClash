//! `sim-cli bench` (D-142): bot-vs-bot matches across threads, reduced to the phase markers of a
//! match (when each tier, plant layer, hunter and catastrophe arrives; when biomass grows
//! fastest; how many animals are on the map; how it ends), printed as one compact table.
//!
//! sim-cli bench --seeds N [--size 32] [--p1 normal] [--p2 hard] [--minutes 45] [--threads K]
//! TRACE=<minute> prints seed 1's unlocks, census and notices at that minute (to stderr).

use std::fmt::Write as _;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use sim_ai::{Bot, Level};
use sim_core::balance::Balance;
use sim_core::commands::{Command, Payload};
use sim_core::fauna::Role;
use sim_core::terrain::TerrainParams;
use sim_core::world::{Reason, World};

/// Ticks per second and between two samples of the markers (1 s) and of the biomass (30 s).
const HZ: u64 = 10;
const SAMPLE: u64 = HZ;
const GROWTH_EVERY: u64 = 30 * HZ;
/// Minutes at which the animals on the map are counted.
const COUNT_AT: [u64; 3] = [10, 20, 30];

/// One match, seen from both players. Times in seconds (None: never).
#[derive(Clone, Debug, Default)]
pub struct Markers {
    pub animal: [Option<u64>; 2],
    pub tier2: [Option<u64>; 2],
    pub tier3: [Option<u64>; 2],
    /// The first plant of layer 2, 3, 4 held.
    pub layer: [[Option<u64>; 2]; 3],
    pub hunter: [Option<u64>; 2],
    /// The first attack-move order (D-148).
    pub raid: [Option<u64>; 2],
    /// Share of the map held (%) at 5 and 10 min (D-148).
    pub share: [[u64; 2]; 2],
    pub catastrophe: [Option<u64>; 2],
    /// When the standing biomass grew fastest (over 30 s).
    pub peak: [Option<u64>; 2],
    /// Animals on the map at COUNT_AT: (units, swarm members).
    pub animals: [[(u64, u64); 2]; 3],
    /// Spawn orders per species name (both players).
    pub called: std::collections::BTreeMap<String, u64>,
    /// Income per second and bank (biomass) at COUNT_AT.
    pub economy: [[(i64, i64); 2]; 3],
    /// Spawn orders sent, species at their cap at 20 min.
    pub calls: [u64; 2],
    pub capped: [u64; 2],
    /// Land held at the end (cells), per player.
    pub land: [i64; 2],
    /// Winner (0 draw), reason, end (s); None: still running at the end.
    pub end: Option<(u8, Reason, u64)>,
    pub minutes: u64,
    /// Names on the stat sheet: plants, animals (D-190).
    pub flora_names: Vec<String>,
    pub fauna_names: Vec<String>,
    /// Sides that had unlocked each species by the end (D-190).
    pub unlocked: std::collections::BTreeMap<String, u64>,
    /// Raids on own land (RAID_SIZE enemy grazers or more) answered by a call of a hunter that
    /// eats one of the raiders: seconds from the raid's onset; raids never answered (D-190).
    pub answers: Vec<u64>,
    pub unanswered: u64,
    /// Hunter calls; of them, with primary prey within the drop radius; with any prey (D-190).
    pub fit: [u64; 3],
    /// The map has water; per side, a W, HW and PW species unlocked; HW and PW calls (D-190).
    pub water: bool,
    pub aquatic: [[bool; 3]; 2],
    pub water_calls: u64,
}

/// Enemy grazers on own land that make a raid (D-190), and seconds without them that end it.
const RAID_SIZE: usize = 3;
const RAID_GONE_S: u64 = 30;

/// Play one bot-vs-bot match on a generated map of `size`, for at most `minutes`.
#[must_use]
pub fn play(b: &Balance, seed: u64, size: usize, levels: [Level; 2], minutes: u64) -> Markers {
    let mut w = World::new(b, seed, size);
    w.generate_terrain(&TerrainParams::from_balance(b), seed);
    w.set_income_factor(1, levels[0].income(b));
    w.set_income_factor(2, levels[1].income(b));
    let mut bots = [
        Bot::new(1, levels[0], b.flora.plant_radius),
        Bot::new(2, levels[1], b.flora.plant_radius),
    ];
    // Tiers outside the herbs: the herb ladder is the early economy, cheap by design.
    let tier = |i: usize| {
        let plants = b.flora_species.len();
        if i < plants {
            let s = &b.flora_species[i].1;
            if s.family == "L1" { 0 } else { s.tier }
        } else {
            b.fauna_species[i - plants].1.tier
        }
    };
    let swarm: Vec<bool> = b.fauna_species.iter().map(|(_, s)| s.swarm).collect();
    let cheapest_card = w
        .catastrophes
        .p
        .cost
        .iter()
        .copied()
        .min()
        .unwrap_or(i64::MAX);
    let (n2, species) = (size * size, w.flora.p.species());
    let mut m = Markers {
        minutes,
        flora_names: b.flora_species.iter().map(|(n, _)| n.clone()).collect(),
        fauna_names: b.fauna_species.iter().map(|(n, _)| n.clone()).collect(),
        water: w
            .state
            .ground
            .iter()
            .any(|&g| g == sim_core::terrain::SHALLOW || g == sim_core::terrain::DEEP),
        ..Markers::default()
    };
    let family = |s: usize| b.fauna_species[s].1.family.as_str();
    let reach2 = u64::from(b.fauna.drop_radius).pow(2);
    // An open raid per side: (onset, species of the raiders as a mask, last second seen).
    let mut raids: [Option<(u64, u64, u64)>; 2] = [None; 2];
    let mut seq = [0u32; 2];
    let mut last_standing = [0i64; 2];
    let mut best_growth = [0i64; 2];
    let set = |slot: &mut Option<u64>, now: u64, hit: bool| {
        if hit && slot.is_none() {
            *slot = Some(now);
        }
    };
    for _ in 0..minutes * 60 * HZ {
        for bot in &mut bots {
            for payload in bot.think(&w) {
                let p = bot.player;
                if let Payload::Order {
                    kind: sim_core::commands::OrderKind::Attack,
                    ..
                } = &payload
                {
                    let at = w.tick / HZ;
                    m.raid[usize::from(p - 1)].get_or_insert(at);
                }
                if let Payload::Catastrophe { kind, .. } = &payload {
                    *m.called.entry(format!("cast {kind}")).or_insert(0) += 1;
                }
                if let Payload::Spawn { species, row, col } = &payload {
                    m.calls[usize::from(p - 1)] += 1;
                    *m.called.entry(species.clone()).or_insert(0) += 1;
                    if let Some(s) = w.fauna.p.index(species) {
                        if matches!(family(s), "HW" | "PW") {
                            m.water_calls += 1;
                        }
                        if w.fauna.p.role[s] == Role::Predator {
                            let (row, col) = (*row as usize, *col as usize);
                            let a = &w.fauna.agents;
                            let (mut primary, mut any) = (false, false);
                            for j in (0..a.len()).filter(|&j| a.owner[j] == 3 - p) {
                                let k = a.cell(j, size);
                                let d = (k / size).abs_diff(row).pow(2)
                                    + (k % size).abs_diff(col).pow(2);
                                if d as u64 <= reach2 {
                                    match w.fauna.p.prey_rank(s, usize::from(a.sp[j])) {
                                        Some(0) => (primary, any) = (true, true),
                                        Some(_) => any = true,
                                        None => {}
                                    }
                                }
                            }
                            m.fit[0] += 1;
                            m.fit[1] += u64::from(primary);
                            m.fit[2] += u64::from(any);
                            let pi = usize::from(p - 1);
                            if let Some((onset, mask, _)) = raids[pi]
                                && (0..64).any(|q| {
                                    mask >> q & 1 == 1 && w.fauna.p.prey_rank(s, q).is_some()
                                })
                            {
                                m.answers.push(w.tick / HZ - onset);
                                raids[pi] = None;
                            }
                        }
                    }
                }
                let s = &mut seq[usize::from(p - 1)];
                w.submit(Command {
                    tick: w.tick,
                    player: p,
                    seq: *s,
                    payload,
                });
                *s += 1;
            }
        }
        w.step();
        let now = w.tick / HZ;
        if w.tick.is_multiple_of(SAMPLE) {
            for p in 0..2 {
                let player = u8::try_from(p + 1).unwrap_or(1);
                let census = w.fauna.census(player);
                // Raids on this side's land (D-190): open, extend, or close unanswered.
                let a = &w.fauna.agents;
                let (mut count, mut mask) = (0usize, 0u64);
                for j in 0..a.len() {
                    let s = usize::from(a.sp[j]);
                    if a.owner[j] == 3 - player
                        && w.fauna.p.role[s] == Role::Herbivore
                        && w.state.owner[a.cell(j, size)] == player
                    {
                        count += 1;
                        mask |= 1 << s;
                    }
                }
                raids[p] = match raids[p] {
                    Some((onset, m0, _)) if count >= RAID_SIZE => Some((onset, m0 | mask, now)),
                    Some((_, _, last)) if now - last > RAID_GONE_S => {
                        m.unanswered += 1;
                        None
                    }
                    None if count >= RAID_SIZE => Some((now, mask, now)),
                    open => open,
                };
                set(&mut m.animal[p], now, census.iter().any(|&c| c > 0));
                let hunters = census
                    .iter()
                    .enumerate()
                    .any(|(s, &c)| c > 0 && w.fauna.p.role[s] == Role::Predator);
                set(&mut m.hunter[p], now, hunters);
                let unlocked = &w.economy.unlocked[p];
                let has_tier = |t: u8| unlocked.iter().enumerate().any(|(i, &u)| u && tier(i) == t);
                set(&mut m.tier2[p], now, has_tier(2));
                set(&mut m.tier3[p], now, has_tier(3));
                set(
                    &mut m.catastrophe[p],
                    now,
                    w.economy.bank[p] >= cheapest_card,
                );
                for (l, slot) in m.layer.iter_mut().enumerate() {
                    if slot[p].is_some() {
                        continue;
                    }
                    let level = u8::try_from(l + 2).unwrap_or(4);
                    let held = (0..species)
                        .filter(|&s| w.flora.p.level[s] == level)
                        .any(|s| {
                            (0..n2)
                                .any(|k| w.state.owner[k] == player && w.state.bio[s * n2 + k] >= 1)
                        });
                    set(&mut slot[p], now, held);
                }
                for (j, &at) in COUNT_AT.iter().enumerate() {
                    if now == at * 60 {
                        let (units, swarms) =
                            census.iter().enumerate().fold((0, 0), |(u, sw), (s, &c)| {
                                let c = u64::try_from(c).unwrap_or(0);
                                if swarm[s] { (u, sw + c) } else { (u + c, sw) }
                            });
                        m.animals[j][p] = (units, swarms);
                        let one = i64::from(sim_core::fixed::ONE);
                        m.economy[j][p] = (w.economy.income[p] / one, w.economy.bank[p] / one);
                    }
                }
                if seed == 1
                    && std::env::var("TRACE")
                        .ok()
                        .and_then(|v| v.parse::<u64>().ok())
                        == Some(now / 60)
                    && now.is_multiple_of(60)
                {
                    let names: Vec<&str> = (0..unlocked.len())
                        .filter(|&i| unlocked[i])
                        .map(|i| {
                            let pl = b.flora_species.len();
                            if i < pl {
                                b.flora_species[i].0.as_str()
                            } else {
                                b.fauna_species[i - pl].0.as_str()
                            }
                        })
                        .collect();
                    eprintln!(
                        "P{player} unlocked {names:?} census {census:?} bank {}",
                        w.economy.bank[p] >> 16
                    );
                    let mut seen = std::collections::BTreeMap::new();
                    for (pl, t) in &w.notices {
                        if *pl == player {
                            *seen.entry(t.clone()).or_insert(0) += 1;
                        }
                    }
                    eprintln!("  notices {seen:?}");
                }
                for (j, at) in [5u64, 10].into_iter().enumerate() {
                    if now == at * 60 {
                        let held = w.state.owner.iter().filter(|&&o| o == player).count();
                        m.share[j][p] = u64::try_from(held * 100 / n2).unwrap_or(0);
                    }
                }
                if now == 20 * 60 {
                    m.capped[p] = census
                        .iter()
                        .enumerate()
                        .filter(|&(s, &c)| c > 0 && c >= i64::from(b.fauna_species[s].1.cap))
                        .count() as u64;
                }
            }
        }
        if w.tick.is_multiple_of(GROWTH_EVERY) {
            let standing = w.standing();
            for p in 0..2 {
                let growth = standing[p] - last_standing[p];
                if growth > best_growth[p] {
                    best_growth[p] = growth;
                    m.peak[p] = Some(now);
                }
                last_standing[p] = standing[p];
            }
        }
        if let Some(o) = w.result {
            m.end = Some((o.winner, o.reason, o.tick / HZ));
            break;
        }
    }
    m.land = w.territory();
    m.unanswered += raids.iter().flatten().count() as u64;
    for p in 0..2 {
        for (i, &u) in w.economy.unlocked[p].iter().enumerate() {
            if !u {
                continue;
            }
            let pl = b.flora_species.len();
            let (name, fam) = if i < pl {
                (&b.flora_species[i].0, b.flora_species[i].1.family.as_str())
            } else {
                (
                    &b.fauna_species[i - pl].0,
                    b.fauna_species[i - pl].1.family.as_str(),
                )
            };
            *m.unlocked.entry(name.clone()).or_insert(0) += 1;
            if let Some(f) = ["W", "HW", "PW"].iter().position(|&x| x == fam) {
                m.aquatic[p][f] = true;
            }
        }
    }
    m
}

/// Run `seeds` matches over `threads` threads; seeds 1..=seeds.
#[must_use]
pub fn run(
    b: &Balance,
    seeds: u64,
    size: usize,
    levels: [Level; 2],
    minutes: u64,
    threads: usize,
) -> Vec<Markers> {
    let next = AtomicU64::new(1);
    let out = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            scope.spawn(|| {
                loop {
                    let seed = next.fetch_add(1, Ordering::Relaxed);
                    if seed > seeds {
                        break;
                    }
                    let m = play(b, seed, size, levels, minutes);
                    out.lock().map(|mut v| v.push((seed, m))).ok();
                }
            });
        }
    });
    let mut v = out.into_inner().unwrap_or_default();
    v.sort_by_key(|(s, _)| *s);
    v.into_iter().map(|(_, m)| m).collect()
}

/// p25, median, p75 of `values` (seconds) as m:ss, and how many never happened.
fn spread(values: &mut [u64], missing: usize) -> String {
    let clock = |s: u64| format!("{}:{:02}", s / 60, s % 60);
    if values.is_empty() {
        return format!("      -      -      -  never {missing}");
    }
    values.sort_unstable();
    let q = |f: usize| values[(values.len() - 1) * f / 4];
    let tail = if missing > 0 {
        format!("  never {missing}")
    } else {
        String::new()
    };
    format!(
        "{:>7}{:>7}{:>7}{tail}",
        clock(q(1)),
        clock(q(2)),
        clock(q(3))
    )
}

/// The compact table: one line per marker (p25 / median / p75 over both players of every match).
#[must_use]
#[allow(clippy::float_arithmetic, clippy::cast_precision_loss)] // report figures only
pub fn summary(ms: &[Markers], levels: [Level; 2]) -> String {
    let mut t = String::new();
    let _ = writeln!(
        t,
        "{} matches, {:?} vs {:?}            p25    med    p75",
        ms.len(),
        levels[0],
        levels[1]
    );
    let mut line = |name: &str, pick: &dyn Fn(&Markers) -> [Option<u64>; 2]| {
        let all: Vec<Option<u64>> = ms.iter().flat_map(pick).collect();
        let mut v: Vec<u64> = all.iter().flatten().copied().collect();
        let missing = all.len() - v.len();
        let _ = writeln!(t, "{name:<28}{}", spread(&mut v, missing));
    };
    line("first animal", &|m| m.animal);
    line("tier 2 unlock", &|m| m.tier2);
    line("layer 2 (undergrowth)", &|m| m.layer[0]);
    line("layer 3 (shrubs)", &|m| m.layer[1]);
    line("first hunter", &|m| m.hunter);
    line("first raid", &|m| m.raid);
    line("biomass growth peak", &|m| m.peak);
    line("tier 3 unlock", &|m| m.tier3);
    line("layer 4 (trees)", &|m| m.layer[2]);
    line("catastrophe affordable", &|m| m.catastrophe);
    let mut ends: Vec<u64> = ms.iter().filter_map(|m| m.end.map(|e| e.2)).collect();
    let unfinished = ms.len() - ends.len();
    let _ = writeln!(t, "{:<28}{}", "match end", spread(&mut ends, unfinished));
    for (j, at) in [5, 10].into_iter().enumerate() {
        let side = |p: usize| {
            let mut v: Vec<u64> = ms.iter().map(|m| m.share[j][p]).collect();
            v.sort_unstable();
            v.get(v.len() / 2).copied().unwrap_or(0)
        };
        let _ = writeln!(t, "land at {at} min: P1 {} %, P2 {} %", side(0), side(1));
    }
    for (j, at) in COUNT_AT.iter().enumerate() {
        let (mut units, mut swarms): (Vec<u64>, Vec<u64>) =
            ms.iter().flat_map(|m| m.animals[j]).unzip();
        units.sort_unstable();
        swarms.sort_unstable();
        let med = |v: &[u64]| v.get(v.len() / 2).copied().unwrap_or(0);
        let (mut inc, mut bank): (Vec<i64>, Vec<i64>) =
            ms.iter().flat_map(|m| m.economy[j]).unzip();
        inc.sort_unstable();
        bank.sort_unstable();
        let mid = |v: &[i64]| v.get(v.len() / 2).copied().unwrap_or(0);
        let _ = writeln!(
            t,
            "at {at} min: units {} (max {}), swarm {}, income {}, bank {}",
            med(&units),
            units.last().unwrap_or(&0),
            med(&swarms),
            mid(&inc),
            mid(&bank)
        );
    }
    let calls: u64 = ms.iter().flat_map(|m| m.calls).sum();
    let played: u64 = ms
        .iter()
        .map(|m| m.end.map_or(m.minutes * 60, |e| e.2))
        .sum::<u64>()
        .max(1);
    let capped: u64 = ms.iter().flat_map(|m| m.capped).sum();
    let _ = writeln!(
        t,
        "calls per player-minute {:.2}, species at cap at 20 min {:.1}",
        calls as f64 * 60.0 / (2.0 * played as f64),
        capped as f64 / (2.0 * ms.len().max(1) as f64)
    );
    let mut by: std::collections::BTreeMap<&str, u64> = std::collections::BTreeMap::new();
    for m in ms {
        for (k, v) in &m.called {
            *by.entry(k.as_str()).or_insert(0) += v;
        }
    }
    let mut top: Vec<(&str, u64)> = by.into_iter().collect();
    top.sort_by_key(|(_, v)| std::cmp::Reverse(*v));
    let top: Vec<String> = top
        .iter()
        .take(6)
        .map(|(k, v)| format!("{k} {v}"))
        .collect();
    let _ = writeln!(t, "top calls: {}", top.join(", "));
    // D-190: does the bot use the whole roster, answer raids, call fitting hunters, use water?
    let fauna = ms
        .first()
        .map(|m| m.fauna_names.clone())
        .unwrap_or_default();
    let flora = ms
        .first()
        .map(|m| m.flora_names.clone())
        .unwrap_or_default();
    let called = |name: &str| {
        ms.iter()
            .any(|m| m.called.get(name).is_some_and(|&c| c > 0))
    };
    let never: Vec<&str> = fauna
        .iter()
        .map(String::as_str)
        .filter(|n| !called(n))
        .collect();
    let _ = writeln!(
        t,
        "animals called {}/{}; never: {}",
        fauna.len() - never.len(),
        fauna.len(),
        never.join(", ")
    );
    let unlocked = |name: &str| ms.iter().any(|m| m.unlocked.contains_key(name));
    let locked: Vec<&str> = flora
        .iter()
        .chain(fauna.iter())
        .map(String::as_str)
        .filter(|n| !unlocked(n))
        .collect();
    let _ = writeln!(
        t,
        "never unlocked: {}",
        if locked.is_empty() {
            "none".into()
        } else {
            locked.join(", ")
        }
    );
    let mut answers: Vec<u64> = ms.iter().flat_map(|m| m.answers.iter().copied()).collect();
    answers.sort_unstable();
    let unanswered: u64 = ms.iter().map(|m| m.unanswered).sum();
    let raids = answers.len() as u64 + unanswered;
    let quick = answers.iter().filter(|&&s| s <= 60).count() as u64;
    let _ = writeln!(
        t,
        "raids answered {}/{raids} (median {} s; within 60 s {} %)",
        answers.len(),
        answers.get(answers.len() / 2).copied().unwrap_or(0),
        100 * quick / raids.max(1)
    );
    let fit = ms.iter().fold([0u64; 3], |f, m| {
        [f[0] + m.fit[0], f[1] + m.fit[1], f[2] + m.fit[2]]
    });
    let _ = writeln!(
        t,
        "hunter calls {}: primary prey in reach {} %, any prey {} %",
        fit[0],
        100 * fit[1] / fit[0].max(1),
        100 * fit[2] / fit[0].max(1)
    );
    let wet: Vec<&Markers> = ms.iter().filter(|m| m.water).collect();
    let sides = 2 * wet.len().max(1);
    let fam = |f: usize| 100 * wet.iter().flat_map(|m| m.aquatic).filter(|a| a[f]).count() / sides;
    let _ = writeln!(
        t,
        "water maps {}/{}: sides with W {} %, HW {} %, PW {} %; water calls per match {:.1}",
        wet.len(),
        ms.len(),
        fam(0),
        fam(1),
        fam(2),
        wet.iter().map(|m| m.water_calls).sum::<u64>() as f64 / wet.len().max(1) as f64
    );
    let casts: u64 = ms
        .iter()
        .flat_map(|m| m.called.iter())
        .filter(|(k, _)| k.starts_with("cast"))
        .map(|(_, v)| v)
        .sum();
    let open: Vec<&Markers> = ms.iter().filter(|m| m.end.is_none()).collect();
    let lead = |p: usize| open.iter().filter(|m| m.land[p] > m.land[1 - p]).count();
    let share: i64 = open
        .iter()
        .map(|m| 100 * m.land[0] / (m.land[0] + m.land[1]).max(1))
        .sum::<i64>()
        / i64::try_from(open.len().max(1)).unwrap_or(1);
    let _ = writeln!(
        t,
        "casts {casts}; unfinished: P1 leads {} / P2 leads {}, P1 share of held land {share} %",
        lead(0),
        lead(1)
    );
    let per: String = ms
        .iter()
        .map(|m| match m.end {
            Some((1, ..)) => '1',
            Some((2, ..)) => '2',
            Some(_) => '=',
            None if m.land[0] > m.land[1] => 'a',
            None => 'b',
        })
        .collect();
    let _ = writeln!(t, "per seed (1/2 won, a/b leads unfinished): {per}");
    let wins = |p: u8| {
        ms.iter()
            .filter(|m| m.end.is_some_and(|e| e.0 == p))
            .count()
    };
    let reasons = |r: Reason| {
        ms.iter()
            .filter(|m| m.end.is_some_and(|e| e.1 == r))
            .count()
    };
    let _ = writeln!(
        t,
        "wins P1 {} / P2 {} / draw {} / unfinished {}; by territory {}, biomass {}",
        wins(1),
        wins(2),
        wins(0),
        ms.iter().filter(|m| m.end.is_none()).count(),
        reasons(Reason::Territory),
        reasons(Reason::Biomass)
    );
    t
}
