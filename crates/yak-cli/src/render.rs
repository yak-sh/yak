// Rendering, ported line-for-line from client.ts showMd / cli.ts list & seek.
// Parity target: T-22534's comp-nested frontmatter (96b532a).

use chrono::{DateTime, Local};
use yak_kernel::store::{Dep, Row, Rows};
use yak_kernel::vocab::{vocab, PropType};
use yak_kernel::Graph;
use serde_json::Value;

pub fn local_time(iso: &str) -> String {
    match DateTime::parse_from_rfc3339(iso) {
        Ok(d) => d
            .with_timezone(&Local)
            .format("%Y-%m-%dT%H:%M:%S%:z")
            .to_string(),
        Err(_) => iso.to_string(),
    }
}

fn clip(s: &str, n: usize) -> String {
    let t: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = t.chars().collect();
    if chars.len() > n {
        let mut out: String = chars[..n - 1].iter().collect();
        out.push('…');
        out
    } else {
        t
    }
}

// Minimal RFC 2047: =?utf-8?B/Q?…?= tokens decode; anything else stands.
// Whitespace BETWEEN two encoded words drops, per the spec and the TS port.
pub fn unmime(s: &str) -> String {
    let mut out = String::new();
    let mut pending_ws = String::new();
    let mut just_decoded = false;
    let mut rest = s;
    while !rest.is_empty() {
        if rest.starts_with("=?") {
            if let Some((dec, r)) = decode_word(rest) {
                if !just_decoded {
                    out.push_str(&pending_ws);
                }
                pending_ws.clear();
                out.push_str(&dec);
                rest = r;
                just_decoded = true;
                continue;
            }
        }
        let c = rest.chars().next().unwrap();
        if just_decoded && c.is_whitespace() {
            pending_ws.push(c);
            rest = &rest[c.len_utf8()..];
            continue;
        }
        if !pending_ws.is_empty() {
            out.push_str(&pending_ws);
            pending_ws.clear();
        }
        just_decoded = false;
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out.push_str(&pending_ws);
    out
}

fn decode_word(s: &str) -> Option<(String, &str)> {
    let body = s.strip_prefix("=?")?;
    let (charset, r) = body.split_once('?')?;
    let (enc, r) = r.split_once('?')?;
    let (text, rest) = r.split_once("?=")?;
    let cs = charset.split('*').next()?.to_lowercase();
    if cs != "utf-8" && cs != "us-ascii" && cs != "ascii" {
        return None;
    }
    let bytes = match enc.to_lowercase().as_str() {
        "b" => b64(text)?,
        "q" => qdecode(text),
        _ => return None,
    };
    Some((String::from_utf8_lossy(&bytes).to_string(), rest))
}

fn b64(s: &str) -> Option<Vec<u8>> {
    let idx = |c: u8| -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let clean: Vec<u8> =
        s.bytes().filter(|c| *c != b'=' && !c.is_ascii_whitespace()).collect();
    let mut out = vec![];
    for chunk in clean.chunks(4) {
        let vals: Vec<u8> =
            chunk.iter().map(|c| idx(*c)).collect::<Option<_>>()?;
        let mut buf: u32 = 0;
        for v in &vals {
            buf = (buf << 6) | *v as u32;
        }
        buf <<= 6 * (4 - vals.len());
        let bytes = buf.to_be_bytes();
        out.extend_from_slice(&bytes[1..vals.len()]);
    }
    Some(out)
}

fn qdecode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'_' => out.push(b' '),
            b'=' if i + 2 < b.len() => {
                let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("");
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 2;
                } else {
                    out.push(b'=');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    out
}

pub fn id_of(r: &Row) -> String {
    vocab().id_of(&r.kind, &r.eid, r.num)
}

fn s_of(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => scalar_str(other),
    }
}

// JS String(x) for the scalar shapes we store.
fn scalar_str(v: &Value) -> String {
    match v {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else {
                let f = n.as_f64().unwrap_or(0.0);
                js_num(f)
            }
        }
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn js_num(f: f64) -> String {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        format!("{}", f as i64)
    } else {
        format!("{f}")
    }
}

