// T-164370: prose already in the graph holds the eids its ids name, as a write
// stores it since T-164369 (Graph.prose). Run over a config whose `db` is the
// store to move:
//
//   deno run -A bin/prose-eids.ts <yak.json> [--dry] [--sample 50]
//
// Reads every doc.body, and content.body on topics, swaps each id the store is
// sure of for its eid, and writes the changed texts back unstamped, guarded by
// $was so a concurrent edit stays. Prints the counts as JSON. A second run
// changes nothing.
import { compose, facet } from '@yaks/cli/host'
import { type Bundle, signed } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { human, parse, prefixes } from '@yaks/id'
import { read } from '../packages/cli/config.ts'
import { typed } from '../packages/markdown/structural.ts'

let [path, ...flags] = Deno.args
if (!path) throw new Error('config path required')
let dry = flags.includes('--dry')
let flag = (name: string, or: number) =>
  flags.includes(name) ? Number(flags[flags.indexOf(name) + 1]) : or
let sample = flag('--sample', 50)
let batch = flag('--batch', 50)
let most = flag('--max', Infinity)
let actor = {
  by: '4431cca9-5405-49e9-960b-1722db3ec41b',
  via: 'adff6a66-8c06-4d6e-8190-8cb4d5dfc89f',
}

let t0 = Date.now()
let log = (m: string) =>
  console.error(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m}`)
let host = await compose(read(path), ['graph'], facet, { process: false })
let g = host.graph
let vocab = g.vocab
let id = human(vocab)
let declared = prefixes(vocab)
// A row the move (T-164366) has not given a prefix printed, until T-164363,
// with each undeclared kind's initial (R for a review, E for an effect), and
// the ids it gave out then say so.
let kinds = new Set(vocab.all.filter((c) => vocab.kindOf({ [c]: {} }) == c))
let initial = (c: string) => (c.match(/[a-z]/i)?.[0] ?? '').toUpperCase()
let letters = (b: Bundle) =>
  new Set([
    id(b).split('-')[0],
    ...Object.keys(b).flatMap((c) => declared[c] ?? []),
  ])
let initials = (b: Bundle) =>
  (b.entity as { prefix?: string }).prefix
    ? []
    : Object.keys(b).filter((c) => kinds.has(c) && !declared[c]).map(initial)

type Said = { eid: string; comp: string; prop: string; text: string }
let said: Said[] = []
let LARGE = 1_000_000
let large: { eid: string; bytes: number }[] = []
// Paged in the order things were made: one unbounded read of every body sat
// for over half an hour, a page of 5,000 takes seconds.
for (let comp of ['doc', 'content'] as const) {
  let q = comp == 'doc' ? '.doc' : '.topic'
  let last = ''
  let seen = 0
  for (;;) {
    let page = await g.rows(
      `${q} .order=created.at${last ? ` .after=${last}` : ''} .limit=5000 ` +
        `.fields=${comp}.body`,
    )
    seen += page.length
    for (let r of page) {
      let text = r[`${comp}.body`]
      if (typeof text != 'string') continue
      // Marked takes minutes over a body of megabytes (the JSON dumps of
      // evaluation runs): those are listed, not swapped.
      if (text.length > LARGE) {
        if (/[A-Z]-\d|#[0-9a-fA-F]{10}/.test(text)) {
          large.push({ eid: String(r.eid), bytes: text.length })
        }
        continue
      }
      if (typed(text).length) {
        said.push({ eid: String(r.eid), comp, prop: 'body', text })
      }
    }
    log(`${q} page: ${seen} rows`)
    if (page.length < 5000) break
    last = String(page.at(-1)!.eid)
  }
  let all = (await g.read(`${q} .count`)) as unknown
  log(
    `read ${q}: ${seen} rows (count ${
      JSON.stringify(all)
    }), ${said.length} with ids`,
  )
}

// What an entity's id and letters are read from: the components that name a
// kind or declare a prefix, never its whole bundle.
let naming = [
  ...new Set([
    ...vocab.all.filter((c) => vocab.kindOf({ [c]: {} }) == c),
    ...Object.keys(declared),
    'tombstone',
  ]),
]
let rows = new Map<string, Bundle>()
let whole = async (eids: string[]) => {
  let want = [...new Set(eids)].filter((e) => !rows.has(e))
  for (let i = 0; i < want.length; i += 500) {
    for (let b of await g.get(want.slice(i, i + 500), naming)) {
      rows.set(b.entity.eid, b)
    }
  }
}

let changed: (Said & { to: string })[] = []
let elsewhere: {
  old: boolean
  id: string
  is: string
  in: string
  around: string
}[] = []
let around = (text: string, word: string) => {
  let at = text.indexOf(word)
  return text.slice(Math.max(0, at - 40), at + word.length + 40)
    .replace(/\s+/g, ' ')
}
for (let i = 0; i < said.length; i += 500) {
  let batch = said.slice(i, i + 500)
  let texts = await g.prose(batch.map((s) => s.text))
  let ids = [...new Set(batch.flatMap((s) => typed(s.text)))]
  let at = await g.named(ids)
  await whole([...at.values()])
  for (let [n, s] of batch.entries()) {
    if (texts[n] != s.text) changed.push({ ...s, to: texts[n] })
    for (let word of typed(s.text)) {
      let letter = parse(word)?.prefix
      let b = rows.get(at.get(word) ?? '')
      if (letter && b && !b.tombstone && !letters(b).has(letter)) {
        elsewhere.push({
          old: initials(b).includes(letter),
          id: word,
          is: id(b),
          in: s.eid,
          around: around(s.text, word),
        })
      }
    }
  }
  if (i % 5000 == 0) log(`swapped ${i + batch.length}/${said.length}`)
}

await whole(changed.map((c) => c.eid))
let count = <T>(xs: T[], key: (x: T) => string) => {
  let n = new Map<string, number>()
  for (let x of xs) n.set(key(x), (n.get(key(x)) ?? 0) + 1)
  return Object.fromEntries([...n].sort(([, a], [, b]) => b - a))
}
let kind = (eid: string) => {
  let b = rows.get(eid)
  return b ? vocab.kindOf(b) ?? '?' : '?'
}
let swapped = changed.flatMap((c) => {
  let kept = new Set(typed(c.to))
  return typed(c.text).filter((w) => !kept.has(w)).map((w) => ({ ...c, w }))
})
// An eid swapped in where it is glued to a word (`/tmp/<eid>-proof`) is an
// id swapped where it was not read; none should be.
let GLUED =
  /[\w/-][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[\w-]/g
let glued = changed.filter((c) =>
  (c.to.match(GLUED)?.length ?? 0) > (c.text.match(GLUED)?.length ?? 0)
).map((c) => c.eid)
let pick = <T>(xs: T[], n: number) =>
  [...xs].sort(() => Math.random() - 0.5).slice(0, n)

let written = 0
if (!dry) {
  for (let i = 0; i < Math.min(changed.length, most); i += batch) {
    let t = Date.now()
    let bundles = changed.slice(i, i + batch).map((c) => ({
      entity: { eid: c.eid },
      $was: { [c.comp]: { [c.prop]: token(c.text) } },
      [c.comp]: { [c.prop]: c.to },
    }))
    await g.apply(signed(bundles as Bundle[], actor), {
      trusted: true,
      stamp: false,
    })
    written += bundles.length
    log(`written ${written}/${changed.length} in ${Date.now() - t} ms`)
  }
}
await host.close()

console.log(JSON.stringify(
  {
    read: said.length,
    rows: changed.length,
    written,
    ids: swapped.length,
    rowsByKind: count(changed, (c) => kind(c.eid)),
    idsByLetter: count(swapped, (s) => parse(s.w)?.prefix || '#'),
    large,
    glued,
    elsewhere: elsewhere.length,
    elsewhereByInitial: elsewhere.filter((e) => e.old).length,
    elsewhereByLetter: count(
      elsewhere,
      (e) => `${parse(e.id)?.prefix}->${e.is.split('-')[0]}`,
    ),
    elsewhereSample: pick(elsewhere, 25),
    sample: pick(swapped, sample).map((s) => ({
      id: s.w,
      in: s.eid,
      around: around(s.text, s.w),
    })),
  },
  null,
  1,
))
