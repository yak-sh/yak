// An edge's identity, and the transition table between the two edge stores
// (D-23820, T-23825) — the Rust half of src/edge.ts, and it must agree with it
// character for character. An edge entity is content-addressed from its
// SENTENCE, the way a blob's eid is its bytes' hash: writing the same sentence
// twice finds one entity, and an unlink names it with no lookup. Two
// derivations would be two entities for one sentence, so the TS door and the
// Rust door would each be blind to the other's edges (T-32530).

use crate::vocab::Vocab;
use sha2::{Digest, Sha256};

// eid = the leading 16 bytes of sha256(`from|nature|to`), worn as a UUID:
// version nibble 8 (RFC 9562's custom-derivation version) and the variant bits
// stamped, so it passes every uuid door and can never collide with a minted
// v4. Direction is part of the sentence: `a requires b` and `b requires a` are
// two edges.
pub fn edge_eid(from: &str, nature: &str, to: &str) -> String {
    let mut h = Sha256::new();
    h.update(format!("{from}|{nature}|{to}").as_bytes());
    let hex: Vec<char> = format!("{:x}", h.finalize()).chars().take(32).collect();
    let variant =
        char::from_digit((hex[16].to_digit(16).unwrap_or(0) & 0x3) | 0x8, 16).unwrap_or('8');
    let s: String = hex
        .iter()
        .enumerate()
        .map(|(i, c)| match i {
            12 => '8',
            16 => variant,
            _ => *c,
        })
        .collect();
    format!("{}-{}-{}-{}-{}", &s[0..8], &s[8..12], &s[12..16], &s[16..20], &s[20..32])
}

// The transition table, dual-write only (T-23825; T-23821 removes it with the
// dependency table): each `dependency.type` and its nature comp, present tense
// for a live relationship (`references` for `referenced`). `recalled` keeps its
// past tense because it is the one nature that is an EVENT: the edge wears
// `recalled{at}` — a relation with a time carried by the sentence rather than
// forced onto either end (D-23820, T-32471).
fn present(word: &str) -> &str {
    if word == "referenced" {
        "references"
    } else {
        word
    }
}

// The nature comp a dependency word wears — None for a word the vocabulary
// does not know, which is the dependency rule's refusal, not this table's.
pub fn nature_of(v: &Vocab, word: &str) -> Option<String> {
    v.edges.iter().find(|e| *e == word).map(|e| present(e).to_string())
}

// The WIRE's spelling for a nature — what a `dependency.type` reads as.
pub fn type_of(v: &Vocab, nature: &str) -> Option<String> {
    v.edges.iter().find(|e| present(e) == nature).cloned()
}

// Every nature, in the vocabulary's order.
pub fn natures(v: &Vocab) -> Vec<String> {
    v.edges.iter().map(|e| present(e).to_string()).collect()
}

// The sentence store as SQL — the Rust half of src/edge.ts `sentences()`, and
// it must say the same three shapes for the same reasons. `edge` names the two
// ends and its listing order; the nature comp names the verb. The columns are
// exactly what `dependency` had — parent, type, child, ord — so every reader
// keeps the shape it has always spoken, and `type` is the WIRE's spelling
// (`referenced`, never `references`).
//
// `only` is a WHERE over the EDGE's own columns (`g."from"`, `g."to"`,
// `g.entity`) and belongs INSIDE: a narrowing left to the caller's outer query
// is applied only after the whole store is built.
//
// Three shapes, because sqlite answers them differently:
//   - a NAMED nature is its own table, so the join IS the type test.
//   - NARROWED and untyped: seek `edge` once and ask each nature table for the
//     verb — a few primary-key probes over the few rows found.
//   - WHOLE and untyped: one branch per nature, unioned, so each nature table
//     is walked once instead of every edge being probed once per nature.
pub fn sentences(v: &Vocab, type_: Option<&str>, only: &str) -> String {
    let head = |verb: &str| {
        format!(
            "select g.\"from\" as parent, {verb} as type, \
             g.\"to\" as child, g.ord as ord from edge g"
        )
    };
    let where_ = if only.is_empty() { String::new() } else { format!(" where {only}") };
    if let Some(t) = type_ {
        let nature = nature_of(v, t).unwrap_or_else(|| t.to_string());
        return format!(
            "{} join \"{nature}\" n on n.entity = g.entity{where_}",
            head(&format!("'{t}'"))
        );
    }
    if only.is_empty() {
        return natures(v)
            .iter()
            .map(|n| {
                let word = type_of(v, n).unwrap_or_else(|| n.clone());
                format!("{} join \"{n}\" n on n.entity = g.entity", head(&format!("'{word}'")))
            })
            .collect::<Vec<_>>()
            .join(" union all ");
    }
    // An `edge` row always wears a nature — every door writes both or neither
    // — so a null verb is an anomaly, and it leaves here rather than reaching a
    // reader as a sentence with no word in the middle.
    let verb = format!(
        "(case {} end)",
        natures(v)
            .iter()
            .map(|n| {
                let word = type_of(v, n).unwrap_or_else(|| n.clone());
                format!(
                    "when exists (select 1 from \"{n}\" x where x.entity = g.entity) then '{word}'"
                )
            })
            .collect::<Vec<_>>()
            .join(" ")
    );
    format!("select parent, type, child, ord from ({}{where_}) where type is not null", head(&verb))
}

