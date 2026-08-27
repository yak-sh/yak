// The vocabulary contract's runtime side (D-22530 §6). This crate owns the
// registry TYPES the `#[derive(Comp)]` macro submits into (CompDef and its
// column/index/enum/rename/edge companions), the MARKER prop types a contract
// field wears (Text/Body/… /Ref/Sel/Well), and the ASSEMBLER that turns the
// inventory of contributions into the per-plugin data manifest — the exact
// shape gen.ts once read from TOML, now generated interchange emitted FROM the
// Rust source of truth. Nothing here parses at runtime in the kernel; it is a
// build-tool library the xtask drives.
//
// Collision refusal and rank order live in the emitter side (assemble), so the
// manifest a plugin ships is order-independent by construction — the same
// promise the TOML pipeline made, with the arrow reversed.

use serde_json::{json, Map, Value};

// ---- registry types (what #[derive(Comp)] emits) --------------------------

// A column's PropType, mirroring types.ts. A scalar is one word; a reference,
// a closed set, or an open well carry their parameter.
pub enum Prop {
    Text,
    Body,
    Number,
    Priority,
    Bool,
    Time,
    Url,
    Query,
    // A closed set named once in the plugin's enums (aliases are input
    // spellings only — they never ride into the value list).
    EnumNamed { name: &'static str, aliases: &'static [(&'static str, &'static str)] },
    // A closed set spelled inline, for one-off two/three-value columns.
    EnumInline(&'static [&'static str]),
    // An association; `target` names the component the referent carries,
    // `death` what the reference means once that referent dies.
    Eid { target: &'static str, death: &'static str },
    // Open text with suggestions from a named well the browser registers.
    Well(&'static str),
}

pub struct ColDef {
    pub name: &'static str,
    pub prop: Prop,
}

pub struct IndexDef {
    pub cols: &'static [&'static str],
    pub unique: bool,
    pub where_: Option<&'static str>,
}

pub struct CompDef {
    pub plugin: &'static str,
    pub name: &'static str,
    pub rank: Option<i64>,
    pub wire: Option<bool>,
    pub stamped_rank: Option<i64>,
    pub kind_rank: Option<i64>,
    pub prefix: Option<&'static str>,
    pub by_name: bool,
    pub lazy: bool,
    pub log: bool,
    pub plural: Option<&'static str>,
    pub cols: &'static [ColDef],
    pub stamped: &'static [ColDef],
    pub indexes: &'static [IndexDef],
}
inventory::collect!(CompDef);

pub struct EnumDef {
    pub plugin: &'static str,
    pub name: &'static str,
    pub rank: i64,
    pub values: &'static [&'static str],
}
inventory::collect!(EnumDef);

pub struct RenameDef {
    pub plugin: &'static str,
    pub from: &'static str,
    pub to: &'static str,
}
inventory::collect!(RenameDef);

// The kernel-owned edge vocabulary — one submit, order preserved.
pub struct EdgesDef {
    pub plugin: &'static str,
    pub edges: &'static [&'static str],
}
inventory::collect!(EdgesDef);

// The sessions-owned capability/active/facet lists — one submit each.
pub struct SessionListsDef {
    pub plugin: &'static str,
    pub session_active: &'static [&'static str],
    pub capabilities: &'static [&'static str],
    pub session_facets: &'static [&'static str],
}
inventory::collect!(SessionListsDef);

// ---- marker prop types (what a contract field's type names) ---------------
// A scalar field wears its type; a reference/set/well field wears a neutral
// marker and lets its #[col(...)] attribute carry the parameter.
macro_rules! markers {
    ($($m:ident),*) => { $( pub struct $m; )* };
}
markers!(Text, Body, Number, Priority, Bool, Time, Url, Query, Ref, Sel, Well);

// ---- assemble → the per-plugin data manifest ------------------------------

fn prop_json(p: &Prop) -> Value {
    match p {
        Prop::Text => json!("text"),
        Prop::Body => json!("body"),
        Prop::Number => json!("number"),
        Prop::Priority => json!("priority"),
        Prop::Bool => json!("bool"),
        Prop::Time => json!("time"),
        Prop::Url => json!("url"),
        Prop::Query => json!("query"),
        Prop::Eid { target, death } => json!({ "eid": target, "death": death }),
        Prop::Well(w) => json!({ "well": w }),
        Prop::EnumInline(vs) => json!({ "enum": vs }),
        Prop::EnumNamed { name, aliases } => {
            let mut o = Map::new();
            o.insert("enum".into(), json!(name));
            if !aliases.is_empty() {
                let mut a = Map::new();
                for (k, v) in aliases.iter() {
                    a.insert((*k).into(), json!(v));
                }
                o.insert("aliases".into(), Value::Object(a));
            }
            Value::Object(o)
        }
    }
}

fn cols_json(cols: &[ColDef]) -> Value {
    let mut o = Map::new();
    for c in cols {
        o.insert(c.name.into(), prop_json(&c.prop));
    }
    Value::Object(o)
}

