// embed.ts's pure seams against an in-memory db: what counts as stale,
// how neighbors rank, and the hash that names an embedding. The model
// itself never loads here — a test suite that downloads 30MB isn't one.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./db.ts')
let { hash, prune, similar, similarTo, stale, stored, textOf } = await import(
  './embed.ts'
)
let { assertEquals } = await import('@std/assert')

let uid = (): string => crypto.randomUUID()
let doc = (eid: string, title: string, body = '') => {
  db.prepare(
    'insert into entity (eid, num) values (?, ?)',
  ).run(eid, Math.floor(Math.random() * 1e9))
  db.prepare('insert into doc (eid, title, body) values (?, ?, ?)').run(
    eid,
    title,
    body,
  )
}
let vec = (...xs: number[]) => {
  let n = Math.hypot(...xs)
  return Float32Array.from(xs.map((x) => x / n))
}
let put = (eid: string, text: string, v: Float32Array) =>
  db.prepare(
    'insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)',
  ).run(eid, 'Xenova/bge-small-en-v1.5', hash(text), new Uint8Array(v.buffer))
let task = (eid: string) =>
  db.prepare('insert into task (eid, status, priority) values (?, ?, ?)').run(
    eid,
    'open',
    0,
  )
let mail = (eid: string, target: string | null) =>
  db.prepare('insert into mail (eid, "to", target_eid) values (?, ?, ?)').run(
    eid,
    'someone@example.com',
    target,
  )

Deno.test('hash: stable for same text, moved by any edit', () => {
  assertEquals(hash('a title\nbody'), hash('a title\nbody'))
  assertEquals(hash('a title\nbody') == hash('a title\nbody.'), false)
})

Deno.test('textOf: title+body, trimmed, cut at the model horizon', () => {
  assertEquals(textOf('T', 'b'), 'T\nb')
  assertEquals(textOf('T', null), 'T')
  assertEquals(textOf('', ''), '')
  assertEquals(textOf('x', 'y'.repeat(9000)).length, 2000)
})

Deno.test('stale: unembedded and text-moved docs owe; fresh do not', () => {
  let [a, b, c] = [uid(), uid(), uid()]
  doc(a, 'never embedded')
  doc(b, 'embedded and unchanged')
  doc(c, 'embedded then edited')
  put(b, textOf('embedded and unchanged', ''), vec(1, 0))
  put(c, textOf('an older text', ''), vec(0, 1))
  let owed = stale(db).map((r) => r.eid)
  assertEquals(owed.includes(a), true)
  assertEquals(owed.includes(b), false)
  assertEquals(owed.includes(c), true)
})

Deno.test('stale: comments and empty docs never owe', () => {
  let [c, e] = [uid(), uid()]
  doc(c, 'a comment body')
  db.prepare('insert into comment (eid, target_eid) values (?, ?)').run(c, c)
  doc(e, '', '')
  let owed = stale(db).map((r) => r.eid)
  assertEquals(owed.includes(c), false)
  assertEquals(owed.includes(e), false)
})

// Pruning used to ask only whether a doc row existed, while stale() asked
// three things — so a doc that was emptied, or that gained a comment, kept
// a vector the sweep would never refresh again.
Deno.test('prune: every route out of eligibility takes its vector along', () => {
  let [live, emptied, spoke, dead] = [uid(), uid(), uid(), uid()]
  doc(live, 'still a doc with text')
  doc(emptied, 'about to be emptied')
  doc(spoke, 'about to become a comment')
  doc(dead, 'about to be deleted')
  for (
    let [eid, text] of [
      [live, 'still a doc with text'],
      [emptied, 'about to be emptied'],
      [spoke, 'about to become a comment'],
      [dead, 'about to be deleted'],
    ]
  ) put(eid, text, vec(1, 0))

  db.prepare("update doc set title = '', body = '' where eid = ?").run(emptied)
  db.prepare('insert into comment (eid, target_eid) values (?, ?)').run(
    spoke,
    spoke,
  )
  db.prepare('delete from doc where eid = ?').run(dead)

  prune(db)
  let held = (eid: string) =>
    !!db.prepare('select eid from embedding where eid = ?').get(eid)
  assertEquals([held(live), held(emptied), held(spoke), held(dead)], [
    true,
    false,
    false,
    false,
  ])
})

// A vector outlives its entity until the next sweep. The web's Similar
// section screens hits through the live cache; the dupe hint cannot, so it
// saw bare UUIDs for entities that were already gone.
Deno.test('similar: an ineligible row never answers, swept or not', () => {
  let [alive, gone] = [uid(), uid()]
  doc(alive, 'a living neighbour')
  doc(gone, 'a doomed neighbour')
  put(alive, 'a living neighbour', vec(1, 0))
  put(gone, 'a doomed neighbour', vec(1, 0))
  db.prepare('delete from doc where eid = ?').run(gone)

  let hits = similar(db, vec(1, 0), 99, 0.5).map((h) => h.eid)
  assertEquals([hits.includes(alive), hits.includes(gone)], [true, false])
})

Deno.test('similar: mail speaks for the task it is about', () => {
  let [target, first, second, loose] = [uid(), uid(), uid(), uid()]
  doc(target, 'a terse task')
  task(target)
  for (let letter of [first, second]) {
    doc(letter, 'a verbose account of the matching problem')
    mail(letter, target)
  }
  doc(loose, 'untargeted mail stays mail')
  mail(loose, null)
  put(first, 'a verbose account of the matching problem', vec(1, 0))
  put(second, 'a verbose account of the matching problem', vec(3, 1))
  put(loose, 'untargeted mail stays mail', vec(1, 1))

  let ours = similar(db, vec(1, 0), 99, 0.5)
    .filter((h) => [target, first, second, loose].includes(h.eid))
  assertEquals(ours.map((h) => h.eid), [target, loose])
  assertEquals(ours[0].score, 1)
})

Deno.test('stored: exact text reuses a doc vector; edits and misses do not', () => {
  let eid = uid()
  let text = 'already embedded'
  doc(eid, text)
  put(eid, text, vec(3, 4))
  assertEquals([...stored(db, eid, text)!], [...vec(3, 4)])
  assertEquals(stored(db, eid, 'edited'), null)
  assertEquals(stored(db, uid(), text), null)
  db.prepare("update embedding set model = 'older' where eid = ?").run(eid)
  assertEquals(stored(db, eid, text), null)
})

Deno.test('similarTo: a matching doc row needs no embedder', async () => {
  let eid = uid()
  let text = 'stored query'
  doc(eid, text)
  put(eid, text, vec(1, 0))
  let hits = await similarTo(db, text, 99, 0, eid)
  assertEquals(hits?.some((h) => h.eid == eid), true)
})

Deno.test('similar: dot-ranked, floored, limited', () => {
  let [x, y, z] = [uid(), uid(), uid()]
  doc(x, 'east')
  doc(y, 'northeast')
  doc(z, 'north')
  put(x, 'east', vec(1, 0))
  put(y, 'northeast', vec(1, 1))
  put(z, 'north', vec(0, 1))
  let hits = similar(db, vec(1, 0), 8, 0.5)
  assertEquals(
    hits.filter((h) => [x, y, z].includes(h.eid)).map((h) => h.eid),
    [
      x,
      y,
    ],
  ) // z scores 0 — floored out; x (1.0) outranks y (~0.71)
  // the shared :memory: db holds other tests' vectors — screen to ours
  let top = similar(db, vec(1, 0), 99, 0)
    .filter((h) => [x, y, z].includes(h.eid))
  assertEquals(top[0].eid, x)
})
