// Who an inbox reads FOR, ported from client.ts: the session acting for an
// actor, standing in a project, holding claims — and the pure addressed()/
// inbox_item() predicates over that reader. Same policy, read directly off
// the file.

use crate::store::{Row, Store};
use std::collections::HashSet;

#[derive(Debug, Default, Clone)]
pub struct Reader {
    pub session: Option<String>, // session ENTITY eid
    pub actor: Option<String>,
    pub scope: Option<String>,
    pub operator: bool,
    pub claims: HashSet<String>,
    pub addrs: HashSet<String>,
    pub watching: HashSet<String>,
    pub muting: HashSet<String>,
}

fn s(v: Option<&serde_json::Value>) -> String {
    match v {
        Some(serde_json::Value::String(x)) => x.clone(),
        Some(other) if !other.is_null() => other.to_string(),
        _ => String::new(),
    }
}

fn comp<'a>(r: &'a Row, comp: &str, prop: &str) -> Option<&'a serde_json::Value> {
    r.comps.get(comp)?.as_object()?.get(prop)
}

// A stored bool reads back as INTEGER 1 — JS `== true` passes it, so the
// port must too.
pub fn truthy(v: Option<&serde_json::Value>) -> bool {
    matches!(v, Some(serde_json::Value::Bool(true))) || v.and_then(|x| x.as_i64()) == Some(1)
}

// isOperator (client.ts): absent session comp = a human CLI — operator.
fn is_operator(sess: Option<&Row>) -> bool {
    let Some(r) = sess else { return true };
    let Some(sc) = r.comps.get("session").and_then(|v| v.as_object()) else {
        return true;
    };
    truthy(sc.get("operator"))
        && s(sc.get("requested_task")).is_empty()
        && (s(sc.get("origin")) != "managed" || !s(sc.get("role")).is_empty())
}

// The notification lifecycle predicates.
pub fn in_inbox(r: &Row) -> bool {
    !r.comps.contains_key("archived")
}
pub fn is_unread(r: &Row) -> bool {
    !r.comps.contains_key("opened")
}

// What an item is ABOUT — the eid watch/mute instructions aim at.
pub fn about_of(r: &Row) -> String {
    for (c, p) in
        [("comment", "target"), ("notice", "target"), ("mail", "target"), ("knock", "target")]
    {
        let v = s(comp(r, c, p));
        if !v.is_empty() {
            return v;
        }
    }
    String::new()
}

// addressed() — the four doors an item reaches attention through.
pub fn addressed(who: &Reader, r: &Row) -> bool {
    let sess = who.session.as_deref().unwrap_or("");
    let actor = who.actor.as_deref().unwrap_or("");
    let aimed = |t: &str| {
        (!sess.is_empty() && t == sess)
            || who.claims.contains(t)
            || (who.operator && !actor.is_empty() && t == actor)
    };
    if r.comps.contains_key("comment") {
        return aimed(&s(comp(r, "comment", "target")));
    }
    if r.comps.contains_key("notice") {
        return aimed(&s(comp(r, "notice", "target")));
    }
    if r.comps.contains_key("knock") {
        let t = s(comp(r, "deliver", "to"));
        return !t.is_empty() && ((!sess.is_empty() && t == sess) || (who.operator && t == actor));
    }
    if let Some(m) = r.comps.get("mail").and_then(|v| v.as_object()) {
        if s(m.get("message_id")).is_empty() {
            return false;
        }
        if !sess.is_empty() && s(m.get("target")) == sess {
            return true;
        }
        if !who.operator {
            return false;
        }
        let to = s(m.get("to_addr"));
        return (!who.addrs.is_empty() && who.addrs.contains(&to))
            || (who.scope.is_some() && s(m.get("target")) == *who.scope.as_ref().unwrap());
    }
    false
}

// inbox_item() — addressed to me and not archived, with watch/mute standing
// instructions overriding the default.
pub fn inbox_item(who: &Reader, r: &Row) -> bool {
    if !in_inbox(r) {
        return false;
    }
    let about = about_of(r);
    if !about.is_empty() && who.muting.contains(&about) {
        return false;
    }
    if !about.is_empty() && who.watching.contains(&about) {
        return true;
    }
    addressed(who, r)
}

fn clean_path(p: &str) -> String {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        "/".into()
    } else {
        t.into()
    }
}

// The deepest directory root containing a path (ancestorAt).
fn ancestor_at(roots: &[String], path: &str) -> Option<String> {
    let mut best: Option<String> = None;
    for root in roots {
        let root = clean_path(root);
        if (path == root || path.starts_with(&format!("{root}/")))
            && root.len() > best.as_deref().map(|b| b.len()).unwrap_or(0)
        {
            best = Some(root);
        }
    }
    best
}

