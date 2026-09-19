// The fleet does not relay. Its /ws is its own socket path, not @yaks/api's,
// and it is @yaks/api's subscription registry that holds a `sync: peers` value
// under the connection that wrote it. So the fleet refuses such a write rather
// than storing something its own declaration says nobody keeps.

import { assertEquals } from '@std/assert'
import { loadVocab, syncOf } from '@yaks/vocab'
import { relaying } from '../db.ts'
import { fleetVocab } from './fleet_vocab.ts'

Deno.test('a peers-tier write is named, a durable one is not', () => {
  let vocab = loadVocab({
    $defs: {
      doc: { type: 'object', properties: { title: { type: 'string' } } },
      presence: {
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        properties: { x: { type: 'number' } },
      },
    },
  })
  assertEquals(
    relaying(vocab, [
      { eid: 'e1', name: 'doc', comp: { title: 'hi' } },
      { eid: 'e1', name: 'presence', comp: { x: 3 } },
      { eid: 'e2', name: 'presence', comp: { x: 4 } },
    ]),
    ['presence'],
  )
  assertEquals(relaying(vocab, [{ eid: 'e1', name: 'doc', comp: {} }]), [])
})

Deno.test('no fleet component syncs to peers — there is nothing here to relay', () => {
  let vocab = fleetVocab()
  assertEquals(vocab.all.filter((n) => syncOf(vocab, n) == 'peers'), [])
})
