// A borrowed word keeps the lifetime of its home before any schema growth.
import { equal, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { homed, type Homes } from './vocab.ts'
import type { VocabDoc } from '@yaks/vocab'

let borrowed = (extra: object = {}): VocabDoc => ({
  $defs: {
    participant: {
      component: true,
      properties: { run: { type: 'string' } },
      ...extra,
    },
  },
})
let homes: Homes = {
  participant: {
    at: 'vale',
    props: {},
    schema: { component: true, properties: {} },
  },
}
let peers: Homes = {
  participant: {
    at: 'game',
    props: {},
    schema: { component: true, sync: 'peers', durable: '1s', properties: {} },
  },
}

test('a relayed participant cannot silently borrow a stored hero lifetime', () => {
  let error = assertThrows(
    () => homed(borrowed({ sync: 'peers', durable: 'connection' }), homes),
    Error,
  )
  equal(error.message.includes('where participant lives'), true)
  equal(error.message.includes('sync: server, durable: forever in vale'), true)
  equal(homes.participant.props, {})
})
test('a duration mismatch is refused even when synchronization matches', () => {
  assertThrows(
    () => homed(borrowed({ sync: 'peers', durable: 'connection' }), peers),
    Error,
  )
})
test('implicit server forever and explicit defaults have the same contract', () => {
  equal(homed(borrowed({ sync: 'server', durable: 'forever' }), homes).grows, {
    vale: { participant: { run: { type: 'string' } } },
  })
})
test('equivalent timed lifetimes preserve ordinary borrowed property growth', () => {
  equal(homed(borrowed({ sync: 'peers', durable: '1000ms' }), peers).grows, {
    game: { participant: { run: { type: 'string' } } },
  })
})
