/// <reference lib="deno.ns" />
// The graph's byte contract through its ordinary admission, store and read doors.
import { equal, test, throws } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import { admitSchema } from './admit_schema.ts'
import { coalesced, composed } from './bundle.ts'
import { token } from './guard.ts'
import { Stale } from './errors.ts'
import { proseOf, schemaOf } from './schema.ts'

let vocab = loadVocab({
  $defs: {
    document: {
      component: true,
      type: 'object',
      properties: {
        bytes: { type: 'string', contentEncoding: 'base64', validate: true },
        title: { type: 'string' },
      },
    },
  },
})
let make = () =>
  graph({ vocab, storage: ram(vocab), plugins: [admitSchema(vocab)] })
let data = new Uint8Array([27, 0, 255, 128, 27]).subarray(1, 4)
let stored = make()
let applied = stored.apply([{
  entity: { eid: 'doc' },
  document: { bytes: data, title: 'first' },
}])

test('bytes write and read unchanged through graph schema admission and ram', async () => {
  equal((await applied)[0].document, { bytes: data, title: 'first' })
  equal((await stored.get(['doc']))[0].document, {
    bytes: data,
    title: 'first',
  })
  equal((await stored.read('.document.bytes=AP+A'))[0].document, {
    bytes: data,
    title: 'first',
  })
  equal(
    (await stored.rows('.document .fields=document.bytes'))[0][
      'document.bytes'
    ],
    data,
  )
})

let guarded = make()
await guarded.apply([{ entity: { eid: 'doc' }, document: { bytes: data } }])
test('$was on bytes compares content, not array identity or backing buffer', async () => {
  await guarded.apply([{
    entity: { eid: 'doc' },
    $was: { document: { bytes: token(new Uint8Array([0, 255, 128])) } },
    document: { bytes: new Uint8Array() },
  }])
  equal((await guarded.get(['doc']))[0].document, { bytes: new Uint8Array() })
})
let stale = make()
await stale.apply([{ entity: { eid: 'doc' }, document: { bytes: data } }])
test('a changed byte refuses the entire guarded batch', async () => {
  let error = await throws(() =>
    stale.apply([{
      entity: { eid: 'doc' },
      $was: { document: { bytes: token(new Uint8Array([0, 254, 128])) } },
      document: { title: 'lost update' },
    }])
  )
  equal(error instanceof Stale, true)
  equal((await stale.get(['doc']))[0].document, { bytes: data })
})

test('bundle composition and coalescing retain byte values', () => {
  let patches = [
    { entity: { eid: 'doc' }, document: { bytes: data } },
    { entity: { eid: 'doc' }, document: { title: 'last' } },
  ]
  let want = [{
    entity: { eid: 'doc' },
    document: { bytes: data, title: 'last' },
  }]
  equal(composed(patches), want)
  equal(coalesced(patches), want)
})

test('schema introspection retains the binary declaration and useful encoded examples', () => {
  equal(schemaOf(vocab).$defs.document.properties?.bytes, {
    type: 'string',
    contentEncoding: 'base64',
  })
  equal(schemaOf(vocab, { comps: ['document'] }).$defs.document.examples, [{
    bytes: 'AP+A',
    title: '…',
  }])
  equal(
    proseOf(vocab, { comps: ['document'] }).includes('bytes (base64 in JSON)'),
    true,
  )
})
