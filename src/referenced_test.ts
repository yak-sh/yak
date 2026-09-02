// referenced.ts's seams: the pure citation parser (text → id tokens + page
// urls), the change builder's resolution rules (live rows only, the human-echo
// guard, per-entry idempotence), and the effect's skips (recall floaters,
// empty content). Module db like recall_test — referencedEntry closes over it.
Deno.env.set('DB_PATH', ':memory:')
let { apply, selectedDeps } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let {
  cites,
  historicalReferenced,
  referencedChanges,
  referencedEntry,
} = await import('./referenced.ts')
let { assertEquals } = await import('@std/assert')
import type { Change } from './types.ts'
import { sentences } from './edge.ts'

let uid = (): string => crypto.randomUUID()
let idOf = `(select id from entity where eid = ?)`

// One line per parse case: what the text cites, ids then urls.
let cited = (text: string, ids: string[], urls: string[] = []) => {
  let got = cites(text)
  assertEquals(got.ids, ids, text)
  assertEquals(got.urls, urls, text)
}

Deno.test('cites: id tokens, deduped in order', () => {
  cited('see T-3 and M-42, then T-3 again', ['T-3', 'M-42'])
  cited('nothing here', [])
  cited('ABC-123 T-3a UTF-8 t-9', []) // inside words, trailing letters, lowercase
  cited('(D-21262)', ['D-21262'])
})

Deno.test('cites: a graph entity link folds into ids', () => {
  cited('https://tasks.yak.sh/T-7', ['T-7'])
  cited('https://tasks.yak.sh/T-7?v=json', ['T-7'])
  cited('see https://tasks.yak.sh/M-42.', ['M-42']) // prose punctuation
  cited('https://tasks.yak.sh/search', [], ['https://tasks.yak.sh/search'])
})

Deno.test('cites: any other url normalizes to the canonical page spelling', () => {
  cited('https://example.com/a/?utm_source=x', [], ['https://example.com/a'])
  cited('read https://example.com/a, then reply', [], ['https://example.com/a'])
})

Deno.test('cites: an id-shaped path on a foreign host is not a citation', () => {
  cited('https://github.com/x/T-3', [], ['https://github.com/x/T-3'])
})

// Graph parts through apply() (the real writer mints the spine and num).
let task = (title: string) => {
  let e = uid()
  apply(db, [
    { eid: e, name: 'doc', comp: { title, body: '' } },
    { eid: e, name: 'task', comp: {} },
  ])
  let { num } = db.prepare('select num from entity where eid = ?').get(e) as {
    num: number
  }
  return { eid: e, id: `T-${num}` }
}
let page = (url: string) => {
  let e = uid()
  apply(db, [{ eid: e, name: 'web', comp: { url } }])
  return e
}
let sess = () => {
  let eid = uid()
  db.prepare('insert into entity (eid, num) values (?, ?)').run(
    eid,
    Math.floor(Math.random() * 1e9),
  )
  db.prepare(`insert into session (entity, id) values (${idOf}, ?)`).run(
    eid,
    uid(),
  )
  return eid
}
let entry = (session: string, text: string, comps: Change[] = []) => {
  let eid = uid()
  apply(db, [
    { eid, name: 'entry', comp: { session } },
    { eid, name: 'content', comp: { body: text } },
    ...comps.map((c) => ({ ...c, eid })),
  ])
  return eid
}
let children = (parent: string) =>
  (db.prepare(
    `select (select eid from entity where id = d.child) as child
       from (${sentences('referenced')}) d
      where d.parent = ${idOf}`,
  ).all(parent) as { child: string }[]).map((r) => r.child)

Deno.test('referencedChanges: a cited entity becomes an edge, once', () => {
  let t = task('the cited ticket')
  let e = entry(sess(), `working ${t.id} now`)
  let out = referencedChanges(db, e, `working ${t.id} now`)
  assertEquals(out, [
    { eid: e, name: 'dependency', comp: { type: 'referenced', child: t.eid } },
  ])
  apply(db, out)
  assertEquals(children(e), [t.eid])
  // idempotent: what the entry already wears is diffed away
  assertEquals(referencedChanges(db, e, `working ${t.id} now`), [])
})

Deno.test('selectedDeps projects entry endpoints to their session and dedupes', () => {
  let target = task('association target')
  let session = sess()
  let first = entry(session, target.id)
  let second = entry(session, target.id)
  apply(db, [
    ...referencedChanges(db, first, target.id),
    ...referencedChanges(db, second, target.id),
  ])
  let select = {
    type: 'referenced',
    via: { comp: 'entry', prop: 'session' },
  }
  let sentence = { parent: session, type: 'referenced', child: target.eid }
  assertEquals(selectedDeps(db, [session], select), [sentence])
  assertEquals(selectedDeps(db, [target.eid], select), [sentence])
})

Deno.test('referencedChanges: what does not resolve is skipped', () => {
  let e = entry(sess(), 'see T-999999999')
  assertEquals(referencedChanges(db, e, 'see T-999999999'), [])
})

Deno.test('referencedChanges: a wrong-prefix token fails the human echo', () => {
  let t = task('num-only door bait')
  let bait = `A-${t.id.slice(2)}` // same num, alien prefix
  let e = entry(sess(), bait)
  assertEquals(referencedChanges(db, e, bait), [])
})

Deno.test('referencedChanges: a cited page url lands on its page entity', () => {
  let p = page('https://example.com/spec')
  let e = entry(sess(), 'per https://example.com/spec?utm_source=mail, yes')
  let out = referencedChanges(
    db,
    e,
    'per https://example.com/spec?utm_source=mail, yes',
  )
  assertEquals(out.map((c) => c.comp?.child), [p])
})

Deno.test('referencedEntry: the effect mints and casts the edges', () => {
  let t = task('effect target')
  let e = entry(sess(), `landed ${t.id}`)
  let casts: Change[][] = []
  referencedEntry((c) => casts.push(c))(e)
  assertEquals(children(e), [t.eid])
  assertEquals(casts.length, 1)
})

Deno.test('referencedEntry: a recall floater is skipped — those are recalled, not referenced', () => {
  let t = task('floated, not cited')
  let s = sess()
  let src = entry(s, 'the message')
  let e = entry(s, `${t.id} · floated, not cited`, [
    { eid: '', name: 'recalled', comp: { source: src } },
  ])
  referencedEntry(() => {})(e)
  assertEquals(children(e), [])
})

Deno.test('referencedEntry: no content, no edges', () => {
  let e = uid()
  apply(db, [{ eid: e, name: 'entry', comp: { session: sess() } }])
  referencedEntry(() => {})(e)
  assertEquals(children(e), [])
})

Deno.test('historicalReferenced: the sweep finds what the effect would have', () => {
  let t = task('historical target')
  let e = entry(sess(), `once said ${t.id}`)
  let pending = historicalReferenced(db)
  let mine = pending.filter((c) => c.eid == e)
  assertEquals(mine.map((c) => c.comp?.child), [t.eid])
  apply(db, mine)
  // resumable: a rerun finds only what the last run missed — here, nothing
  assertEquals(historicalReferenced(db).filter((c) => c.eid == e), [])
})
