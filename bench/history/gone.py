# How much of the journal's history on the versioned tables the backfill could
# not carry: upserts (per entity and transaction) of rows no longer present,
# whose versions history would have kept as closed rows.
import sqlite3, sys, time
base, b = sys.argv[1], sys.argv[2]
db = sqlite3.connect(f'file:{b}?mode=ro', uri=True)
db.execute(f"attach 'file:{base}?mode=ro' as a")
t0 = time.time()
gone = kept = 0
for (t,) in db.execute('select name from main.history_tables').fetchall():
  g, k = db.execute(
    f'select coalesce(sum(n is null), 0), coalesce(sum(n is not null), 0) from '
    f'(select (select 1 from main."{t}" c where c.entity = w.entity limit 1) n '
    f'from (select entity, tx from a.journal_change where component = ? '
    f"and operation = 'upsert' group by entity, tx) w)", (t,)).fetchone()
  gone += g
  kept += k
print(f'versions of rows still present {kept}, of rows gone {gone}, '
      f'seconds {time.time() - t0:.0f}')
