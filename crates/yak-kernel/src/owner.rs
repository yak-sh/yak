// The owner's side of the graph, read off the file: who the owner is, what
// they said (their authored stream, newest first), what recently had their
// attention, and what waits on their decision. Pure reads over the Store —
// the TUI inbox renders these; nothing here writes. One user, one owner
// (M-31946): the default owner is the person the graph names first.

use crate::store::{collect, one, Store};

// Who the owner is: an explicit hint (a human id, an eid, or an address),
// else YAK_OWNER, else the person wearing the lowest num.
pub fn owner(store: &Store, hint: Option<&str>) -> Option<String> {
    let hint = hint
        .map(String::from)
        .or_else(|| std::env::var("YAK_OWNER").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(h) = hint {
        if h.contains('@') {
            return one(
                &store.conn,
                "select e.eid from email m join entity e on e.id = m.entity \
                 where m.address = ?1 collate nocase",
                [h],
                |r| r.get(0),
            );
        }
        return store.resolve_id(&h);
    }
    if !store.has_table("person") {
        return None;
    }
    one(
        &store.conn,
        "select e.eid from person p join entity e on e.id = p.entity order by e.num limit 1",
        [],
        |r| r.get(0),
    )
}

// One thing the owner authored. `via` says which door: `turn` for a typed
// prompt (its `about` is the session), else the entity's own creation
// (`about` empty). `line` is the first line; `body` the whole text.
#[derive(Debug, Clone)]
pub struct Said {
    pub eid: String,
    pub at: String,
    pub via: String,
    pub about: String,
    pub line: String,
    pub body: String,
}

fn first_line(s: &str) -> String {
    s.trim().lines().next().unwrap_or("").to_string()
}

// The typed turns (client.ts `spoken`): a user-role message entry wearing the
// `prompt` tag, in a session a human sat at — one with a pane, not managed,
// not a subagent. Newest first, at most `n`.
fn turns(store: &Store, n: usize) -> Vec<Said> {
    for t in ["prompt", "entry", "message", "content", "session"] {
        if !store.has_table(t) {
            return vec![];
        }
    }
    collect(
        &store.conn,
        "select o.eid, coalesce(cr.at, ''), so.eid, c.body \
         from prompt p \
         join entity o on o.id = p.entity \
         join entry en on en.entity = p.entity \
         join message m on m.entity = p.entity and m.role = 'user' \
         join content c on c.entity = p.entity and trim(c.body) != '' \
         join session s on s.entity = en.session \
         join entity so on so.id = s.entity \
         left join created cr on cr.entity = p.entity \
         where s.pane is not null \
           and coalesce(s.origin, '') != 'managed' \
           and s.agent_type is null \
           and not exists (select 1 from tombstone t where t.eid = o.eid) \
         order by cr.at desc limit ?1",
        [n as i64],
        |r| {
            let body: String = r.get(3)?;
            Ok(Said {
                eid: r.get(0)?,
                at: r.get(1)?,
                via: "turn".into(),
                about: r.get(2)?,
                line: first_line(&body),
                body: body.trim().to_string(),
            })
        },
    )
}

// Everything else the owner created — comments, tasks, memories, mail,
// designs — by the `created.by` stamp. A turn is never stamped by the owner
// (ingest writes it), so the two arms never overlap. Newest first.
fn authored(store: &Store, owner: &str, n: usize) -> Vec<Said> {
    if !store.has_table("created") {
        return vec![];
    }
    let doc = store.has_table("doc") && store.has_table("blob_text");
    let (title, body, join) = if doc {
        (
            "coalesce(d.title, '')",
            "coalesce(bt.value, '')",
            " left join doc d on d.entity = cr.entity left join blob_text bt on bt.entity = d.body",
        )
    } else {
        ("''", "''", "")
    };
    let sql = format!(
        "select o.eid, cr.at, {title}, {body} \
         from created cr \
         join entity o on o.id = cr.entity \
         join entity ow on ow.id = cr.\"by\" and ow.eid = ?1{join} \
         where not exists (select 1 from tombstone t where t.eid = o.eid) \
         order by cr.at desc limit ?2"
    );
    collect(&store.conn, &sql, rusqlite::params![owner, n as i64], |r| {
        let title: String = r.get(2)?;
        let body: String = r.get(3)?;
        let line = if title.trim().is_empty() { first_line(&body) } else { title.trim().into() };
        Ok(Said {
            eid: r.get(0)?,
            at: r.get(1)?,
            via: "created".into(),
            about: String::new(),
            line,
            body: body.trim().to_string(),
        })
    })
}

// What the owner said, newest first: their typed turns and everything they
// authored, merged by time and cut to `n`.
pub fn said(store: &Store, owner: &str, n: usize) -> Vec<Said> {
    let mut out = turns(store, n);
    out.extend(authored(store, owner, n));
    out.sort_by(|a, b| b.at.cmp(&a.at).then(a.eid.cmp(&b.eid)));
    out.truncate(n);
    out
}

// Something that recently had the owner's attention: an entity they opened
// or created, with the stamp that says which and when. Newest first.
#[derive(Debug, Clone)]
pub struct Touch {
    pub eid: String,
    pub at: String,
    pub act: String, // "opened" | "created"
}

pub fn recent(store: &Store, owner: &str, n: usize) -> Vec<Touch> {
    let mut out: Vec<Touch> = vec![];
    for (table, act) in [("opened", "opened"), ("created", "created")] {
        if !store.has_table(table) {
            continue;
        }
        let sql = format!(
            "select o.eid, s.at from {table} s \
             join entity o on o.id = s.entity \
             join entity ow on ow.id = s.\"by\" and ow.eid = ?1 \
             where not exists (select 1 from tombstone t where t.eid = o.eid) \
             order by s.at desc limit ?2"
        );
        out.extend(collect(&store.conn, &sql, rusqlite::params![owner, n as i64], |r| {
            Ok(Touch { eid: r.get(0)?, at: r.get(1)?, act: act.into() })
        }));
    }
    out.sort_by(|a, b| b.at.cmp(&a.at).then(a.eid.cmp(&b.eid)));
    out.truncate(n);
    out
}

// What waits on the owner: every proposed entity with no decision yet —
// memories, designs, tasks — oldest first, since the oldest has waited
// longest. Quarantined and dead rows are screened like every read.
pub fn attention(store: &Store) -> Vec<(String, String)> {
    if !store.has_table("proposed") {
        return vec![];
    }
    let decided = if store.has_table("decided") {
        " and not exists (select 1 from decided d where d.entity = p.entity)"
    } else {
        ""
    };
    let quarantined = if store.has_table("quarantined") {
        " and not exists (select 1 from quarantined q where q.entity = p.entity)"
    } else {
        ""
    };
    let sql = format!(
        "select o.eid, p.at from proposed p \
         join entity o on o.id = p.entity \
         where not exists (select 1 from tombstone t where t.eid = o.eid){decided}{quarantined} \
         order by p.at, o.num"
    );
    collect(&store.conn, &sql, [], |r| Ok((r.get(0)?, r.get(1)?)))
}
