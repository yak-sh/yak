// The indexed candidate path: compile a filter's Preds into a SQL WHERE that an
// INDEX can answer, so a listing narrows to the rows that can match BEFORE it
// materializes them — the kernel's mirror of sql.ts's build()/whereSome(), the
// half `store.rows_matching` uses instead of bulk-loading the whole kind and
// filtering in Rust (T-22758).
//
// PARTIAL NARROWING is the whole trick (sql.ts whereSome): every query is a
// conjunction, so a predicate the compiler cannot express EXACTLY is simply
// DROPPED — dropping an AND-term only WIDENS the result, so the compiled SQL
// selects a SUPERSET of the true matches. The caller reads that narrow candidate
// set and refines it with `query::matches`, the same matcher the bulk path ran,
// so the ANSWER is byte-identical; only the number of rows materialized changes.
// A compiler that is unsure DECLINES (returns None for that pred) rather than
// risk a wrong narrowing — correctness never rides on what compiled, only speed.
//
// The compiled column is the STORED shape: a reference column holds the target's
// integer id, so `=P-19` compiles to a subquery over entity.eid; a numeric
// column binds a number so SQLite compares numerically the way query::cmp does.
// Anything whose SQL and JS orderings could disagree (a numeric-looking operand
// against a text column, a time PHRASE that needs span math, a bool, a bare
// multi-owner column) declines here and the matcher answers it.

use crate::query::Pred;
use crate::vocab::{vocab, PropType};
use rusqlite::types::Value;

// A compiled candidate filter: the LEFT JOINs its predicates need, the WHERE
// condition, and the bind params in order. `exact` is true only when EVERY input
// pred compiled — the caller may push a LIMIT into the SQL only then, since a
// filter that runs in JS after a LIMIT would under-fill the page (sql.ts's rule
// for windowed()). `narrowed` says at least one pred produced a real condition,
// so the caller knows whether it is worth inlining an id list versus keeping the
// cheap whole-kind membership subquery.
pub struct Narrowed {
    pub joins: String,
    pub cond: String,
    pub params: Vec<Value>,
    pub exact: bool,
    pub narrowed: bool,
}

// One column reference, aliased per unique component so two preds on the same
// comp share one join.
struct Cols {
    joins: String,
    aliases: Vec<String>, // comp name → alias, insertion order
    seen: Vec<String>,
}

impl Cols {
    fn new() -> Cols {
        Cols { joins: String::new(), aliases: vec![], seen: vec![] }
    }
    // The aliased column `c<i>.<prop>` for comp.prop, adding the LEFT JOIN the
    // first time a comp is named. A LEFT JOIN so "the component is absent" and
    // "the column is null" are the same NULL — exactly what query::scalar reads
    // as `None` (sql.ts build()).
    fn col(&mut self, comp: &str, prop: &str) -> String {
        let alias = match self.seen.iter().position(|c| c == comp) {
            Some(i) => self.aliases[i].clone(),
            None => {
                let a = format!("c{}", self.aliases.len());
                self.joins.push_str(&format!(
                    " left join \"{comp}\" {a} on {a}.entity = e.id"
                ));
                self.seen.push(comp.into());
                self.aliases.push(a.clone());
                a
            }
        };
        format!("{alias}.\"{prop}\"")
    }
}

// query.rs's as_num, restated: a decimal literal, so the SQL side can bind a
// number and compare numerically the way query::cmp does when both sides parse.
fn as_num(v: &str) -> Option<f64> {
    let t = v.strip_prefix('-').unwrap_or(v);
    let ok = !t.is_empty()
        && t.chars().all(|c| c.is_ascii_digit() || c == '.')
        && t.matches('.').count() <= 1
        && !t.starts_with('.')
        && !t.ends_with('.');
    ok.then(|| v.parse().ok()).flatten()
}

fn ascii(s: &str) -> bool {
    s.bytes().all(|b| b < 128)
}

// Split a `=` value into a comma list, declining if any part is itself a range
// or empty — those the whole-pred compiler drops rather than half-express.
fn plain_list(value: &str) -> Option<Vec<&str>> {
    let parts: Vec<&str> = value.split(',').collect();
    if parts.iter().any(|p| p.is_empty() || p.contains("..")) {
        return None;
    }
    Some(parts)
}

// A `lo..hi` / `lo...hi` range into (lo, hi, exclusive_hi); both ends must be
// present (query::eq's open-ended forms compare against '', which we decline).
fn range(value: &str) -> Option<(&str, &str, bool)> {
    let at = value.find("..")?;
    let lo = &value[..at];
    let rest = &value[at + 2..];
    let (excl, hi) = match rest.strip_prefix('.') {
        Some(r) => (true, r),
        None => (false, rest),
    };
    (!lo.is_empty() && !hi.is_empty()).then_some((lo, hi, excl))
}

