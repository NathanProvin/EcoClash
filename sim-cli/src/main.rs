//! Headless runner (INSTRUCTIONS §9, ROADMAP M1.6):
//!
//! ```text
//! sim-cli run --seed N --ticks T [--commands file.jsonl] [--size N]
//!             [--balance data/balance.toml] [--species data/species.toml]
//!             [--out metrics.csv] [--hashes hashes.csv] [--sandbox 1]
//! ```
//!
//! `--sandbox 1` plays with every species unlocked and free (D-058): command files that plant any
//! species, like the prototype cross-check, need it.
//!
//! Prints the balance hash and the final state hash. `--hashes` writes the hash of every tick;
//! `--out` writes metrics once per flora tick (territory, biomass, cells of each plant species per
//! player). The command file holds one JSON command per line (`sim_core::commands::Command`).

mod bench;

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs;
use std::process::ExitCode;

use sim_core::balance::Balance;
use sim_core::commands::Command;
use sim_core::hash::balance_hash;
use sim_core::terrain::TerrainParams;
use sim_core::world::World;

const USAGE: &str = "usage: sim-cli run --seed N --ticks T [--commands file.jsonl] [--size N] \
[--balance data/balance.toml] [--species data/species.toml] [--out metrics.csv] [--hashes hashes.csv] \
[--sandbox 1] [--terrain 1]";

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("sim-cli: {e}\n{USAGE}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let Some((cmd, rest)) = args.split_first() else {
        return Err("missing command".into());
    };
    if cmd == "bench" {
        return bench_cmd(rest);
    }
    if cmd != "run" {
        return Err(format!("unknown command {cmd}"));
    }
    let opts = options(rest)?;
    let get = |k: &str, default: &str| opts.get(k).map_or(default.to_string(), Clone::clone);
    let number = |k: &str, default: &str| {
        get(k, default)
            .parse::<u64>()
            .map_err(|e| format!("--{k}: {e}"))
    };
    let read = |path: String| fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"));

    let balance = Balance::from_toml(
        &read(get("balance", "data/balance.toml"))?,
        &read(get("species", "data/species.toml"))?,
    )?;
    let seed = number("seed", "1")?;
    let ticks = number("ticks", "")?;
    let size = number("size", &balance.sim.grid_size.to_string())?;
    let size = usize::try_from(size).map_err(|e| format!("--size: {e}"))?;

    let mut world = World::new(&balance, seed, size);
    world.set_sandbox(number("sandbox", "0")? != 0);
    if number("terrain", "0")? != 0 {
        world.generate_terrain(&TerrainParams::from_balance(&balance), seed); // D-083
    }
    if let Some(path) = opts.get("commands") {
        for (i, line) in read(path.clone())?.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let c: Command =
                serde_json::from_str(line).map_err(|e| format!("{path}:{}: {e}", i + 1))?;
            world.submit(c);
        }
    }

    println!("balance hash {:016x}", balance_hash(&balance));
    let names = world.flora.p.names.clone();
    let mut metrics = String::from("tick,flora_tick,hash");
    for p in [1, 2] {
        let _ = write!(metrics, ",territory_p{p},biomass_p{p}");
        for name in &names {
            let _ = write!(metrics, ",cells_{name}_p{p}");
        }
    }
    metrics.push('\n');
    let mut hashes = String::from("tick,hash\n");
    let mut last = world.hash();
    for _ in 0..ticks {
        let flora_before = world.state.t;
        last = world.step();
        let _ = writeln!(hashes, "{},{last:016x}", world.tick);
        if world.state.t != flora_before {
            metrics.push_str(&metric_row(&world, last));
        }
    }
    if let Some(path) = opts.get("out") {
        fs::write(path, metrics).map_err(|e| format!("{path}: {e}"))?;
    }
    if let Some(path) = opts.get("hashes") {
        fs::write(path, hashes).map_err(|e| format!("{path}: {e}"))?;
    }
    println!(
        "tick {} state hash {last:016x} (rejected commands: {})",
        world.tick, world.rejected
    );
    Ok(())
}

/// `sim-cli bench` (D-142): bot-vs-bot matches in parallel, one compact table of phase markers.
fn bench_cmd(rest: &[String]) -> Result<(), String> {
    let opts = options(rest)?;
    let get = |k: &str, d: &str| opts.get(k).map_or(d.to_string(), Clone::clone);
    let number = |k: &str, d: &str| get(k, d).parse::<u64>().map_err(|e| format!("--{k}: {e}"));
    let read = |path: String| fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"));
    let b = Balance::from_toml(
        &read(get("balance", "data/balance.toml"))?,
        &read(get("species", "data/species.toml"))?,
    )?;
    let seat = |k: &str, d: &str| {
        bench::Seat::parse(&get(k, d)).ok_or(format!(
            "--{k}: level[:style[:locked]], level easy, normal or hard, style wide, tall, rush or balanced"
        ))
    };
    let size = usize::try_from(number("size", &b.sim.grid_size.to_string())?)
        .map_err(|e| e.to_string())?;
    let threads = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
    let threads = usize::try_from(number("threads", &threads.to_string())?).unwrap_or(4);
    let (seeds, minutes) = (number("seeds", "8")?, number("minutes", "45")?);
    if let Some(level) = opts.get("matrix") {
        let level = sim_ai::Level::parse(level).ok_or("--matrix: easy, normal or hard")?;
        print!(
            "{}",
            bench::matrix(&b, seeds, size, level, minutes, threads)
        );
        return Ok(());
    }
    if let Some(style) = opts.get("ladder") {
        let style = sim_ai::Style::parse(style).ok_or("--ladder: wide, tall, rush or balanced")?;
        print!(
            "{}",
            bench::ladder(&b, seeds, size, style, minutes, threads)
        );
        return Ok(());
    }
    let seats = [seat("p1", "normal")?, seat("p2", "hard")?];
    let ms = bench::run(&b, seeds, size, seats, minutes, threads);
    print!("{}", bench::summary(&ms, seats));
    Ok(())
}

/// `--key value` pairs.
fn options(rest: &[String]) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    let mut it = rest.iter();
    while let Some(key) = it.next() {
        let key = key
            .strip_prefix("--")
            .ok_or(format!("expected --option, got {key}"))?;
        let value = it.next().ok_or(format!("--{key} needs a value"))?;
        out.insert(key.to_string(), value.clone());
    }
    Ok(out)
}

/// One metrics line: cells owned and biomass per player, cells held by each species.
fn metric_row(w: &World, hash: u64) -> String {
    let st = &w.state;
    let cells = st.n * st.n;
    let mut row = format!("{},{},{hash:016x}", w.tick, st.t);
    for player in [1u8, 2] {
        let owned = st.owner.iter().filter(|&&o| o == player).count();
        let biomass: i64 = (0..st.bio.len())
            .filter(|&i| st.owner[i % cells] == player)
            .map(|i| st.bio[i])
            .sum();
        let _ = write!(row, ",{owned},{biomass}");
        for s in 0..w.flora.p.species() {
            let held = (0..cells)
                .filter(|&k| st.owner[k] == player && st.bio[s * cells + k] > 0)
                .count();
            let _ = write!(row, ",{held}");
        }
    }
    row.push('\n');
    row
}