fn comp_get<'a>(r: &'a Row, comp: &str, prop: &str) -> Option<&'a Value> {
    r.comps.get(comp)?.as_object()?.get(prop)
}

// "T-3695 (open) — title" — the way an edge endpoint reads anywhere.
pub fn said(rows: &Rows, eid: &str) -> String {
    let Some(r) = rows.get(eid) else { return eid.to_string() };
    let st = s_of(comp_get(&r, "task", "status"));
    let mut t = s_of(comp_get(&r, "doc", "title"));
    if t.is_empty() {
        t = s_of(comp_get(&r, "session", "id"));
    }
    let title = if r.comps.contains_key("mail") {
        clip(&unmime(&t), 64)
    } else {
        clip(&t, 64)
    };
    let s = r.comps.get("session").and_then(|x| x.as_object());
    let model = s.map(|s| {
        let get = |k: &str| {
            s.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string()
        };
        let serving = get("serving_model");
        let m = if serving.is_empty() { get("model") } else { serving };
        [get("provider"), m, get("effort")]
            .into_iter()
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
            .join("/")
    });
    let persona = s
        .and_then(|s| s.get("persona"))
        .and_then(|v| v.as_str())
        .map(|p| face(rows, p))
        .map(|f| {
            if f.1.is_empty() {
                format!("persona {}", f.0)
            } else {
                format!("persona {} {}", f.0, f.1)
            }
        });
    let agent = [model.unwrap_or_default(), persona.unwrap_or_default()]
        .into_iter()
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{}{}{}{}",
        id_of(&r),
        if st.is_empty() { String::new() } else { format!(" ({st})") },
        if title.is_empty() { String::new() } else { format!(" — {title}") },
        if agent.is_empty() { String::new() } else { format!(" ({agent})") },
    )
}

// faceOf: (id, title). A missing row keeps the raw string as its id.
fn face(rows: &Rows, eid: &str) -> (String, String) {
    match rows.get(eid) {
        Some(r) => (id_of(&r), s_of(comp_get(&r, "doc", "title"))),
        None => (eid.to_string(), String::new()),
    }
}

fn face_str(f: &(String, String)) -> String {
    if f.1.is_empty() {
        f.0.clone()
    } else {
        format!("{} {}", f.0, f.1)
    }
}

pub fn format_prop(
    t: &PropType,
    v: &Value,
    rows: &Rows,
) -> Option<String> {
    match t {
        PropType::Priority => {
            let n = match v {
                Value::Number(n) => n.as_f64()?,
                Value::String(s) => {
                    s.trim().trim_start_matches(['p', 'P']).parse().ok()?
                }
                _ => return None,
            };
            Some(format!("P{}", js_num(n)))
        }
        PropType::Bool => {
            let truthy = match v {
                Value::Number(n) => n.as_f64()? != 0.0,
                Value::String(s) => {
                    matches!(s.to_lowercase().as_str(), "true" | "1" | "yes")
                }
                Value::Bool(b) => *b,
                _ => return None,
            };
            Some(if truthy { "true" } else { "false" }.into())
        }
        PropType::Time => Some(local_time(&scalar_str(v))),
        PropType::Eid(_) => {
            let s = scalar_str(v);
            Some(said(rows, &s))
        }
        _ => Some(scalar_str(v)),
    }
}

