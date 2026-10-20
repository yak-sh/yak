# A trimmed, consistent copy of the live graph: every table's schema, every
# row of every table except a denylist of bulky transcript tables, all in one
# read snapshot of the live file (opened read-only). Indexes, triggers and
# views are created after the rows, as the live schema states them.
import sqlite3, sys, time, os

live, out = sys.argv[1], sys.argv[2]
DENY = {
  'entry', 'embedding', 'gitobj', 'blob', 'call', 'result', 'execution',
  'imported', 'ask', 'output', 'attempt', 'openai', 'cost', 'exit',
  'artifact', 'usage', 'delivered', 'refusal', 'sending', 'stop',
  'tool_progress', 'tool_async', 'recalled', 'content',
}
FTS = {'doc_fts': True, 'decision_fts': True, 'entry_fts': False}
if os.path.exists(out):
  os.remove(out)
db = sqlite3.connect(out, isolation_level=None)
db.execute('pragma page_size=4096')
db.execute('pragma journal_mode=off')
db.execute('pragma synchronous=off')
db.execute('pragma foreign_keys=off')
db.execute(f"attach 'file:{live}?mode=ro' as live")
db.execute('begin')
objs = db.execute(
  "select type, name, tbl_name, sql from live.sqlite_master order by rowid"
).fetchall()
shadow = lambda n: any(n.startswith(f + '_') for f in FTS)
t0 = time.time()
for typ, name, tbl, sql in objs:
  if typ != 'table' or name.startswith('sqlite_') or shadow(name):
    continue
  db.execute(sql)
  if name in FTS:
    if FTS[name]:
      for s in ('data', 'idx', 'docsize', 'config'):
        db.execute(f'delete from "{name}_{s}"')
        db.execute(f'insert into "{name}_{s}" select * from live."{name}_{s}"')
    continue
  if name in DENY:
    continue
  if name == 'blob_text':
    db.execute(
      'insert into blob_text select * from live.blob_text where sha in '
      '(select body from live.doc)'
    )
    continue
  db.execute(f'insert into "{name}" select * from live."{name}"')
  print(f'{time.time()-t0:7.1f}s {name}', file=sys.stderr, flush=True)
for typ, name, tbl, sql in objs:
  if typ == 'index' and sql and not shadow(tbl):
    db.execute(sql)
    print(f'{time.time()-t0:7.1f}s index {name}', file=sys.stderr, flush=True)
db.execute('analyze sqlite_schema')
db.execute('delete from sqlite_stat1')
db.execute('insert into sqlite_stat1 select * from live.sqlite_stat1')
for typ, name, tbl, sql in objs:
  if typ in ('view', 'trigger') and sql:
    db.execute(sql)
db.execute('commit')
db.execute('detach live')
db.execute('pragma journal_mode=wal')
print(f'done {time.time()-t0:.1f}s', file=sys.stderr)
