// The effect registry against a :memory: graph: created vs changed
// (column-scoped) vs removed, told apart by the Trace apply() fills in;
// handler isolation (a throw reaches oops and the rest still fire, the
// dispatch promise always resolves). db.ts comes in dynamically, AFTER
// the env points it at :memory:.
import { assert, assertEquals } from '@std/assert'
import { type Change } from './types.ts'
import { dispatch, docs, on, relay, trace } from './effects.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, db } = await import('./db.ts')

let uid = () => crypto.randomUUID()

// Apply and dispatch in one breath — what every server door does.
let write = (changes: Change[]) => {
  let t = trace()
  return { done: dispatch(apply(db, changes, t), t), t }
}

let seen: string[] = []
on('web', {
  created: (eid) => seen.push(`created ${eid}`),
  changed: {
    url: (eid) => seen.push(`url ${eid}`),
    frozen_at: (eid) => seen.push(`frozen ${eid}`),
  },
  removed: (eid) => seen.push(`removed ${eid}`),
})
on('alias', {
  created: () => {
    throw new Error('boom')
  },
})
on('alias', { created: () => seen.push('alias survived') })

Deno.test('created fires on birth, changed on patches, by column', async () => {
  seen = []
  let eid = uid()
  await write([{ eid, name: 'web', comp: { url: 'http://a' } }]).done
  assertEquals(seen, [`created ${eid}`]) // a birth is not a change
  await write([{ eid, name: 'web', comp: { url: 'http://b' } }]).done
  assertEquals(seen.at(-1), `url ${eid}`)
  // a patch not carrying the scoped column fires nothing
  seen = []
  await write([{ eid, name: 'doc', comp: { title: 'x' } }]).done
  assertEquals(seen, [])
})

Deno.test('removed fires for a comp delete and for an entity death', async () => {
  seen = []
  let solo = uid()
  await write([{ eid: solo, name: 'web', comp: { url: 'http://c' } }]).done
  await write([{ eid: solo, name: 'web', comp: null }]).done
  assertEquals(seen.at(-1), `removed ${solo}`)
  // deleting a comp that never existed says nothing
  seen = []
  await write([{ eid: uid(), name: 'web', comp: null }]).done
  assertEquals(seen, [])
  // an entity death removes every comp row it carried
  let whole = uid()
  await write([{ eid: whole, name: 'web', comp: { url: 'http://d' } }]).done
  seen = []
  await write([{ eid: whole, name: 'entity', comp: null }]).done
  assertEquals(seen, [`removed ${whole}`])
})

Deno.test('an edge fires dependency handlers, spoken or unsaid', async () => {
  let heard: unknown[] = []
  on('dependency', { created: (eid, comp) => heard.push([eid, comp]) })
  let a = uid(), b = uid()
  await write([
    { eid: a, name: 'doc', comp: { title: 'a' } },
    { eid: b, name: 'doc', comp: { title: 'b' } },
  ]).done
  heard = []
  let comp = { type: 'reads', child_eid: b }
  await write([{ eid: a, name: 'dependency', comp }]).done
  assertEquals(heard, [[a, comp]])
  // unlinking is the same sentence with gone — the handler hears it too
  let gone = { ...comp, gone: true }
  await write([{ eid: a, name: 'dependency', comp: gone }]).done
  assertEquals(heard.at(-1), [a, gone])
})

Deno.test('a throwing handler reaches oops; the rest still fire', async () => {
  seen = []
  let oops: string[] = []
  let t = trace()
  let out = apply(db, [{ eid: uid(), name: 'alias', comp: { slug: uid() } }], t)
  await dispatch(out, t, (comp, e) => oops.push(`${comp}: ${e}`))
  assertEquals(seen, ['alias survived'])
  assertEquals(oops.length, 1)
  assert(oops[0].includes('boom'))
})

Deno.test('async handler results ride the dispatch promise', async () => {
  let landed = false
  on('doc', {
    created: async () => {
      await new Promise((go) => setTimeout(go, 10))
      landed = true
    },
  })
  await write([{ eid: uid(), name: 'doc', comp: { title: 'later' } }]).done
  assert(landed)
})

Deno.test('relay: pending rows re-fire created; sweepless effects sit out', async () => {
  let fired: string[] = []
  on('fold', {
    created: (eid) => fired.push(`fold ${eid}`),
    sweep: { pending: 'acked is null' },
  })
  on('shelf', { created: (eid) => fired.push(`shelf ${eid}`) }) // no sweep
  let asked: string[] = []
  let out = await relay((comp, pending) => {
    asked.push(`${comp} where ${pending}`)
    return comp == 'fold' ? [{ eid: 'f-1' }, { eid: 'f-2' }] : []
  })
  assertEquals(fired, ['fold f-1', 'fold f-2'])
  assertEquals(asked, ['fold where acked is null']) // one fetch per sweep
  assertEquals(out.length, 2)
})

Deno.test('relay: a throwing handler is reported, the rest still fire', async () => {
  let fired: string[] = []
  on('camera', {
    created: (eid) => {
      if (eid == 'bad') throw new Error('boom')
      fired.push(eid)
    },
    sweep: { pending: 'x is null' },
  })
  let oops: string[] = []
  await relay(
    (comp) => (comp == 'camera' ? [{ eid: 'bad' }, { eid: 'good' }] : []),
    (comp, e) => oops.push(`${comp}: ${e}`),
  )
  assertEquals(fired, ['good'])
  assertEquals(oops.length, 1)
  assert(oops[0].includes('boom'))
})

Deno.test('docs: the registry read back — hooks, sweep, one-liner', () => {
  on('memory', {
    created: () => {},
    changed: { type: () => {} },
    sweep: { pending: 'last_confirmed_at is null' },
    doc: 'a made-up lever, for the doc',
  })
  let d = docs().find((x) => x.comp == 'memory')!
  assertEquals(d.hooks, ['created', 'changed(type)'])
  assertEquals(d.sweep, 'last_confirmed_at is null')
  assertEquals(d.doc, 'a made-up lever, for the doc')
  // an undocumented registration still appears — hiding is not an option
  assertEquals(docs().find((x) => x.comp == 'web')?.doc, undefined)
})
