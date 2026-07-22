// embed.ts's pure seams against an in-memory db: what counts as stale,
// how neighbors rank, and the hash that names an embedding. The model
// itself never loads here — a test suite that downloads 30MB isn't one.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./db.ts')
let { hash, similar, stale, textOf } = await import('./embed.ts')
let { assertEquals } = await import('@std/assert')

let uid = (): string => crypto.randomUUID()
let doc = (eid: string, title: string, body = '') => {
  db.prepare(
    "insert into entity (eid, num, created_at, modified_at) values (?, ?, '', '')",
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
