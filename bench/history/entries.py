# Bring the live graph's entry rows into the trimmed copy (the trim left them
# out), with the entry triggers set aside while the rows land.
import sqlite3, sys, time
live, out = sys.argv[1], sys.argv[2]
db = sqlite3.connect(out, isolation_level=None)
db.execute('pragma foreign_keys=off')
db.execute(f"attach 'file:{live}?mode=ro' as live")
t0 = time.time()
db.execute('begin')
trig = db.execute(
  "select name, sql from main.sqlite_master where type='trigger' and tbl_name='entry'"
).fetchall()
for name, _ in trig:
  db.execute(f'drop trigger "{name}"')
db.execute(
  'insert into main.entry select * from live.entry '
  'where entity <= (select max(id) from main.entity) '
  'and session <= (select max(id) from main.entity)'
)
for _, sql in trig:
  db.execute(sql)
db.execute('commit')
print(db.execute('select count(*) from main.entry').fetchone(), f'{time.time()-t0:.1f}s')
