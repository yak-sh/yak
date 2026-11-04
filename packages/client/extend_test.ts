// Vocabulary growth through the client's public doors: existing state and
// watches stay open, while new local values are kept and new wire bytes decode.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { stringify } from '@yaks/vocab/wire'
import { client } from './client.ts'
import { stash } from './vault.ts'
import { pair } from '../sync/testing.ts'

let doc = {
  component: true,
  sync: 'none',
  properties: { title: { type: 'string' } },
}
let base = loadVocab({ $defs: { doc } })
let next = loadVocab({
  $defs: {
    doc,
    Note: {
      component: true,
      sync: 'none',
      properties: { text: { type: 'string' } },
    },
    payload: {
      component: true,
      properties: { data: { type: 'string', contentEncoding: 'base64' } },
    },
  },
})
let vault = stash()
let front = client(base, [], { vault, wireVault: false, provenance: false })
await front.ready
await front.mutate([{ entity: { eid: 'page' }, doc: { title: 'Soup' } }])
let old = front.watch('.entity.eid=page')
// A presence query is legal before the component exists; its network must
// compile against the declaration once one arrives.
let future = front.watch('.Note')

test('a client grows in place, keeps its watches and saves added local components', async () => {
  let graph = front.graph
  ok(front.extend(next))
  ok(front.graph === graph && front.vocab === graph.vocab)
  equal(old.value[0].doc, { title: 'Soup' })
  await front.mutate([{ entity: { eid: 'page' }, Note: { text: 'Less salt' } }])
  equal(old.value[0].Note, { text: 'Less salt' })
  equal(future.value[0].Note, { text: 'Less salt' })
  let watch = front.watch('.Note.text="Less salt"')
  equal(watch.value[0].doc, undefined)
  equal((await vault.load())[0].comps, {
    doc: { title: 'Soup' },
    Note: { text: 'Less salt' },
  })
  watch.close()
  front.close()
})

test('an incompatible vocabulary leaves client state and admission unchanged', () => {
  let c = client(base, [], {
    vault: false,
    wireVault: false,
    provenance: false,
  })
  let incompatible = loadVocab({
    $defs: { ...next.docs[0].$defs, doc: { ...doc, sync: 'server' } },
  })
  equal(c.extend(incompatible), false)
  ok(c.vocab === base)
  equal(c.vocab.comp('Note'), undefined)
  c.mutate([{ entity: { eid: 'page' }, doc: { title: 'Soup' } }])
  equal(c.ent('page')?.doc, { title: 'Soup' })
  c.close()
})

test('an open client socket decodes newly declared bytes and new mutations use their sync policy', async () => {
  let sockets = pair()
  let sent: unknown[] = []
  let c = client(base, [], {
    url: 'http://page.test',
    vault: false,
    wireVault: false,
    provenance: false,
    connect: () => sockets.client,
    timer: () => {},
    fetch: async (request) => {
      let rows = await request.json()
      sent.push(rows)
      return new Response(JSON.stringify(rows))
    },
  })
  ok(c.extend(next))
  let w = c.watch('.payload')
  sockets.client.emit('open')
  let data = new Uint8Array([0, 255, 128])
  sockets.server.send(
    stringify({
      id: 's1',
      reset: true,
      bundles: [{ entity: { eid: 'bytes' }, payload: { data } }],
    }),
  )
  await c.wire!.idle()
  equal(w.value[0]?.payload, { data })
  await c.mutate([{
    entity: { eid: 'bytes' },
    Note: { text: 'Local' },
    payload: { data },
  }])
  await c.wire!.idle()
  equal((sent[0] as Record<string, unknown>[])[0].Note, undefined)
  equal(c.ent('bytes')?.Note, { text: 'Local' })
  c.close()
})
