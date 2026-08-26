// A Row rendered as the /query wire object, byte-for-byte as the Deno server's
// `jsonOf` builds it (client.ts). Two conventions the file reader drops that the
// WIRE keeps, and this module restores:
//
//   1. NULL columns are SPELLED. store.rs skips a NULL column (the file simply
//      has no key), but the /query route emits every readable column of a
//      present component, `null` where the value is absent — so `.assignee=`
//      (the absence test) reads the same through both doors (the remote.rs
//      parity note, inverted: there the client DROPS nulls to match the file;
//      here the server ADDS them to match the wire).
//   2. The comp order and column order are the vocabulary's declaration order.
//      store.rs already assembles `row.comps` in comps order (entity first),
//      and each comp's map in `readable()` order minus nulls; this walks
//      `readable()` again to re-insert the nulls in place.
//
// The entity spine is special exactly as jsonOf makes it: `eid` is the entity's
// address, not a column, so it leads the object and the rest of entity's
// readable columns (num, …) follow.

use serde_json::{Map, Value};
use yak_kernel::vocab::vocab;
use yak_kernel::{Dep, Row};

// JS numbers are all f64, and `JSON.stringify` prints an integer-valued one
// WITHOUT a decimal (`0`, not `0.0`; `2`, not `2.0`). The Deno server reads a
// SQLite REAL column through node:sqlite as such a number, so `priority` (a
// REAL 0.0 in storage) rides the wire as `0`. rusqlite hands the same column
// back as an f64 and serde_json prints `0.0` — a one-byte divergence on every
// integer-valued real. Normalize on the way out: a float with no fractional
// part and within the exact-integer range becomes an integer, matching JS; a
// genuine fraction (a camera's 1.5) is untouched.
fn js_num(v: Value) -> Value {
    match &v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if n.as_i64().is_none()
                    && f.fract() == 0.0
                    && f.abs() < 9_007_199_254_740_992.0
                {
                    return Value::from(f as i64);
                }
            }
            v
        }
        _ => v,
    }
}

// One component's full wire object: every readable column in declaration order,
// the row's value or `null`. A membership-only comp (no readable columns) is
// `{}`, the same empty object the file and wire both spell.
fn comp_obj(name: &str, have: &Map<String, Value>) -> Value {
    let mut out = Map::new();
    for (col, _) in vocab().readable(name) {
        if col == "eid" && name == "entity" {
            continue; // eid leads the spine, inserted by row_to_wire
        }
        out.insert(col.clone(), js_num(have.get(&col).cloned().unwrap_or(Value::Null)));
    }
    Value::Object(out)
}

// The row as `{ kind, entity:{eid,num,…}, <comp>:{…}, … }`. `row.comps` is
// walked in its own insertion order — which store.rs built in vocabulary order,
// entity first — so the key order matches the route with no re-sort here.
pub fn row_to_wire(row: &Row) -> Value {
    let mut out = Map::new();
    out.insert("kind".into(), Value::from(row.kind.as_str()));
    for (name, val) in &row.comps {
        let have = val.as_object().cloned().unwrap_or_default();
        if name == "entity" {
            let mut spine = Map::new();
            spine.insert("eid".into(), Value::from(row.eid.as_str()));
            if let Value::Object(rest) = comp_obj("entity", &have) {
                for (k, v) in rest {
                    spine.insert(k, v);
                }
            }
            out.insert("entity".into(), Value::Object(spine));
        } else {
            out.insert(name.clone(), comp_obj(name, &have));
        }
    }
    Value::Object(out)
}

// A component as it rides a CHANGE (a snapshot/catchup/live frame), which is a
// different shape from the /query hit: `eager()` prefixes every comp with its
// `eid` and keeps NULL columns, so the comp is `{eid, <readable cols, nulls>}`
// — entity included (`{eid, num}`). This is `spread(eid, comps)` on the wire.
pub fn change_comp(eid: &str, name: &str, have: &Map<String, Value>) -> Value {
    let mut out = Map::new();
    out.insert("eid".into(), Value::from(eid));
    for (col, _) in vocab().readable(name) {
        if col == "eid" {
            continue;
        }
        out.insert(col.clone(), js_num(have.get(&col).cloned().unwrap_or(Value::Null)));
    }
    Value::Object(out)
}

// One entity's rows as the change list a snapshot carries — every present comp
// in vocabulary order, each `{eid, …}`. `row.comps` is already in that order.
pub fn entity_changes(row: &Row) -> Vec<Value> {
    row.comps
        .iter()
        .map(|(name, val)| {
            let have = val.as_object().cloned().unwrap_or_default();
            let mut m = Map::new();
            m.insert("eid".into(), Value::from(row.eid.as_str()));
            m.insert("name".into(), Value::from(name.as_str()));
            m.insert("comp".into(), change_comp(&row.eid, name, &have));
            Value::Object(m)
        })
        .collect()
}

// A Dep as the deps=1 layer spells it: `{parent, type, child}`, that key order.
pub fn dep_to_wire(d: &Dep) -> Value {
    let mut m = Map::new();
    m.insert("parent".into(), Value::from(d.parent.as_str()));
    m.insert("type".into(), Value::from(d.type_.as_str()));
    m.insert("child".into(), Value::from(d.child.as_str()));
    Value::Object(m)
}

// A hit with its optional layers, exactly as the route spreads them:
// `{ ...jsonOf(r), deps?, backlinks? }` — layer keys come AFTER the comps.
pub fn hit_with_layers(row: &Row, deps: Option<Vec<Dep>>) -> Value {
    let mut v = row_to_wire(row);
    if let (Some(deps), Value::Object(m)) = (deps, &mut v) {
        m.insert(
            "deps".into(),
            Value::Array(deps.iter().map(dep_to_wire).collect()),
        );
    }
    v
}