fn comp_json(c: &CompDef) -> Value {
    let mut o = Map::new();
    // Emit only the keys the source declared — the TOML omitted the rest, and
    // assemble()'s defaults read an omitted key identically to a false/empty.
    if let Some(r) = c.rank {
        o.insert("rank".into(), json!(r));
    }
    if c.wire == Some(false) {
        o.insert("wire".into(), json!(false));
    }
    if let Some(r) = c.stamped_rank {
        o.insert("stamped_rank".into(), json!(r));
    }
    if let Some(r) = c.kind_rank {
        o.insert("kind_rank".into(), json!(r));
    }
    if let Some(p) = c.prefix {
        o.insert("prefix".into(), json!(p));
    }
    if c.by_name {
        o.insert("by_name".into(), json!(true));
    }
    if c.lazy {
        o.insert("lazy".into(), json!(true));
    }
    if c.log {
        o.insert("log".into(), json!(true));
    }
    if let Some(p) = c.plural {
        o.insert("plural".into(), json!(p));
    }
    if !c.cols.is_empty() {
        o.insert("cols".into(), cols_json(c.cols));
    }
    if !c.stamped.is_empty() {
        o.insert("stamped".into(), cols_json(c.stamped));
    }
    if !c.indexes.is_empty() {
        let rows: Vec<Value> = c
            .indexes
            .iter()
            .map(|i| {
                let mut m = Map::new();
                m.insert("cols".into(), json!(i.cols));
                if i.unique {
                    m.insert("unique".into(), json!(true));
                }
                if let Some(w) = i.where_ {
                    m.insert("where".into(), json!(w));
                }
                Value::Object(m)
            })
            .collect();
        o.insert("indexes".into(), Value::Array(rows));
    }
    Value::Object(o)
}

// The manifest for every plugin that contributed anything, plugin-name sorted;
// each is the JSON face of what one TOML file held. Comps and enums within a
// plugin are name-sorted so the emitted bytes are deterministic regardless of
// inventory iteration order — downstream emission keys off explicit ranks, so
// object order never reaches types.ts.
pub fn manifests() -> Vec<(String, Value)> {
    let mut plugins: Vec<String> = Vec::new();
    let note = |p: &str, list: &mut Vec<String>| {
        if !list.iter().any(|x| x == p) {
            list.push(p.to_string());
        }
    };

    let mut comps: Vec<&CompDef> = inventory::iter::<CompDef>().collect();
    comps.sort_by(|a, b| a.name.cmp(b.name));
    let mut enums: Vec<&EnumDef> = inventory::iter::<EnumDef>().collect();
    enums.sort_by(|a, b| a.name.cmp(b.name));
    let mut renames: Vec<&RenameDef> = inventory::iter::<RenameDef>().collect();
    renames.sort_by(|a, b| a.from.cmp(b.from));

    for c in &comps {
        note(c.plugin, &mut plugins);
    }
    for e in &enums {
        note(e.plugin, &mut plugins);
    }
    for r in &renames {
        note(r.plugin, &mut plugins);
    }
    for e in inventory::iter::<EdgesDef>() {
        note(e.plugin, &mut plugins);
    }
    for s in inventory::iter::<SessionListsDef>() {
        note(s.plugin, &mut plugins);
    }
    plugins.sort();

    plugins
        .into_iter()
        .map(|p| {
            let mut m = Map::new();
            m.insert("name".into(), json!(p));

            let es: Vec<&&EnumDef> = enums.iter().filter(|e| e.plugin == p).collect();
            if !es.is_empty() {
                let mut eo = Map::new();
                for e in es {
                    eo.insert(e.name.into(), json!({ "rank": e.rank, "values": e.values }));
                }
                m.insert("enums".into(), Value::Object(eo));
            }

            let cs: Vec<&&CompDef> = comps.iter().filter(|c| c.plugin == p).collect();
            if !cs.is_empty() {
                let mut co = Map::new();
                for c in cs {
                    co.insert(c.name.into(), comp_json(c));
                }
                m.insert("comps".into(), Value::Object(co));
            }

            let rs: Vec<&&RenameDef> = renames.iter().filter(|r| r.plugin == p).collect();
            if !rs.is_empty() {
                let mut ro = Map::new();
                for r in rs {
                    ro.insert(r.from.into(), json!(r.to));
                }
                m.insert("renames".into(), Value::Object(ro));
            }

            for e in inventory::iter::<EdgesDef>() {
                if e.plugin == p {
                    m.insert("edges".into(), json!(e.edges));
                }
            }
            for s in inventory::iter::<SessionListsDef>() {
                if s.plugin == p {
                    m.insert("session_active".into(), json!(s.session_active));
                    m.insert("capabilities".into(), json!(s.capabilities));
                    m.insert("session_facets".into(), json!(s.session_facets));
                }
            }

            (p, Value::Object(m))
        })
        .collect()
}

// The manifest as the committed file bytes: pretty JSON with a trailing
// newline, one string per plugin — what the xtask writes and the staleness
// test compares.
pub fn manifest_files() -> Vec<(String, String)> {
    manifests()
        .into_iter()
        .map(|(name, v)| {
            let mut s = serde_json::to_string_pretty(&v).unwrap();
            s.push('\n');
            (name, s)
        })
        .collect()
}
