//! Exact parity with the Python prototype's quant mode (D-034). The fixture comes from
//! `npm run rs:fixture` (tools/prototype/fixture.py) and embeds the TOML it was made with.

use serde::Deserialize;
use sim_core::balance::Balance;
use sim_core::flora::{Flora, FloraParams, FloraState};

#[derive(Deserialize)]
struct Fixture {
    balance: String,
    species: String,
    n: usize,
    params: Params,
    checkpoints: Vec<Checkpoint>,
}

#[derive(Deserialize)]
struct Params {
    kmax: Vec<i64>,
    rdt: Vec<i64>,
    rate: Vec<i64>,
    soil_dt: Vec<i64>,
    cast: Vec<i64>,
    tol: Vec<i64>,
    seed_b: Vec<i64>,
    est_thr: Vec<i64>,
    smother: Vec<i64>,
    litter: Vec<i64>,
    soil_min: Vec<i64>,
    w_opt: Vec<i64>,
    w_tol: Vec<i64>,
    l_opt: Vec<i64>,
    l_tol: Vec<i64>,
    aff: Vec<Vec<i64>>,
    cap: Vec<i64>,
    alpha: i64,
    plant_g: i64,
    soil_ramp: i64,
    water0: i64,
    light0: i64,
}

#[derive(Deserialize)]
struct Checkpoint {
    t: u64,
    owner: Vec<u8>,
    bio: Vec<i64>,
    gauge: Vec<i64>,
    soil: Vec<i64>,
    soil_type: Vec<u8>,
    water: Vec<i64>,
    light: Vec<i64>,
    prog: [Vec<i64>; 2],
    dead: Vec<i64>,
}

fn fixture() -> Fixture {
    let text = include_str!("fixtures/flora_parity.json");
    serde_json::from_str(text).expect("fixture parses (regenerate with npm run rs:fixture)")
}

/// Assert equal arrays, reporting the first difference and where it is.
fn same<T: PartialEq + std::fmt::Debug>(what: &str, t: u64, n: usize, got: &[T], want: &[T]) {
    assert_eq!(got.len(), want.len(), "{what} length at tick {t}");
    if let Some(i) = (0..got.len()).find(|&i| got[i] != want[i]) {
        let (layer, k) = (i / (n * n), i % (n * n));
        panic!(
            "{what} differs at tick {t}: layer {layer}, row {}, col {}: rust {:?}, prototype {:?}",
            k / n,
            k % n,
            got[i],
            want[i]
        );
    }
}

#[test]
fn params_convert_like_the_prototype() {
    let fx = fixture();
    let p = FloraParams::from_balance(&Balance::from_toml(&fx.balance, &fx.species).unwrap());
    let w = &fx.params;
    for (name, got, want) in [
        ("kmax", &p.kmax, &w.kmax),
        ("rdt", &p.rdt, &w.rdt),
        ("rate", &p.rate, &w.rate),
        ("soil_dt", &p.soil_dt, &w.soil_dt),
        ("cast", &p.cast, &w.cast),
        ("tol", &p.tol, &w.tol),
        ("seed_b", &p.seed_b, &w.seed_b),
        ("est_thr", &p.est_thr, &w.est_thr),
        ("smother", &p.smother, &w.smother),
        ("litter", &p.litter, &w.litter),
        ("soil_min", &p.soil_min, &w.soil_min),
        ("w_opt", &p.w_opt, &w.w_opt),
        ("w_tol", &p.w_tol, &w.w_tol),
        ("l_opt", &p.l_opt, &w.l_opt),
        ("l_tol", &p.l_tol, &w.l_tol),
        ("cap", &p.cap, &w.cap),
    ] {
        assert_eq!(got, want, "{name}");
    }
    assert_eq!(p.aff, w.aff, "aff");
    assert_eq!(
        (p.alpha, p.plant_g, p.soil_ramp, p.water0, p.light0),
        (w.alpha, w.plant_g, w.soil_ramp, w.water0, w.light0)
    );
}

#[test]
fn flora_steps_match_the_prototype_exactly() {
    let fx = fixture();
    let flora = Flora::new(FloraParams::from_balance(
        &Balance::from_toml(&fx.balance, &fx.species).unwrap(),
    ));
    let first = &fx.checkpoints[0];
    let mut st = FloraState::new(&flora.p, fx.n);
    st.owner.clone_from(&first.owner);
    st.bio.clone_from(&first.bio);
    st.gauge.clone_from(&first.gauge);
    st.soil.clone_from(&first.soil);
    st.soil_type.clone_from(&first.soil_type);
    st.water.clone_from(&first.water);
    st.light.clone_from(&first.light);
    st.prog.clone_from(&first.prog);
    st.dead.clone_from(&first.dead);
    for cp in &fx.checkpoints {
        while st.t < cp.t {
            flora.step(&mut st);
        }
        let n = fx.n;
        same("owner", cp.t, n, &st.owner, &cp.owner);
        same("bio", cp.t, n, &st.bio, &cp.bio);
        same("gauge", cp.t, n, &st.gauge, &cp.gauge);
        same("soil", cp.t, n, &st.soil, &cp.soil);
        same("prog[0]", cp.t, n, &st.prog[0], &cp.prog[0]);
        same("prog[1]", cp.t, n, &st.prog[1], &cp.prog[1]);
        same("dead", cp.t, n, &st.dead, &cp.dead);
    }
}
