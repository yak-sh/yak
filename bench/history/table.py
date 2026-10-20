# One row per measurement, one column per configuration: each run's median,
# both runs shown as "a / b".
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
kinds = ['journal', 'history', 'neither']
seen, cells = [], {}
for r in rows:
  m = r['m']
  if m not in seen:
    seen.append(m)
  v = r.get('median', r.get('ms'))
  if v is None:
    v = {k: x for k, x in r.items() if k not in ('kind', 'm')}
  cells.setdefault((m, r['kind']), []).append(v)
print('| measurement | ' + ' | '.join(kinds) + ' |')
print('|---|' + '---|' * len(kinds))
for m in seen:
  out = []
  for k in kinds:
    vs = cells.get((m, k), [])
    out.append(' / '.join(
      f'{v:g}' if isinstance(v, (int, float)) else json.dumps(v) for v in vs))
  print(f'| {m} | ' + ' | '.join(out) + ' |')
