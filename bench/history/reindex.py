# Every declared index of a versioned table becomes one index over all its
# versions, ending in ("$branch", "$to"), in place of the partial index over
# main's open rows: a current read seeks the same prefix and checks the two
# trailing columns in the index, and an as-of or branch read finds its versions
# through the same index.
import re, sqlite3, sys, time
path = sys.argv[1]
db = sqlite3.connect(path, isolation_level=None)
tables = {r[0] for r in db.execute('select name from history_tables')}
rows = db.execute(
  "select name, tbl_name, sql from sqlite_master where type='index' and sql is not null"
).fetchall()
t0 = time.time()
db.execute('begin')
n = 0
for name, t, sql in rows:
  if t not in tables or name.endswith('@from') or name.endswith('@to'):
    continue
  m = re.match(r'(?is)^(.*?\()(.*)\)(\s+where\s+(.*))?$', sql)
  head, cols, _, where = m.groups()
  where = (where or '')
  where = where.replace(' and "$to" = 0 and "$branch" = 0', '')
  where = where.replace('"$to" = 0 and "$branch" = 0', '').strip()
  if where.startswith('(') and where.endswith(')'):
    where = where[1:-1].strip()
  out = f'{head}{cols}, "$branch", "$to")' + (f' where {where}' if where else '')
  db.execute(f'drop index "{name}"')
  db.execute(out)
  n += 1
db.execute('commit')
print('indexes', n, 'seconds', round(time.time() - t0))
for (s,) in db.execute(
  "select sql from sqlite_master where tbl_name in ('entry','doc','task','app') "
  "and type='index' and sql is not null"):
  print(s)