// A reference `=`: the stored column is an integer id, so compare through
// entity.eid (the value is already an eid — resolve_values ran). A list rides one
// `in (subquery)`.
fn ref_eq(col: &str, eids: &[&str], params: &mut Vec<Value>) -> String {
    let marks = vec!["?"; eids.len()].join(",");
    for e in eids {
        params.push(Value::Text(e.to_string()));
    }
    format!("{col} in (select id from entity where eid in ({marks}))")
}

// Compile ONE predicate to a SQL condition, or None to decline it (the matcher
// will answer that one). `t` is the column's declared type; a bare multi-owner
// pred (comp empty) always declines — its OR-across-owners is the matcher's job.
fn one(cols: &mut Cols, p: &Pred, params: &mut Vec<Value>) -> Option<String> {
    // A component-presence pred: `.canvas!`/`~=` is has-comp, `=` (empty) is
    // absent. Exact, and no join — an EXISTS over the comp's own table.
    if p.prop.is_empty() {
        let exists = format!(
            "exists (select 1 from \"{}\" pc where pc.entity = e.id)",
            p.comp
        );
        return Some(if p.op.is_empty() || p.op == "~=" {
            exists
        } else if p.op == "=" {
            format!("not {exists}")
        } else {
            return None;
        });
    }
    // A bare column (comp '') reads every owner — the matcher's OR, not ours.
    if p.comp.is_empty() {
        return None;
    }
    let t = vocab().prop_type(&p.comp, &p.prop)?;
    // Time phrases need span math and a timezone; bool's stored shape is not
    // worth guessing. Both decline — the matcher answers them (a fixed ISO stamp
    // would compile as text, but declining is always safe and rare on a listing).
    if matches!(t, PropType::Time | PropType::Bool) {
        return None;
    }
    let is_ref = t.is_ref();
    let numeric = matches!(t, PropType::Number | PropType::Priority);
    let col = cols.col(&p.comp, &p.prop);
    match p.op.as_str() {
        "=" => {
            if p.value.is_empty() {
                // absent: query::eq reads '' as "no value OR the empty string",
                // so a stored '' matches too — `is null` alone would MISS it and
                // narrow away a true match. (A ref/number column never holds '',
                // so its NULL is the whole story.)
                return Some(if is_ref || numeric {
                    format!("{col} is null")
                } else {
                    format!("({col} is null or cast({col} as text) = '')")
                });
            }
            if let Some((lo, hi, excl)) = range(&p.value) {
                if is_ref {
                    return None;
                }
                if numeric {
                    let (a, b) = (as_num(lo)?, as_num(hi)?);
                    params.push(Value::Real(a));
                    params.push(Value::Real(b));
                } else {
                    if as_num(lo).is_some() || as_num(hi).is_some() {
                        return None; // numeric-looking text: cmp() would disagree
                    }
                    params.push(Value::Text(lo.into()));
                    params.push(Value::Text(hi.into()));
                }
                let hip = if excl { "<" } else { "<=" };
                return Some(format!("({col} >= ? and {col} {hip} ?)"));
            }
            let parts = plain_list(&p.value)?;
            if is_ref {
                return Some(ref_eq(&col, &parts, params));
            }
            if numeric {
                let mut nums = vec![];
                for part in &parts {
                    nums.push(as_num(part)?);
                }
                let marks = vec!["?"; nums.len()].join(",");
                for n in nums {
                    params.push(Value::Real(n));
                }
                Some(format!("{col} in ({marks})"))
            } else {
                let marks = vec!["?"; parts.len()].join(",");
                for part in &parts {
                    params.push(Value::Text(part.to_string()));
                }
                Some(format!("cast({col} as text) in ({marks})"))
            }
        }
        "!=" => {
            // Only a plain, non-empty value: absent (NULL) must READ as a match
            // (query::eq: a missing value != x is true), so `col is null or …`.
            if p.value.is_empty()
                || p.value.contains(',')
                || p.value.contains("..")
            {
                return None;
            }
            if is_ref {
                params.push(Value::Text(p.value.clone()));
                Some(format!(
                    "({col} is null or {col} not in \
                     (select id from entity where eid = ?))"
                ))
            } else if numeric {
                let n = as_num(&p.value)?;
                params.push(Value::Real(n));
                Some(format!("({col} is null or {col} <> ?)"))
            } else {
                params.push(Value::Text(p.value.clone()));
                Some(format!("({col} is null or cast({col} as text) <> ?)"))
            }
        }
        "~=" => {
            // contains, ASCII only — SQLite lower() folds A-Z alone, so a
            // non-ASCII needle could disagree with JS toLowerCase (sql.ts has()).
            if is_ref || numeric || !ascii(&p.value) {
                return None;
            }
            params.push(Value::Text(p.value.clone()));
            Some(format!(
                "instr(lower(coalesce(cast({col} as text), '')), lower(?)) > 0"
            ))
        }
        op @ ("<" | "<=" | ">" | ">=") => {
            // Ordered compare. A reference has no order; a numeric operand
            // against a text column would let SQLite compare numerically where
            // query::cmp goes lexical — decline both (sql.ts compilePred).
            if is_ref {
                return None;
            }
            if numeric {
                let n = as_num(&p.value)?;
                params.push(Value::Real(n));
                Some(format!("{col} {op} ?"))
            } else {
                if as_num(&p.value).is_some() {
                    return None;
                }
                params.push(Value::Text(p.value.clone()));
                Some(format!("cast({col} as text) {op} ?"))
            }
        }
        _ => None,
    }
}

