// The owner's inbox: what reached them (the kernel's own inbox predicate, so
// the count agrees with every other door), what they said, what recently had
// their attention, and what waits on their decision — plus search. Reads go
// through the kernel Store; the three writes (open-stamp, archive, reply) go
// through the kernel's gated apply() as the owner, so the journal names them.
// M-31946 point 6: async, an inbox, an archive that hides what has been seen.

use serde_json::{Map, Value};
use yak_kernel::inbox::born_at;
use yak_kernel::owner;
use yak_kernel::reader::{about_of, in_inbox, inbox_item, is_unread, reader_at, Reader};
use yak_kernel::search::search;
use yak_kernel::store::{visible, Sel};
use yak_kernel::{apply, vocab, ApplyOpts, Change, Gate, Row, Store, WriteStore};

use crate::theme;

#[derive(Clone, Copy, PartialEq)]
pub enum Tab {
    Received,
    Said,
    Recent,
    Attention,
    Search,
}

impl Tab {
    pub const ALL: [Tab; 4] = [Tab::Received, Tab::Said, Tab::Recent, Tab::Attention];
    pub fn name(self) -> &'static str {
        match self {
            Tab::Received => "received",
            Tab::Said => "said",
            Tab::Recent => "recent",
            Tab::Attention => "attention",
            Tab::Search => "search",
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Pane {
    List,
    Read,
    Reply,
    Search,
}

// One line of the inbox. `target` is what the item is ABOUT (a knock's or
// comment's target; a turn's session); `line` the first line of its words.
#[derive(Clone)]
pub struct Item {
    pub eid: String,
    pub id: String,
    pub kind: String,
    pub when: String,
    pub from: String,
    pub target: String,
    pub target_id: String,
    pub line: String,
    pub unread: bool,
}

pub struct Note {
    pub id: String,
    pub from: String,
    pub when: String,
    pub body: String,
}

// An item opened whole: its words, the title of what it is about, and the
// thread of comments on that target, oldest first.
pub struct Reading {
    pub item: Item,
    pub title: String,
    pub body: String,
    pub thread: Vec<Note>,
    pub scroll: usize,
}

pub struct Inbox {
    pub owner: Option<String>,
    pub owner_label: String,
    pub tab: Tab,
    pub items: Vec<Item>,
    pub sel: usize,
    pub pane: Pane,
    pub reading: Option<Reading>,
    pub input: String,
    pub query: String,
    pub unread: usize,
    pub waiting: usize,
}

fn cstr(r: &Row, comp: &str, prop: &str) -> String {
    r.comps
        .get(comp)
        .and_then(|c| c.as_object())
        .and_then(|o| o.get(prop))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn id_of(r: &Row) -> String {
    vocab().id_of(&r.kind, &r.eid, r.num)
}

// A row's one-line words: its body's first line, else its title.
fn line_of(r: &Row) -> String {
    let body = cstr(r, "doc", "body");
    let first = body.trim().lines().next().unwrap_or("").trim();
    let text = if first.is_empty() { cstr(r, "doc", "title") } else { first.to_string() };
    theme::sane(&text, false)
}

// A letter the fleet wrote to the owner: mail delivered to their person, still
// in the inbox, and not about something they muted.
fn letter_to(who: &Reader, owner: &str, r: &Row) -> bool {
    r.comps.contains_key("mail")
        && cstr(r, "deliver", "to") == owner
        && in_inbox(r)
        && !who.muting.contains(&about_of(r))
}

// ISO -> "MM-DD HH:MM".
pub fn when_of(iso: &str) -> String {
    iso.chars().skip(5).take(11).collect::<String>().replace('T', " ")
}

// The faces of many eids in one read: eid -> (human id, label).
fn faces(store: &Store, eids: &[String]) -> std::collections::HashMap<String, (String, String)> {
    let mut want: Vec<String> = eids.iter().filter(|e| !e.is_empty()).cloned().collect();
    want.sort();
    want.dedup();
    store
        .rows_of_faces(&want)
        .into_iter()
        .map(|r| {
            let slug = cstr(&r, "alias", "slug");
            let title = cstr(&r, "doc", "title");
            let label = if !slug.is_empty() {
                slug
            } else if !title.is_empty() {
                title
            } else {
                id_of(&r)
            };
            (r.eid.clone(), (id_of(&r), theme::sane(&label, false)))
        })
        .collect()
}

impl Inbox {
    pub fn new(store: &Store, hint: Option<&str>) -> Inbox {
        let owner = owner::owner(store, hint);
        let owner_label = owner
            .as_deref()
            .and_then(|o| faces(store, std::slice::from_ref(&o.to_string())).remove(o))
            .map(|(id, label)| format!("{label} ({id})"))
            .unwrap_or_else(|| "(no owner)".into());
        let mut ib = Inbox {
            owner,
            owner_label,
            tab: Tab::Received,
            items: vec![],
            sel: 0,
            pane: Pane::List,
            reading: None,
            input: String::new(),
            query: String::new(),
            unread: 0,
            waiting: 0,
        };
        ib.load(store);
        ib
    }

    // Reload the open tab (and the two badge counts). The cursor keeps its
    // ROW, not its item: the list is unread-first, so after a read or an
    // archive the row under the cursor is the next thing to deal with.
    pub fn load(&mut self, store: &Store) {
        self.items = match self.tab {
            Tab::Received => self.received(store),
            Tab::Said => self.said(store),
            Tab::Recent => self.recent(store),
            Tab::Attention => self.attention(store),
            Tab::Search => self.hits(store),
        };
        self.waiting = owner::attention(store).len();
        if self.tab == Tab::Received {
            self.unread = self.items.iter().filter(|i| i.unread).count();
        }
        self.sel = self.sel.min(self.items.len().saturating_sub(1));
    }

    // What reached the owner. The kernel's inbox predicate (reader.rs
    // inbox_item) decides, over the same candidate arms inbox.rs gathers —
    // comments and notices at the owner, knocks delivered to them, mail at
    // their addresses, plus watched targets — so the count agrees with every
    // other door. One arm is the owner's alone: a LETTER the fleet wrote to
    // them (mail delivered to their person) counts even though it never
    // "arrived" in the graph — it left for their real mailbox, and this is
    // the fleet's side of that conversation. Bulk-loaded: one read per comp
    // table for the whole set, never a row at a time.
    fn received(&self, store: &Store) -> Vec<Item> {
        let Some(owner) = &self.owner else { return vec![] };
        let who = reader_at(store, owner);
        let me = vec![owner.clone()];
        let addrs: Vec<String> = who.addrs.iter().cloned().collect();
        let watched: Vec<String> = who.watching.iter().cloned().collect();
        let mut eids: Vec<String> = vec![];
        eids.extend(store.eids_where_ref("comment", "target", &me));
        eids.extend(store.eids_where_ref("notice", "target", &me));
        eids.extend(store.eids_where_ref("deliver", "to", &me));
        eids.extend(store.eids_where_text("mail", "to_addr", &addrs));
        for comp in ["comment", "notice", "knock", "mail"] {
            eids.extend(store.eids_where_ref(comp, "target", &watched));
        }
        eids.sort();
        eids.dedup();
        let mut rows: Vec<Row> = store
            .rows_of(&eids)
            .into_iter()
            .filter(|r| visible(r) && (inbox_item(&who, r) || letter_to(&who, owner, r)))
            .collect();
        // unread first, then newest first
        rows.sort_by(|a, b| {
            is_unread(b).cmp(&is_unread(a)).then_with(|| born_at(b).cmp(&born_at(a)))
        });
        let mut refs: Vec<String> = vec![];
        for r in &rows {
            refs.push(cstr(r, "created", "by"));
            refs.push(about_of(r));
        }
        let f = faces(store, &refs);
        let face = |e: &str| f.get(e).cloned().unwrap_or_default();
        rows.iter()
            .map(|r| {
                let target = about_of(r);
                let sender = cstr(r, "mail", "from");
                Item {
                    eid: r.eid.clone(),
                    id: id_of(r),
                    kind: r.kind.clone(),
                    when: when_of(&born_at(r)),
                    from: if sender.is_empty() {
                        face(&cstr(r, "created", "by")).1
                    } else {
                        theme::sane(&sender, false)
                    },
                    target_id: face(&target).0,
                    target,
                    line: line_of(r),
                    unread: is_unread(r),
                }
            })
            .collect()
    }

    fn said(&self, store: &Store) -> Vec<Item> {
        let Some(owner) = &self.owner else { return vec![] };
        let said = owner::said(store, owner, 200);
        let mut refs: Vec<String> = said.iter().map(|s| s.eid.clone()).collect();
        refs.extend(said.iter().map(|s| s.about.clone()));
        refs.retain(|e| !e.is_empty());
        refs.sort();
        refs.dedup();
        let rows: std::collections::HashMap<String, Row> =
            store.rows_of_faces(&refs).into_iter().map(|r| (r.eid.clone(), r)).collect();
        said.into_iter()
            .map(|s| {
                let (id, kind) = rows
                    .get(&s.eid)
                    .map(|r| (id_of(r), r.kind.clone()))
                    .unwrap_or_else(|| (s.eid.chars().take(8).collect(), String::new()));
                Item {
                    id,
                    kind: if s.via == "turn" { "turn".into() } else { kind },
                    target_id: rows.get(&s.about).map(id_of).unwrap_or_default(),
                    target: s.about,
                    eid: s.eid,
                    when: when_of(&s.at),
                    from: self.owner_label.clone(),
                    line: theme::sane(&s.line, false),
                    unread: false,
                }
            })
            .collect()
    }

    fn recent(&self, store: &Store) -> Vec<Item> {
        let Some(owner) = &self.owner else { return vec![] };
        let touches = owner::recent(store, owner, 100);
        let eids: Vec<String> = touches.iter().map(|t| t.eid.clone()).collect();
        let rows: std::collections::HashMap<String, Row> =
            store.rows_of_faces(&eids).into_iter().map(|r| (r.eid.clone(), r)).collect();
        touches
            .into_iter()
            .filter_map(|t| {
                let r = rows.get(&t.eid)?;
                // The web mints clients, cameras and cursors in the owner's name
                // as they browse; only what carries words counts as attention.
                if t.act == "created" && !r.comps.contains_key("doc") {
                    return None;
                }
                Some(Item {
                    eid: t.eid.clone(),
                    id: id_of(r),
                    kind: r.kind.clone(),
                    when: when_of(&t.at),
                    from: t.act,
                    target: String::new(),
                    target_id: String::new(),
                    line: theme::sane(&cstr(r, "doc", "title"), false),
                    unread: false,
                })
            })
            .collect()
    }

    fn attention(&self, store: &Store) -> Vec<Item> {
        let waiting = owner::attention(store);
        let eids: Vec<String> = waiting.iter().map(|(e, _)| e.clone()).collect();
        let rows: std::collections::HashMap<String, Row> =
            store.rows_of_faces(&eids).into_iter().map(|r| (r.eid.clone(), r)).collect();
        waiting
            .into_iter()
            .filter_map(|(eid, at)| {
                let r = rows.get(&eid)?;
                Some(Item {
                    eid: eid.clone(),
                    id: id_of(r),
                    kind: r.kind.clone(),
                    when: when_of(&at),
                    from: "proposed".into(),
                    target: String::new(),
                    target_id: String::new(),
                    line: theme::sane(&cstr(r, "doc", "title"), false),
                    unread: true,
                })
            })
            .collect()
    }

    fn hits(&self, store: &Store) -> Vec<Item> {
        if self.query.trim().is_empty() {
            return vec![];
        }
        let hits = search(store, &self.query, 50).unwrap_or_default();
        hits.into_iter()
            .map(|h| {
                let line = if h.snip.is_empty() { h.title.clone() } else { h.snip.clone() };
                Item {
                    id: h.open_id.clone().unwrap_or_else(|| vocab().id_of(&h.kind, &h.eid, h.num)),
                    eid: h.open,
                    kind: h.kind,
                    when: String::new(),
                    from: String::new(),
                    target: String::new(),
                    target_id: String::new(),
                    line: theme::sane(&line.replace(['\u{1}', '\u{2}'], ""), false),
                    unread: false,
                }
            })
            .collect()
    }

    // --- navigation ---

    pub fn len(&self) -> usize {
        match self.pane {
            Pane::Read => 0,
            _ => self.items.len(),
        }
    }

    pub fn down(&mut self) {
        match self.pane {
            Pane::Read => {
                if let Some(r) = self.reading.as_mut() {
                    r.scroll += 1;
                }
            }
            _ if self.sel + 1 < self.items.len() => self.sel += 1,
            _ => {}
        }
    }

    pub fn up(&mut self) {
        match self.pane {
            Pane::Read => {
                if let Some(r) = self.reading.as_mut() {
                    r.scroll = r.scroll.saturating_sub(1);
                }
            }
            _ => self.sel = self.sel.saturating_sub(1),
        }
    }

    pub fn top(&mut self) {
        match self.pane {
            Pane::Read => {
                if let Some(r) = self.reading.as_mut() {
                    r.scroll = 0;
                }
            }
            _ => self.sel = 0,
        }
    }

    pub fn bottom(&mut self) {
        if self.pane != Pane::Read {
            self.sel = self.items.len().saturating_sub(1);
        }
    }

    pub fn next_tab(&mut self, store: &Store, back: bool) {
        let i = Tab::ALL.iter().position(|t| *t == self.tab).unwrap_or(0);
        let n = Tab::ALL.len();
        self.tab = Tab::ALL[if back { (i + n - 1) % n } else { (i + 1) % n }];
        self.sel = 0;
        self.pane = Pane::List;
        self.reading = None;
        self.load(store);
    }

    pub fn go_tab(&mut self, store: &Store, tab: Tab) {
        self.tab = tab;
        self.sel = 0;
        self.pane = Pane::List;
        self.reading = None;
        self.load(store);
    }

    pub fn selected(&self) -> Option<&Item> {
        match self.pane {
            Pane::Read => self.reading.as_ref().map(|r| &r.item),
            _ => self.items.get(self.sel),
        }
    }

    // Open the selected item whole. A received item that was unread is
    // stamped `opened` by the owner, through apply — the same mark
    // `task inbox show` leaves, so every door agrees it has been read.
    pub fn open(&mut self, store: &Store, write: &WriteStore, gates: &[Box<dyn Gate>]) {
        let Some(item) = self.items.get(self.sel).cloned() else { return };
        let Some(row) = store.row(&item.eid) else { return };
        let about = if item.target.is_empty() { item.eid.clone() } else { item.target.clone() };
        let title = if item.target.is_empty() {
            cstr(&row, "doc", "title")
        } else {
            store
                .row_cols(&item.target, &[Sel { comp: "doc", props: &["title"] }])
                .map(|t| cstr(&t, "doc", "title"))
                .unwrap_or_default()
        };
        let body = if row.comps.contains_key("entry") {
            cstr(&row, "content", "body")
        } else {
            cstr(&row, "doc", "body")
        };
        let thread_eids = store.comments_on(&about);
        let thread_rows = store.rows_of(&thread_eids);
        let authors: Vec<String> = thread_rows.iter().map(|r| cstr(r, "created", "by")).collect();
        let f = faces(store, &authors);
        let thread = thread_rows
            .iter()
            .filter(|r| r.eid != item.eid)
            .map(|r| Note {
                id: id_of(r),
                from: f.get(&cstr(r, "created", "by")).map(|x| x.1.clone()).unwrap_or_default(),
                when: when_of(&born_at(r)),
                body: theme::sane(&cstr(r, "doc", "body"), true),
            })
            .collect();
        self.reading = Some(Reading {
            item: item.clone(),
            title: theme::sane(&title, false),
            body: theme::sane(&body, true),
            thread,
            scroll: 0,
        });
        self.pane = Pane::Read;
        if item.unread && self.tab == Tab::Received {
            if let Err(e) =
                self.apply(write, gates, vec![Change::new(&item.eid, "opened", Some(Map::new()))])
            {
                // A refused read-stamp is not a failed read: the words are up.
                self.input = String::new();
                let _ = e;
            } else if let Some(i) = self.items.iter_mut().find(|i| i.eid == item.eid) {
                i.unread = false;
                self.unread = self.unread.saturating_sub(1);
            }
        }
    }

    // Back one level: an input closes, a reading closes, the list says "done"
    // to the caller (false), who leaves the inbox.
    pub fn back(&mut self) -> bool {
        match self.pane {
            Pane::Reply | Pane::Search => {
                self.pane = if self.reading.is_some() { Pane::Read } else { Pane::List };
                self.input.clear();
                true
            }
            Pane::Read => {
                self.pane = Pane::List;
                self.reading = None;
                true
            }
            Pane::List => false,
        }
    }

    // --- the three writes, as the owner ---

    fn apply(
        &self,
        write: &WriteStore,
        gates: &[Box<dyn Gate>],
        changes: Vec<Change>,
    ) -> Result<(), String> {
        let opts = ApplyOpts { writer: self.owner.as_deref(), fed: true, ..Default::default() };
        apply(write, changes, &opts, gates).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn archive(
        &mut self,
        store: &Store,
        write: &WriteStore,
        gates: &[Box<dyn Gate>],
    ) -> Result<String, String> {
        if self.tab != Tab::Received {
            return Err("archive is for received items".into());
        }
        let Some(item) = self.selected().cloned() else { return Err("nothing selected".into()) };
        self.apply(write, gates, vec![Change::new(&item.eid, "archived", Some(Map::new()))])?;
        if self.pane == Pane::Read {
            self.pane = Pane::List;
            self.reading = None;
        }
        self.load(store);
        Ok(format!("archived {}", item.id))
    }

    pub fn start_reply(&mut self) -> Result<(), String> {
        if self.selected().is_none() {
            return Err("nothing selected".into());
        }
        self.input.clear();
        self.pane = Pane::Reply;
        Ok(())
    }

    pub fn start_search(&mut self) {
        self.input.clear();
        self.pane = Pane::Search;
    }

    // Enter in an input: a reply lands as a comment on what the item is about
    // (its target, else itself); a search runs and shows its hits as a tab.
    pub fn submit(
        &mut self,
        store: &Store,
        write: &WriteStore,
        gates: &[Box<dyn Gate>],
    ) -> Result<String, String> {
        let text = self.input.trim().to_string();
        match self.pane {
            Pane::Reply => {
                let Some(item) = self.selected().cloned() else {
                    return Err("nothing selected".into());
                };
                let was_reading = self.reading.is_some();
                self.pane = if was_reading { Pane::Read } else { Pane::List };
                self.input.clear();
                if text.is_empty() {
                    return Ok("reply cancelled".into());
                }
                let target =
                    if item.target.is_empty() { item.eid.clone() } else { item.target.clone() };
                let eid = uuid::Uuid::new_v4().to_string();
                let mut doc = Map::new();
                doc.insert("title".into(), Value::from(""));
                doc.insert("body".into(), Value::from(text));
                let mut comment = Map::new();
                comment.insert("target".into(), Value::from(target.as_str()));
                self.apply(
                    write,
                    gates,
                    vec![
                        Change::new(&eid, "doc", Some(doc)),
                        Change::new(&eid, "comment", Some(comment)),
                    ],
                )?;
                if was_reading {
                    // re-open so the thread shows the reply
                    let sel = self.items.iter().position(|i| i.eid == item.eid).unwrap_or(self.sel);
                    self.sel = sel;
                    self.open(store, write, gates);
                }
                let on = if item.target_id.is_empty() {
                    item.id.clone()
                } else {
                    item.target_id.clone()
                };
                Ok(format!("replied on {on}"))
            }
            Pane::Search => {
                self.input.clear();
                if text.is_empty() {
                    self.pane = Pane::List;
                    return Ok(String::new());
                }
                self.query = text.clone();
                self.tab = Tab::Search;
                self.pane = Pane::List;
                self.reading = None;
                self.sel = 0;
                self.load(store);
                Ok(format!("{} hits for {text}", self.items.len()))
            }
            _ => Ok(String::new()),
        }
    }

    pub fn typing(&self) -> bool {
        matches!(self.pane, Pane::Reply | Pane::Search)
    }

    pub fn type_char(&mut self, c: char) {
        if !c.is_control() {
            self.input.push(c);
        }
    }

    pub fn backspace(&mut self) {
        self.input.pop();
    }
}