// The fleet's linked-worktree layout (worktreeAt).
fn worktree_at(roots: &[String], path: &str) -> Option<String> {
    let found: Vec<String> = roots
        .iter()
        .map(|r| clean_path(r))
        .filter(|root| {
            let Some(name) = root.split('/').next_back() else {
                return false;
            };
            [format!("/tasks-worktrees/{name}/"), format!("/worktrees/{name}/")].iter().any(
                |marker| {
                    path.find(marker.as_str()).map(|i| path.len() > i + marker.len()) == Some(true)
                },
            )
        })
        .collect();
    (found.len() == 1).then(|| found[0].clone())
}

// The project a caller stands in (scopeFor): explicit arg, the cwd's repo,
// the worn persona's home, then the actor when it IS a project.
pub fn scope_for(
    store: &Store,
    sess: Option<&Row>,
    cwd: &str,
    arg: Option<&str>,
) -> Option<String> {
    if let Some(a) = arg {
        return Some(a.to_string());
    }
    // repos: every entity wearing repo.path
    let repos: Vec<(String, String)> = {
        if !store.has_table("repo") {
            vec![]
        } else {
            let mut st = store
                .conn
                .prepare(
                    "select e.eid, t.path from repo t join entity e \
                     on e.id = t.entity where t.path is not null",
                )
                .ok()?;
            let got: Vec<(String, String)> = st
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .ok()?
                .filter_map(|x| x.ok())
                .collect();
            got
        }
    };
    let roots: Vec<String> = repos.iter().map(|(_, p)| p.clone()).collect();
    let at = ancestor_at(&roots, cwd).or_else(|| worktree_at(&roots, cwd));
    if let Some(at) = at {
        if let Some((eid, _)) = repos.iter().find(|(_, p)| clean_path(p) == at) {
            return Some(eid.clone());
        }
    }
    let sc = sess?.comps.get("session")?.as_object()?;
    let worn = s(sc.get("persona"));
    if !worn.is_empty() {
        if let Some(p) = store.row(&worn) {
            let home = s(comp(&p, "persona", "home"));
            if !home.is_empty() {
                if let Some(h) = store.row(&home) {
                    if h.comps.contains_key("project") {
                        return Some(home);
                    }
                }
            }
        }
    }
    let actor = s(sc.get("actor"));
    if !actor.is_empty() {
        if let Some(a) = store.row(&actor) {
            if a.comps.contains_key("project") {
                return Some(actor);
            }
        }
    }
    None
}

// readerFor, resolved against the file instead of a row set.
pub fn reader_for(
    store: &Store,
    session: Option<&str>,
    cwd: &str,
    scope_arg: Option<&str>,
) -> Reader {
    let sess = session.and_then(|sid| store.session_row(sid));
    let sc = sess.as_ref().and_then(|r| r.comps.get("session")).and_then(|v| v.as_object());
    let actor = sc.map(|m| s(m.get("actor"))).filter(|a| !a.is_empty());
    let mut addrs = HashSet::new();
    if let Some(a) = &actor {
        addrs.insert(a.clone());
        if let Some(row) = store.row(a) {
            let mail = s(comp(&row, "email", "address"));
            if !mail.is_empty() {
                addrs.insert(mail);
            }
        }
    }
    let claims: HashSet<String> = match &sess {
        Some(sr) => store
            .eids_where_ref("claim", "session", std::slice::from_ref(&sr.eid))
            .into_iter()
            .collect(),
        None => HashSet::new(),
    };
    let (mut watching, mut muting) = (HashSet::new(), HashSet::new());
    if let Some(a) = &actor {
        for eid in store.eids_where_ref("subscription", "actor", std::slice::from_ref(a)) {
            if let Some(r) = store.row(&eid) {
                let target = s(comp(&r, "subscription", "target"));
                if target.is_empty() {
                    continue;
                }
                if s(comp(&r, "subscription", "mode")) == "mute" {
                    muting.insert(target);
                } else {
                    watching.insert(target);
                }
            }
        }
    }
    let cwd_eff = if cwd.is_empty() {
        sc.map(|m| s(m.get("cwd"))).unwrap_or_default()
    } else {
        cwd.to_string()
    };
    Reader {
        session: sess.as_ref().map(|r| r.eid.clone()),
        actor: actor.clone(),
        scope: scope_for(store, sess.as_ref(), &cwd_eff, scope_arg),
        operator: is_operator(sess.as_ref()),
        claims,
        addrs,
        watching,
        muting,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ancestor_respects_boundaries() {
        let roots = vec!["/code/app".to_string()];
        assert_eq!(ancestor_at(&roots, "/code/app/src"), Some("/code/app".into()));
        assert_eq!(ancestor_at(&roots, "/code/apple"), None);
    }

    #[test]
    fn worktree_layouts_resolve_uniquely() {
        let roots = vec!["/home/x/code/tasks".to_string()];
        assert_eq!(
            worktree_at(&roots, "/home/x/.tasks/worktrees/tasks/S-1"),
            Some("/home/x/code/tasks".into())
        );
        assert_eq!(worktree_at(&roots, "/somewhere/else"), None);
    }
}