// Compile a whole pred list into a candidate filter. Every pred that compiles
// ANDs into the condition; one that declines is dropped and `exact` goes false.
// An empty (or all-declining) list is the identity filter `1` — the whole kind,
// the same membership the bulk path reads.
pub fn compile(preds: &[Pred]) -> Narrowed {
    let mut cols = Cols::new();
    let mut params: Vec<Value> = vec![];
    let mut terms: Vec<String> = vec![];
    let mut exact = true;
    for p in preds {
        match one(&mut cols, p, &mut params) {
            Some(term) => terms.push(term),
            None => exact = false,
        }
    }
    let narrowed = !terms.is_empty();
    let cond = if terms.is_empty() {
        "1".into()
    } else {
        terms.join(" and ")
    };
    Narrowed { joins: cols.joins, cond, params, exact, narrowed }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::parse;

    fn preds(args: &[&str]) -> Vec<Pred> {
        parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .unwrap()
            .1
    }

    #[test]
    fn enum_equality_compiles_exactly() {
        let n = compile(&preds(&[".status=open"]));
        assert!(n.exact && n.narrowed);
        assert!(n.cond.contains("in (?)"), "{}", n.cond);
        assert!(n.joins.contains("left join \"task\""), "{}", n.joins);
        assert_eq!(n.params.len(), 1);
    }

    #[test]
    fn list_and_range_compile() {
        let list = compile(&preds(&[".status=open,wip"]));
        assert!(list.exact);
        assert!(list.cond.contains("in (?,?)"), "{}", list.cond);
        let rng = compile(&preds(&[".priority=0..2"]));
        assert!(rng.exact, "priority range should compile");
        assert!(rng.cond.contains(">=") && rng.cond.contains("<="), "{}", rng.cond);
    }

    #[test]
    fn priority_is_numeric_bind() {
        let n = compile(&preds(&[".priority<=1"]));
        assert!(n.exact);
        assert!(matches!(n.params[0], Value::Real(_)), "numeric operand binds Real");
    }

    #[test]
    fn reference_equality_goes_through_entity_eid() {
        // an unresolved id stays literal here (resolve_values is the caller's);
        // the shape is what matters: a subquery over entity.eid.
        let n = compile(&preds(&[".project=P-19"]));
        assert!(n.exact);
        assert!(n.cond.contains("select id from entity where eid in"), "{}", n.cond);
    }

    #[test]
    fn contains_compiles_only_for_ascii() {
        let ascii = compile(&preds(&[".title~=widget"]));
        assert!(ascii.exact && ascii.cond.contains("instr("));
        let uni = compile(&preds(&[".title~=café"]));
        assert!(!uni.exact, "a non-ASCII needle declines");
        assert!(!uni.narrowed);
    }

    #[test]
    fn presence_is_exists_no_join() {
        let has = compile(&preds(&[".doc!"]));
        assert!(has.exact && has.cond.starts_with("exists"));
        assert!(has.joins.is_empty(), "presence needs no join");
        let absent = compile(&preds(&[".doc="]));
        // `.doc=` is absence of the doc component
        assert!(absent.cond.starts_with("not exists"), "{}", absent.cond);
    }

    #[test]
    fn declines_widen_not_break() {
        // a time phrase declines (exact=false) but the other pred still narrows
        let n = compile(&preds(&[".status=open", ".updated.at>=today"]));
        assert!(!n.exact, "time phrase should decline");
        assert!(n.narrowed, "status still narrows");
        assert!(n.cond.contains("in (?)"));
        assert_eq!(n.params.len(), 1, "only the compiled pred binds");
    }

    #[test]
    fn empty_is_identity() {
        let n = compile(&[]);
        assert!(n.exact && !n.narrowed && n.cond == "1" && n.params.is_empty());
    }

    #[test]
    fn shared_columns_share_one_join() {
        let n = compile(&preds(&[".status=open", ".priority=0"]));
        assert_eq!(n.joins.matches("left join").count(), 1, "one task join");
    }
}
