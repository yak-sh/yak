// The kernel's pure core compiled for the browser: a delta-fed GraphCache
// plus query evaluation, exported over plain extern "C" — no wasm-bindgen,
// so the build needs nothing but cargo and the wasm32 target, and the JS
// side stays a page of glue (harness.ts). Strings cross as (ptr, len) utf-8;
// a returned string is packed (ptr << 32 | len) and freed by the caller via
// wasm_free. One cache per instance — the module IS the store.
//
// Exports: wasm_alloc / wasm_free · ingest(json Change[]) -> count | -1 ·
// query(filter line) -> {rows} | {error} · reset() · size() — the SPA's
// future data engine in miniature (T-22559, D-22530 §5).

use yak_kernel::cache::{Change, GraphCache};
use yak_kernel::{query, vocab};
use serde_json::Value;
use std::sync::Mutex;

static CACHE: Mutex<Option<GraphCache>> = Mutex::new(None);

fn with_cache<T>(f: impl FnOnce(&mut GraphCache) -> T) -> T {
    let mut g = CACHE.lock().unwrap();
    f(g.get_or_insert_with(GraphCache::new))
}

// Every region that crosses the boundary is a boxed slice whose capacity IS
// its length, so alloc and free agree exactly; both clamp len to 1 the same
// way so a zero-length ask stays symmetric.

/// # Safety
/// Caller owns the region until wasm_free with the SAME len.
#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len.max(1)].into_boxed_slice()) as *mut u8
}

/// # Safety
/// (ptr, len) must be a region handed out by wasm_alloc or a packed return.
#[no_mangle]
pub unsafe extern "C" fn wasm_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
        ptr,
        len.max(1),
    )));
}

unsafe fn str_in<'a>(ptr: *const u8, len: usize) -> &'a str {
    std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("")
}

fn str_out(s: String) -> u64 {
    let b = s.into_bytes().into_boxed_slice();
    let len = b.len();
    let ptr = Box::into_raw(b) as *mut u8 as u64;
    (ptr << 32) | len as u64
}

#[no_mangle]
pub extern "C" fn reset() {
    *CACHE.lock().unwrap() = Some(GraphCache::new());
}

#[no_mangle]
pub extern "C" fn size() -> u32 {
    with_cache(|g| g.len() as u32)
}

/// Ingest a JSON array of {eid, name, comp} patches. Returns how many
/// applied, -1 on malformed input.
///
/// # Safety
/// (ptr, len) must address valid utf-8 the caller wrote via wasm_alloc.
#[no_mangle]
pub unsafe extern "C" fn ingest(ptr: *const u8, len: usize) -> i64 {
    let Ok(v) = serde_json::from_str::<Value>(str_in(ptr, len)) else {
        return -1;
    };
    let Some(arr) = v.as_array() else { return -1 };
    let changes: Vec<Change> =
        arr.iter().filter_map(Change::from_value).collect();
    let n = changes.len() as i64;
    with_cache(|g| g.ingest(&changes));
    n
}

/// Evaluate one filter line (`.project=P-19&.status=open,wip`, bare kind
/// words) against the cache. Returns packed JSON: {"rows": [...]} with each
/// row as {id, eid, kind, comps}, or {"error": "..."} — unported grammar
/// refuses loudly, never half-answers.
///
/// # Safety
/// (ptr, len) must address valid utf-8 the caller wrote via wasm_alloc.
#[no_mangle]
pub unsafe extern "C" fn query(ptr: *const u8, len: usize) -> u64 {
    let line = str_in(ptr, len);
    let args: Vec<String> = line
        .split(['&', ' '])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let out = with_cache(|g| {
        let (kind, mut preds) = match query::parse(&args) {
            Ok(x) => x,
            Err(e) => return format!(r#"{{"error":{}}}"#, Value::from(e)),
        };
        query::resolve_values(g, &mut preds);
        let mut rows = g.query_kind(&kind, &preds);
        rows.sort_by(query::by_board);
        let v = vocab();
        let items: Vec<Value> = rows
            .iter()
            .map(|r| {
                let mut o = serde_json::Map::new();
                o.insert(
                    "id".into(),
                    Value::from(v.id_of(&r.kind, &r.eid, r.num)),
                );
                o.insert("eid".into(), Value::from(r.eid.as_str()));
                o.insert("kind".into(), Value::from(r.kind.as_str()));
                o.insert("comps".into(), Value::Object(r.comps.clone()));
                Value::Object(o)
            })
            .collect();
        Value::Object(
            [("rows".to_string(), Value::from(items))].into_iter().collect(),
        )
        .to_string()
    });
    str_out(out)
}
