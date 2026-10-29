/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import { edited } from './changes.ts'
import { Refused, Stale } from './errors.ts'
import { token } from './sha256.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    blocked: { component: true, type: 'object', properties: {} },
  },
})
let fresh = async () => {
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([{
    entity: { eid: 'a' },
    doc: { title: 'Title', body: 'First' },
    blocked: {},
  }])
  return g
}

let serial = await fresh()
test('compact edits compose text and clear fields in one patch', async () => {
  await serial.apply(
    await edited(serial, [
      {
        id: 'a',
        set: { 'doc.title': null, blocked: null },
        text: [{ path: 'doc.body', append: ' second' }],
      },
      {
        id: 'a',
        text: [{
          path: 'doc.body',
          find: 'second',
          replace: '$&',
          prepend: 'Before ',
        }],
      },
    ]),
  )
  assertEquals((await serial.get(['a']))[0], {
    entity: { eid: 'a' },
    doc: { body: 'Before First $&' },
  })
})

let raced = await fresh()
let change = await edited(raced, [{
  id: 'a',
  set: { 'doc.title': 'Lost' },
  text: [{ path: 'doc.body', append: ' later' }],
}])
await raced.apply([{ entity: { eid: 'a' }, doc: { body: 'Concurrent' } }])
test('compact text edits protect the body and companion fields against a racing write', async () => {
  await assertRejects(async () => {
    await raced.apply(change)
  }, Stale)
  assertEquals((await raced.get(['a']))[0].doc, {
    title: 'Title',
    body: 'Concurrent',
  })
})

let reset = await fresh()
test('component resets start new text without retaining earlier fields', async () => {
  await reset.apply(
    await edited(reset, [{
      id: 'a',
      set: { doc: null },
      text: [{ path: 'doc.body', append: 'New' }],
    }]),
  )
  assertEquals((await reset.get(['a']))[0].doc, { body: 'New' })
})

let nestedReset = await fresh()
test('component reset, property write and text edit retain their sequence', async () => {
  await nestedReset.apply(
    await edited(nestedReset, [
      { id: 'a', set: { doc: null } },
      { id: 'a', set: { 'doc.title': 'New title' } },
      { id: 'a', text: [{ path: 'doc.body', append: 'New' }] },
    ]),
  )
  assertEquals((await nestedReset.get(['a']))[0].doc, {
    title: 'New title',
    body: 'New',
  })
})

let conflicting = await fresh()
test('a later edit cannot discard an earlier explicit read precondition', async () => {
  await assertRejects(
    () =>
      edited(conflicting, [
        {
          id: 'a',
          was: { 'doc.body': token('Old') },
          text: [{ path: 'doc.body', append: ' one' }],
        },
        {
          id: 'a',
          text: [{ path: 'doc.body', append: ' two', was: token('First') }],
        },
      ]),
    Refused,
    'conflicting was',
  )
  assertEquals((await conflicting.get(['a']))[0].doc, {
    title: 'Title',
    body: 'First',
  })
})
