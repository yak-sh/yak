import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { operatorMemory } from './operator-testing.ts'
import { phoneMove, phoneRule, phoneTexts } from './phone-move.ts'
import { textOf } from './operator-channels.ts'

let store = operatorMemory()
let at = new Date().toISOString()
let sent = crypto.randomUUID()
await store.g.apply([{ entity: { eid: 'ana' }, person: {} }, {
  entity: { eid: sent },
  doc: { body: 'Tuesday?' },
  delivered: { at },
  operator_text: {
    from: '+12695550100',
    to: '+12695550142',
    person: 'ana',
    at,
    message_id: '77',
  },
}], { trusted: true })
let legacy = (await store.g.get([sent]))[0]
let once = phoneMove(legacy)
await phoneTexts(store.g)
let moved = (await store.g.get([sent]))[0]
let answer = await textOf(store, { from: '+12695550142', to: '+12695550100' })
await phoneTexts(store.g)

test('legacy voip.ms texts keep their words, identity, delivery and conversation link in the shared shape', () => {
  assertEquals(moved.doc, legacy.doc)
  assertEquals(moved.delivered, { at })
  assertEquals(moved.operator_text, { person: 'ana' })
  assertEquals(moved.text, {
    from: '+12695550100',
    to: '+12695550142',
    at,
    message_id: '77',
    via: 'voipms',
  })
  assertEquals(answer?.entity.eid, sent)
  assertEquals(phoneMove(moved), [])
  assertEquals(once.length, 1)
})

let old = crypto.randomUUID()
await store.g.apply([{
  entity: { eid: old },
  doc: { body: 'An earlier text.' },
  text: { from: '+12695550100', to: '+12695550142', message_id: 'legacy' },
}])
let before = (await store.g.read(phoneRule.find)).length
await store.g.apply(
  (await store.g.read(phoneRule.find)).flatMap((row) => phoneRule.move(row)),
)
let after = (await store.g.read(phoneRule.find)).length
let [receipt] = await store.g.get([old])

test('the app migration preserves the message and receipt, leaves one transport shape and drains its query', () => {
  assertEquals([before, after], [1, 0])
  assertEquals(receipt.doc, { body: 'An earlier text.' })
  assertEquals(receipt.text, {
    from: '+12695550100',
    to: '+12695550142',
    message_id: 'legacy',
    via: 'telnyx',
  })
})
