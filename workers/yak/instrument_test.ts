// A vouched outside instrument reaches graph stamps by its stable eid.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, type Comp, graph, minted, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { memberDoc, members, Paced, pacing, policy } from '@yaks/member'
import { spineDoc } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { authenticating } from './graph.ts'
import { instrumentEid } from './instrument.ts'
import { assertRejects, assertThrows } from '@std/assert'
import { Denied } from '@yaks/member'
import { attributed } from './attribution.ts'
import { browserOf, SESSION } from './session.ts'
import { COOKIE, seal } from './lib/token.ts'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    created: {
      component: true,
      properties: {
        via: { type: 'string', ref: 'entity', stamped: true },
      },
    },
  },
})
let storage = ram(vocab)
let g = graph({ vocab, storage })
let authenticate = authenticating(policy(storage), () => null)
let credential = 'oauth:an-outside-instrument'
let request = new Request('http://store/apply', {
  headers: { 'x-yak-via': credential },
})

test('a verified outside instrument writes an eid at the graph door', async () => {
  let actor = await authenticate(request)
  let [row] = await g.apply(signed([{
    entity: { eid: '00000000-0000-4000-8000-000000000009' },
    doc: { title: 'Guest work' },
  }], actor))
  ok(actor?.via && minted(actor.via))
  equal(row.created, { via: actor!.via })
  equal(await authenticate(request), actor)
  equal(request.headers.get('x-yak-via'), credential)
})

let oldVocab = loadVocab([spineDoc, provenanceDoc, docDoc, memberDoc])
let oldStorage = ram(oldVocab)
let app = '00000000-0000-4000-8000-000000000010'
let historical = '00000000-0000-4000-8000-000000000011'
let deleting = '00000000-0000-4000-8000-000000000014'
oldStorage.tx((tx) =>
  tx.patch([{
    entity: { eid: app },
    access: { mode: 'open' },
  }, {
    entity: { eid: credential },
  }, {
    entity: { eid: historical },
    doc: { title: 'Kept guest work' },
    created: { via: credential },
  }, {
    entity: { eid: deleting },
    doc: { title: 'Other guest work' },
    created: { via: credential },
  }])
)
let oldGraph = graph({
  vocab: oldVocab,
  storage: oldStorage,
  plugins: [members({ app, vocab: oldVocab, instrument: instrumentEid })],
})
let oldAuthenticate = authenticating(policy(oldStorage), () => app)

test('another guest cannot edit work written with a legacy instrument', async () => {
  let stranger = await oldAuthenticate(
    new Request(request, {
      headers: { 'x-yak-via': 'oauth:another-outside-instrument' },
    }),
  )
  await assertRejects(async () =>
    await oldGraph.apply(signed([{
      entity: { eid: historical },
      doc: { title: 'Taken guest work' },
    }], stranger)), Denied)
})

test('a guest edits work written with a legacy instrument', async () => {
  let actor = await oldAuthenticate(request)
  await oldGraph.apply(signed([{
    entity: { eid: historical },
    doc: { title: 'Edited guest work' },
  }], actor))
  let row = (await oldGraph.get([historical]))[0]
  equal(row.doc, {
    title: 'Edited guest work',
  })
  equal((row.updated as Comp).via, actor!.via)
})

test('a guest deletes work written with a legacy instrument', async () => {
  let actor = await oldAuthenticate(request)
  await oldGraph.apply(signed([{
    entity: { eid: deleting },
    $delete: true,
  }], actor))
  ok((await oldGraph.get([deleting]))[0].tombstone)
})

let secret = 'an-instrument-test-secret'
let browserToken = await seal('browser', {
  via: credential,
  exp: Math.floor(Date.now() / 1000) + SESSION,
}, secret)
let browserRequest = new Request('http://app/login', {
  headers: { cookie: `${COOKIE}=${browserToken}` },
})
let by = '00000000-0000-4000-8000-000000000012'
let claimStorage = ram(oldVocab)
claimStorage.tx((tx) =>
  tx.patch([
    { entity: { eid: credential } },
    {
      entity: { eid: historical },
      doc: { title: 'Earlier guest work' },
      created: { via: credential },
    },
    {
      entity: { eid: '00000000-0000-4000-8000-000000000013' },
      doc: { title: 'Later guest work' },
      created: { via: instrumentEid(credential) },
    },
  ])
)
let claimGraph = graph({ vocab: oldVocab, storage: claimStorage })

test('a verified legacy browser retains its source identity', async () => {
  let browser = await browserOf(browserRequest, secret)
  equal(browser?.via, instrumentEid(credential))
  equal(browser?.source, credential)
})

test('a legacy receipt attributes both stamp identities', async () => {
  let result = await attributed(claimGraph, credential, by)
  equal(result, { filled: 2, more: false })
  let rows = await claimGraph.get([
    historical,
    '00000000-0000-4000-8000-000000000013',
  ])
  equal(rows.map((row) => (row.created as Comp).by), [by, by])
  equal(rows.map((row) => (row.created as Comp).via), [
    credential,
    instrumentEid(credential),
  ])
})

test('canonical instruments retain the latest stored pacing clock', () => {
  let via = instrumentEid(credential)
  let row: Bundle = {
    entity: { eid: historical },
    doc: { title: 'Before' },
    _pace: {
      writes: [
        { comp: 'doc', via: credential, at: 50 },
        { comp: 'doc', via, at: 100 },
      ],
    },
  }
  assertThrows(() =>
    pacing(
      { doc: 1000 },
      {
        get: () => [row],
        read: () => [],
      },
      [{
        entity: row.entity,
        doc: { title: 'After' },
        $actor: { via },
      }],
      150,
      instrumentEid,
    ), Paced)
})
