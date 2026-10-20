# Bytes the versioned tables take beside the same tables unversioned, and the
# journal's bytes, from dbstat, per row and per change.
import sqlite3, sys
base, b = sys.argv[1], sys.argv[2]
db = sqlite3.connect(f'file:{b}?mode=ro', uri=True)
db.execute(f"attach 'file:{base}?mode=ro' as base")
tables = [r[0] for r in db.execute('select name from main.history_tables')]
def size(schema, names):
  q = ','.join('?' * len(names))
  return db.execute(
    f"select coalesce(sum(pgsize),0) from dbstat(?, 1) where name in ({q})",
    (schema, *names)).fetchone()[0]
def objects(schema, ts, extra=''):
  q = ','.join('?' * len(ts))
  return [r[0] for r in db.execute(
    f"select name from {schema}.sqlite_master where tbl_name in ({q}) "
    f"and type in ('table','index') {extra}", ts)]
vb = size('main', objects('main', tables))
va = size('base', objects('base', tables))
rows_b = sum(db.execute(f'select count(*) from main."{t}"').fetchone()[0] for t in tables)
open_b = sum(db.execute(f'select count(*) from main."{t}" where "$to" = 0').fetchone()[0] for t in tables)
rows_a = sum(db.execute(f'select count(*) from base."{t}"').fetchone()[0] for t in tables)
hist = size('main', objects('main', tables, "and (name like '%@from' or name like '%@to')"))
tx = size('main', ['tx', 'tx_by', 'tx_via'])
ntx = db.execute('select count(*) from main.tx').fetchone()[0]
jt = size('base', ['journal_tx', 'journal_tx_actor', 'journal_tx_via'])
jc = size('base', ['journal_change', 'journal_change_tx', 'journal_change_ent', 'journal_change_comp'])
jf = size('base', ['journal_field', 'journal_field_change', 'journal_field_ref'])
nchg = db.execute('select count(*) from base.journal_change').fetchone()[0]
closed = rows_b - open_b
print(f'versioned tables: {len(tables)}')
print(f'unversioned bytes {va}  rows {rows_a}  bytes/row {va/rows_a:.0f}')
print(f'versioned bytes {vb}  rows {rows_b} (open {open_b}, closed {closed})')
print(f'  of which $from/$to indexes {hist}')
print(f'  bytes per closed version {(vb-va)/closed:.0f}  without the $from/$to indexes {(vb-va-hist)/closed:.0f}')
print(f'tx bytes {tx} rows {ntx} bytes/tx {tx/ntx:.0f}')
print(f'journal bytes tx {jt} change {jc} field {jf} total {jt+jc+jf}')
print(f'journal changes {nchg}  bytes/change {(jt+jc+jf)/nchg:.0f}  (change+field only {(jc+jf)/nchg:.0f})')
