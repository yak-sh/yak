// T-164370 repair: ids the pass's writes swapped after the series move
// (T-164366) renumbered the small sets, so that an id that named nothing when
// it was written now names a renumbered entity. Each eid standing where the
// rehearsed copy (resolved before the move) kept a typed id is put back as
// typed. Other edits since the copy stay. Written by a graph that composes no
// @yaks/markdown, so the write stores the text as given.
//
//   deno run -A bin/prose-unswap.ts <repair yak.json> <differ.json> [--write]
import { compose, facet } from '@yaks/cli/host'
import { type Bundle, signed } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { read } from '../packages/cli/config.ts'

let [path, differ, flag] = Deno.args
let write = flag == '--write'
let rows = JSON.parse(Deno.readTextFileSync(differ)) as {
  eid: string
  live: string
  copy: string
}[]
let text = (db: string, sha: string) => {
  let out = new Deno.Command('sqlite3', {
    args: [
      '-readonly',
      '-json',
      db,
      `select value from blob_text where sha='${sha}'`,
    ],
  }).outputSync()
  return (JSON.parse(new TextDecoder().decode(out.stdout) || '[{}]')[0]
    ?.value ??
    '') as string
}
let UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
let SPLIT = new RegExp(`(${UUID}|[A-Z]-\\d+)`)
let EID = new RegExp(`^${UUID}$`)
let TYPED = /^[A-Z]-\d+$/

// The live tokens, each eid that aligns with a typed id in the copy put back.
let unswapped = (copy: string, live: string) => {
  let a = copy.split(SPLIT), b = live.split(SPLIT)
  let n = a.length, m = b.length
  let L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] == b[j]
        ? L[i + 1][j + 1] + 1
        : Math.max(L[i + 1][j], L[i][j + 1])
    }
  }
  let out: string[] = [], back: [string, string][] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] == b[j]) {
      out.push(b[j]), i++, j++
    } else if (
      i < n && j < m && TYPED.test(a[i]) && EID.test(b[j]) &&
      a[i + 1] == b[j + 1]
    ) {
      out.push(a[i]), back.push([a[i], b[j]]), i++, j++
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      out.push(b[j]), j++
    } else i++
  }
  return { text: out.join(''), back }
}

let home = Deno.env.get('HOME')
let fixes: {
  eid: string
  was: string
  to: string
  back: [string, string][]
}[] = []
for (let r of rows) {
  let copy = text('.scratch/copy.db', r.copy),
    live = text(`${home}/.yak/yak.db`, r.live)
  let { text: to, back } = unswapped(copy, live)
  if (back.length) fixes.push({ eid: r.eid, was: live, to, back })
}

let host = await compose(read(path), ['graph'], facet, { process: false })
let g = host.graph
if (g.plugins.some((p) => p.prose)) {
  throw new Error('the repair graph swaps prose')
}
let eids = await g.get(fixes.map((f) => f.eid), ['doc', 'tombstone'])
let names = new Map<string, string>()
for (let f of fixes) {
  for (let [, eid] of f.back) names.set(eid, '')
}
for (
  let b of await g.get([...names.keys()], [
    'doc',
    'project',
    'board',
    'persona',
    'goal',
    'design',
  ])
) {
  names.set(b.entity.eid, (b.doc as { title?: string })?.title ?? '')
}
if (write) {
  let bundles = fixes.map((f) => ({
    entity: { eid: f.eid },
    $was: { doc: { body: token(f.was) } },
    doc: { body: f.to },
  }))
  await g.apply(
    signed(bundles as Bundle[], {
      by: '4431cca9-5405-49e9-960b-1722db3ec41b',
      via: 'adff6a66-8c06-4d6e-8190-8cb4d5dfc89f',
    }),
    { trusted: true, stamp: false },
  )
}
let after = write ? await g.get(fixes.map((f) => f.eid), ['doc']) : eids
await host.close()
console.log(JSON.stringify(
  {
    rows: rows.length,
    fixed: fixes.length,
    ids: fixes.reduce((n, f) => n + f.back.length, 0),
    written: write ? fixes.length : 0,
    stored: write
      ? after.filter((b, i) =>
        (b.doc as { body?: string })?.body ==
          fixes.find((f) => f.eid == b.entity.eid)?.to
      ).length
      : 0,
    back: fixes.flatMap((f) =>
      f.back.map(([id, eid]) =>
        `${f.eid.slice(0, 8)} ${id} <- ${names.get(eid)}`
      )
    ),
  },
  null,
  1,
))
