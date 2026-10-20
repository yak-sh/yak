# PROTOTYPE install of versioned component rows on a copy of the graph.
#
# Every journaled component table is rebuilt as
#   (<its columns>, branch, from, to) primary key (entity, branch, to)
#   without rowid
# where the open version has to = 0. Its rows become the open versions, with
# `from` the last journal transaction that wrote them; the journal's earlier
# writes of each (entity, component) become closed versions [tx_k, tx_k+1)
# carrying the open row's values (the depth and ranges are the journal's, the
# values a stand-in). journal_tx becomes tx. Indexes come back partial over
# open rows on main; triggers come back guarded the same way, and each delete
# trigger gains a sibling that fires when a version is closed.
import re, sqlite3, sys, time

path = sys.argv[1]
SKIP = {
  'tombstone', 'created', 'updated', 'submitted', 'inference', 'effect',
  'apply_receipt',
}
db = sqlite3.connect(path, isolation_level=None)
db.execute('pragma foreign_keys=off')
db.execute('pragma legacy_alter_table=on')
db.execute('pragma journal_mode=wal')
db.execute('pragma synchronous=off')
t0 = time.time()
log = lambda *a: print(f'{time.time()-t0:7.1f}s', *a, file=sys.stderr, flush=True)

def versionable(name):
  if name in SKIP or name.startswith('_') or name.startswith('sqlite_'):
    return False
  if 'fts' in name or name.startswith('journal_') or name.startswith('embedding'):
    return False
  info = db.execute(f'pragma table_info("{name}")').fetchall()
  return any(c[1] == 'entity' and c[5] == 1 and c[2].lower() == 'integer'
             for c in info) and sum(c[5] > 0 for c in info) == 1

tables = [r[0] for r in db.execute(
  "select name from sqlite_master where type='table' order by name")]
versioned = [t for t in tables if versionable(t)]
log(f'{len(versioned)} tables to version')

db.execute('begin')
for t in ('tx', 'branch', 'history_tables'):
  db.execute(f'drop table if exists "{t}"')
db.execute('''create table "tx" (
  "id" integer primary key, "at" text not null,
  "by" integer references entity(id), "via" integer references entity(id),
  "branch" integer not null default 0)''')
db.execute('insert into tx (id, at, by, via, branch) '
           'select id, ts, actor, via, 0 from journal_tx')
db.execute('create index "tx_by" on "tx" ("by")')
db.execute('create index "tx_via" on "tx" ("via")')
db.execute('''create table "branch" ("id" integer primary key,
  "parent" integer not null, "fork" integer not null, "at" text not null)''')
db.execute('create table "history_tables" ("name" text primary key) without rowid')
db.execute('commit')
log('tx rows', db.execute('select count(*) from tx').fetchone()[0])

OPEN = '"$to" = 0 and "$branch" = 0'
HEAD = re.compile(
  r'^CREATE TRIGGER (?P<name>"[^"]+"|\S+) (?P<time>after|before) '
  r'(?P<ev>insert|delete|update(?: of .+?)?) on (?P<tbl>"[^"]+"|\S+)'
  r'(?: when (?P<when>.+?))?\s+begin\s(?P<body>.*)$', re.I | re.S)

def guard(sql):
  m = HEAD.match(sql)
  if not m:
    raise ValueError(sql[:200])
  ev = m['ev'].lower()
  g = ('"new"."$to" = 0 and "new"."$branch" = 0' if ev == 'insert'
       else '"old"."$to" = 0 and "old"."$branch" = 0' if ev == 'delete'
       else '"new"."$to" = 0 and "old"."$to" = 0 and "new"."$branch" = 0')
  when = f'{g} and ({m["when"]})' if m['when'] else g
  out = [f'CREATE TRIGGER {m["name"]} {m["time"]} {m["ev"]} on {m["tbl"]} '
         f'when {when} begin {m["body"]}']
  if ev == 'delete':
    name = m['name'].strip('"') + '@close'
    close = '"old"."$to" = 0 and "new"."$to" <> 0 and "old"."$branch" = 0'
    when = f'{close} and ({m["when"]})' if m['when'] else close
    out.append(f'CREATE TRIGGER "{name}" after update of "$to" on {m["tbl"]} '
               f'when {when} begin {m["body"]}')
  return out

def partial(sql):
  if re.search(r'\swhere\s', sql, re.I):
    return re.sub(r'\swhere\s(.*)$', lambda m: f' where ({m[1]}) and {OPEN}',
                  sql, flags=re.I | re.S)
  return f'{sql} where {OPEN}'

ENTITY = re.compile(r'"?entity"?\s+integer\s+primary\s+key', re.I)
closed_total = 0
for t in versioned:
  sql = db.execute(
    "select sql from sqlite_master where type='table' and name=?", (t,)
  ).fetchone()[0]
  if not ENTITY.search(sql):
    log('skip (shape)', t)
    continue
  idx = [r[0] for r in db.execute(
    "select sql from sqlite_master where type='index' and tbl_name=? "
    "and sql is not null", (t,))]
  trg = [r[0] for r in db.execute(
    "select sql from sqlite_master where type='trigger' and tbl_name=?", (t,))]
  cols = [r[1] for r in db.execute(f'pragma table_info("{t}")')]
  body = ENTITY.sub('"entity" integer not null', sql, count=1)
  body = body[body.index('('):body.rindex(')')]
  new = (f'create table "{t}@new" {body}, "$branch" integer not null default 0,'
         f' "$from" integer, "$to" integer not null default 0,'
         f' primary key ("entity", "$branch", "$to")) without rowid')
  list_ = ', '.join(f'"{c}"' for c in cols)
  cs = ', '.join(f'c."{c}"' for c in cols)
  db.execute('begin')
  db.execute(new)
  db.execute(
    f'insert into "{t}@new" ({list_}, "$branch", "$from", "$to") '
    f'select {cs}, 0, (select max(j.tx) from journal_change j '
    f'where j.entity = c.entity and j.component = ? and j.operation = \'upsert\'), 0 '
    f'from "{t}" c', (t,))
  n = db.execute(
    f'insert into "{t}@new" ({list_}, "$branch", "$from", "$to") '
    f'select {cs}, 0, w.tx, w.nxt from (select entity, tx, '
    f'lead(tx) over (partition by entity order by tx) nxt from '
    f'(select entity, tx from journal_change where component = ? '
    f'and operation = \'upsert\' group by entity, tx)) w '
    f'join "{t}" c on c.entity = w.entity where w.nxt is not null', (t,)
  ).rowcount
  closed_total += max(n, 0)
  db.execute(f'drop table "{t}"')
  db.execute(f'alter table "{t}@new" rename to "{t}"')
  for s in idx:
    db.execute(partial(s))
  db.execute(f'create index "{t}@from" on "{t}" ("$from")')
  db.execute(f'create index "{t}@to" on "{t}" ("$to") where "$to" <> 0')
  for s in trg:
    for g in guard(s):
      db.execute(g)
  db.execute('insert into history_tables (name) values (?)', (t,))
  db.execute('commit')
  if n > 1000:
    log(t, 'closed versions', n)
log('closed versions in all', closed_total)
db.execute('pragma analysis_limit=1000')
for t in versioned:
  db.execute(f'analyze "{t}"')

log('done')