// The same store read WITHOUT the verb, for a walk that only asks whether one
// entity links to another (rooted.rs, and db.ts `links`). Naming a nature there
// is not just unused, it is expensive: the union is re-walked at every step of
// the recursion.
pub const LINKS: &str = "select g.\"from\" as parent, g.\"to\" as child from edge g";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocab::vocab;

    // The decisive cross-impl proof: these eids are the byte output of the REAL
    // TS `edgeEid` (src/edge.ts) over this corpus, captured with `deno run` at
    // authoring — the same table src/edge_test.ts pins on the TS side. A
    // sentence must name ONE entity in both languages or an edge written
    // through either door is invisible through the other.
    #[test]
    fn edge_eid_matches_ts_byte_for_byte() {
        let cases: &[(&str, &str, &str, &str)] = &[
            ("a", "requires", "b", "07c39ec4-e16c-8322-ad59-44178f02e45a"),
            ("b", "requires", "a", "d5e0b374-7e61-80dc-97e3-9975c5353a45"),
            ("a", "contains", "b", "1a0f3522-3bdb-8223-b79f-a80f68f86241"),
            ("", "requires", "", "79add936-c3db-860a-8061-ecf44caa8d79"),
            (
                "bbbbbbbb-0000-4000-8000-000000000011",
                "requires",
                "bbbbbbbb-0000-4000-8000-000000000004",
                "72e9e7c7-0650-83d4-af97-c1475d68d378",
            ),
            (
                "bbbbbbbb-0000-4000-8000-000000000002",
                "worked",
                "bbbbbbbb-0000-4000-8000-000000000011",
                "9fa90ea2-3890-8f93-a191-605763815652",
            ),
            (
                "bbbbbbbb-0000-4000-8000-000000000011",
                "references",
                "bbbbbbbb-0000-4000-8000-000000000004",
                "b6c37328-373f-8296-a188-41798035cf04",
            ),
            (
                "bbbbbbbb-0000-4000-8000-000000000011",
                "recalled",
                "bbbbbbbb-0000-4000-8000-000000000004",
                "7219d40a-50fa-8c47-ac83-80f568377fe8",
            ),
        ];
        for (from, nature, to, want) in cases {
            assert_eq!(&edge_eid(from, nature, to), want, "edgeEid({from}|{nature}|{to})");
        }
    }

    // The decisive cross-impl proof for the SQL door, the way edge_eid_matches_ts
    // pins the identity: these are the byte output of the REAL TS `sentences()`
    // and `links` (src/edge.ts), captured with `deno run` at authoring. A reader
    // in either language must build the same store, or `yak show` and the wire
    // answer differently about what an edge is.
    #[test]
    fn sentences_match_ts_byte_for_byte() {
        let v = vocab();
        assert_eq!(sentences(v, Some("requires"), ""), "select g.\"from\" as parent, 'requires' as type, g.\"to\" as child, g.ord as ord from edge g join \"requires\" n on n.entity = g.entity");
        assert_eq!(sentences(v, None, ""), "select g.\"from\" as parent, 'requires' as type, g.\"to\" as child, g.ord as ord from edge g join \"requires\" n on n.entity = g.entity union all select g.\"from\" as parent, 'contains' as type, g.\"to\" as child, g.ord as ord from edge g join \"contains\" n on n.entity = g.entity union all select g.\"from\" as parent, 'reads' as type, g.\"to\" as child, g.ord as ord from edge g join \"reads\" n on n.entity = g.entity union all select g.\"from\" as parent, 'about' as type, g.\"to\" as child, g.ord as ord from edge g join \"about\" n on n.entity = g.entity union all select g.\"from\" as parent, 'supervises' as type, g.\"to\" as child, g.ord as ord from edge g join \"supervises\" n on n.entity = g.entity union all select g.\"from\" as parent, 'delegates' as type, g.\"to\" as child, g.ord as ord from edge g join \"delegates\" n on n.entity = g.entity union all select g.\"from\" as parent, 'recalled' as type, g.\"to\" as child, g.ord as ord from edge g join \"recalled\" n on n.entity = g.entity union all select g.\"from\" as parent, 'supersedes' as type, g.\"to\" as child, g.ord as ord from edge g join \"supersedes\" n on n.entity = g.entity union all select g.\"from\" as parent, 'worked' as type, g.\"to\" as child, g.ord as ord from edge g join \"worked\" n on n.entity = g.entity union all select g.\"from\" as parent, 'referenced' as type, g.\"to\" as child, g.ord as ord from edge g join \"references\" n on n.entity = g.entity union all select g.\"from\" as parent, 'wants' as type, g.\"to\" as child, g.ord as ord from edge g join \"wants\" n on n.entity = g.entity union all select g.\"from\" as parent, 'satisfies' as type, g.\"to\" as child, g.ord as ord from edge g join \"satisfies\" n on n.entity = g.entity");
        assert_eq!(sentences(v, None, "g.\"from\" = 7"), "select parent, type, child, ord from (select g.\"from\" as parent, (case when exists (select 1 from \"requires\" x where x.entity = g.entity) then 'requires' when exists (select 1 from \"contains\" x where x.entity = g.entity) then 'contains' when exists (select 1 from \"reads\" x where x.entity = g.entity) then 'reads' when exists (select 1 from \"about\" x where x.entity = g.entity) then 'about' when exists (select 1 from \"supervises\" x where x.entity = g.entity) then 'supervises' when exists (select 1 from \"delegates\" x where x.entity = g.entity) then 'delegates' when exists (select 1 from \"recalled\" x where x.entity = g.entity) then 'recalled' when exists (select 1 from \"supersedes\" x where x.entity = g.entity) then 'supersedes' when exists (select 1 from \"worked\" x where x.entity = g.entity) then 'worked' when exists (select 1 from \"references\" x where x.entity = g.entity) then 'referenced' when exists (select 1 from \"wants\" x where x.entity = g.entity) then 'wants' when exists (select 1 from \"satisfies\" x where x.entity = g.entity) then 'satisfies' end) as type, g.\"to\" as child, g.ord as ord from edge g where g.\"from\" = 7) where type is not null");
        assert_eq!(LINKS, "select g.\"from\" as parent, g.\"to\" as child from edge g");
    }

    #[test]
    fn every_edge_word_has_a_nature_comp_and_back() {
        let v = vocab();
        assert_eq!(nature_of(v, "referenced").as_deref(), Some("references"));
        assert_eq!(nature_of(v, "requires").as_deref(), Some("requires"));
        // The one nature that is an event, so the one that stays past tense.
        assert_eq!(nature_of(v, "recalled").as_deref(), Some("recalled"));
        assert_eq!(nature_of(v, "nonsense"), None);
        for n in natures(v) {
            assert!(v.comp(&n).is_some(), "{n} is not a comp");
            assert_eq!(nature_of(v, &type_of(v, &n).unwrap()), Some(n));
        }
    }
}