// Every eid the page is about to name, gathered before any of them is read so
// the whole set loads in one bulk pass rather than a probe per entity — the
// page walked ~25 related entities through ~101 comp tables apiece (T-22589,
// M-17862). The gather only has to be close: an eid it misses still resolves
// through Rows::get, so a new mention costs speed, never accuracy.
fn warm_page(rows: &Rows, row: &Row, deps: &[Dep], comments: &[String]) {
    let v = vocab();
    // what the frontmatter names: every {eid} column the row wears — `claim`
    // included, which the frontmatter loop skips but claimant() resolves
    let mut want: Vec<String> = vec![];
    for (comp, cols) in &v.comps {
        if comp == "entity" {
            continue;
        }
        let Some(bag) = row.comps.get(comp).and_then(|x| x.as_object()) else {
            continue;
        };
        for (prop, _) in cols.iter().filter(|(_, t)| t.is_ref()) {
            if let Some(x) = bag.get(prop) {
                want.push(scalar_str(x));
            }
        }
    }
    // what the edge and comment blocks name: the far end of every dep, and
    // each comment
    for d in deps {
        want.push(if d.parent == row.eid {
            d.child.clone()
        } else {
            d.parent.clone()
        });
    }
    want.extend(comments.iter().cloned());
    rows.warm(&want);
    // Naming those reaches further, twice: said() resolves a session's
    // persona, and a comment's author and instrument are themselves said().
    // Two more waves close the recursion — face() is where it bottoms out.
    for _ in 0..2 {
        let mut next: Vec<String> = vec![];
        for e in &want {
            let Some(r) = rows.get(e) else { continue };
            for (comp, prop) in
                [("session", "persona"), ("created", "by"), ("created", "via")]
            {
                if let Some(x) = comp_get(&r, comp, prop) {
                    next.push(scalar_str(x));
                }
            }
        }
        rows.warm(&next);
        want = next;
    }
}

// showMd, ported. `rows` resolves every eid a line names.
pub fn show_md(store: &dyn Graph, row: &Row) -> String {
    let v = vocab();
    let rows = Rows::new(store);
    let deps = store.deps_of(&row.eid);
    let comments = store.comments_on(&row.eid);
    warm_page(&rows, row, &deps, &comments);
    let mut fm: Vec<String> =
        vec![format!("id: {}", id_of(row)), format!("kind: {}", row.kind)];
    if let Some(spine) = row.comps.get("entity").and_then(|x| x.as_object()) {
        if let Some(eid) = spine.get("eid").and_then(|x| x.as_str()) {
            fm.push("entity:".into());
            fm.push(format!("  eid: {eid}"));
            if let Some(num) = spine.get("num").and_then(|x| x.as_i64()) {
                fm.push(format!("  num: {num}"));
            }
        }
    }
    for (comp, _) in &v.comps {
        if comp == "doc" || comp == "claim" || comp == "entity" {
            continue;
        }
        let Some(bag) = row.comps.get(comp).and_then(|x| x.as_object()) else {
            continue;
        };
        let mut values: Vec<String> = vec![];
        for (prop, t) in v.readable(comp) {
            let val = bag.get(&prop);
            let empty = match val {
                None | Some(Value::Null) => true,
                Some(Value::String(s)) => s.is_empty(),
                _ => false,
            };
            if empty {
                if comp == "memory" && prop == "scope" {
                    values.push("  scope: shared".into());
                }
                continue;
            }
            if let Some(f) = format_prop(&t, val.unwrap(), &rows) {
                values.push(format!("  {prop}: {f}"));
            }
        }
        if !values.is_empty() {
            fm.push(format!("{comp}:"));
            fm.extend(values);
        }
    }
    if let Some(held) = claimant(&rows, row) {
        fm.push(format!("claim: {held}"));
    }
    let refs: Vec<_> = deps.iter().filter(|d| d.parent == row.eid).collect();
    let backs: Vec<_> = deps.iter().filter(|d| d.child == row.eid).collect();
    let mut seen: Vec<&str> = vec![];
    for d in &refs {
        if !seen.contains(&d.type_.as_str()) {
            seen.push(&d.type_);
        }
    }
    for t in seen {
        fm.push(format!("{t}:"));
        for d in refs.iter().filter(|d| d.type_ == t) {
            fm.push(format!("  - {}", said(&rows, &d.child)));
        }
    }
    if !backs.is_empty() {
        fm.push("referenced by:".into());
        for d in &backs {
            fm.push(format!("  - {} · {} this", said(&rows, &d.parent), d.type_));
        }
    }
    let mut out: Vec<String> = vec!["---".into()];
    out.extend(fm);
    out.push("---".into());
    let mut title = s_of(comp_get(row, "doc", "title"));
    if row.comps.contains_key("mail") {
        title = unmime(&title);
    }
    let body = s_of(comp_get(row, "doc", "body"));
    if !title.is_empty() {
        out.push(String::new());
        out.push(format!("# {title}"));
    }
    if !body.is_empty() {
        out.push(String::new());
        out.push(body);
    }
    if !comments.is_empty() {
        out.push(String::new());
        out.push("## Comments".into());
        for ceid in comments {
            let Some(c) = rows.get(&ceid) else { continue };
            let actor = s_of(comp_get(&c, "created", "by"));
            let instrument = s_of(comp_get(&c, "created", "via"));
            let by = if actor.is_empty() {
                String::new()
            } else {
                said(&rows, &actor)
            };
            let via = if instrument.is_empty() {
                String::new()
            } else {
                said(&rows, &instrument)
            };
            let who = if !by.is_empty() && !via.is_empty() && actor != instrument
            {
                format!(" · {by} · via {via}")
            } else if !by.is_empty() || !via.is_empty() {
                format!(" · {}", if by.is_empty() { &via } else { &by })
            } else {
                String::new()
            };
            let verdict = s_of(comp_get(&c, "review", "verdict"))
                .replace('_', " ");
            let born = s_of(comp_get(&c, "created", "at"));
            out.push(String::new());
            out.push(format!(
                "— {}{}{}",
                local_time(&born),
                who,
                if verdict.is_empty() {
                    String::new()
                } else {
                    format!(" · {verdict}")
                }
            ));
            out.push(String::new());
            out.push(s_of(comp_get(&c, "doc", "body")));
        }
    }
    out.join("\n")
}

pub fn claimant(rows: &Rows, r: &Row) -> Option<String> {
    let seid = s_of(comp_get(r, "claim", "session"));
    if seid.is_empty() {
        return None;
    }
    let sid = rows
        .get(&seid)
        .and_then(|s| comp_get(&s, "session", "id").map(scalar_str));
    Some(sid.unwrap_or(seid))
}

// authoringLine: created/proposed/decided, each "by X via Y (agent)".
pub fn authoring_line(rows: &Rows, r: &Row) -> String {
    ["created", "proposed", "decided"]
        .iter()
        .filter_map(|name| {
            let bag = r.comps.get(*name)?.as_object()?;
            let by_eid = bag.get("by").and_then(|x| x.as_str()).unwrap_or("");
            let via_eid = bag.get("via").and_then(|x| x.as_str()).unwrap_or("");
            let by = if by_eid.is_empty() {
                String::new()
            } else {
                face_str(&face(rows, by_eid))
            };
            let via_row =
                if via_eid.is_empty() { None } else { rows.get(via_eid) };
            let via_face = via_row
                .as_ref()
                .map(|vr| {
                    face_str(&(
                        id_of(vr),
                        s_of(comp_get(vr, "doc", "title")),
                    ))
                })
                .unwrap_or_else(|| {
                    if via_eid.is_empty() {
                        String::new()
                    } else {
                        via_eid.to_string()
                    }
                });
            let s = via_row
                .as_ref()
                .and_then(|vr| vr.comps.get("session"))
                .and_then(|x| x.as_object());
            let get = |k: &str| {
                s.and_then(|s| s.get(k))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            };
            let serving = get("serving_model");
            let model = if serving.is_empty() { get("model") } else { serving };
            let agent = [get("provider"), model, get("effort")]
                .into_iter()
                .filter(|x| !x.is_empty())
                .collect::<Vec<_>>()
                .join("/");
            let persona_eid = get("persona");
            let persona = if persona_eid.is_empty() {
                String::new()
            } else {
                face_str(&face(rows, &persona_eid))
            };
            let instrument = [
                agent,
                if persona.is_empty() {
                    String::new()
                } else {
                    format!("persona {persona}")
                },
            ]
            .into_iter()
            .filter(|x| !x.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
            let mut source = String::new();
            if !by.is_empty() {
                source.push_str(&format!(" by {by}"));
            }
            if !via_face.is_empty() && via_face != by {
                source.push_str(&format!(" via {via_face}"));
            }
            if !instrument.is_empty() {
                source.push_str(&format!(" ({instrument})"));
            }
            if source.is_empty() {
                None
            } else {
                Some(format!("{name}{source}"))
            }
        })
        .collect::<Vec<_>>()
        .join(" · ")
}
