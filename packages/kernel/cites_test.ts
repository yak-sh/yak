// A citation's answer comes from the cited entity's written content, without
// a journal or a checkout.

import { assertEquals, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { loadVocab } from '@yaks/vocab'
import { content, status, verify } from './cites.ts'
import { kernelDoc } from './vocab.ts'

let vocab = loadVocab([kernelDoc, docDoc, edgeDoc], [edgeKeywords])
let target = (body: string): Bundle => ({
  entity: { eid: 'target' },
  doc: { body },
  created: { at: '2026-09-27T00:00:00Z' },
})
let cite: Bundle = {
  entity: { eid: 'citation' },
  edge: { from: 'source', to: 'target' },
  cites: {},
}

Deno.test('a verified graph citation tracks content and ignores stamps', () => {
  let checked = verify(cite, target('oak'), vocab)
  assertEquals(checked.verified, {})
  assertEquals(checked.cites, { hash: content(vocab)(target('oak')) })
  assertEquals(status(checked, target('oak'), vocab), { state: 'current' })
  assertEquals(
    status(checked, {
      ...target('oak'),
      created: { at: '2026-09-28T00:00:00Z' },
      updated: { at: '2026-09-28T01:00:00Z' },
    }, vocab),
    { state: 'current' },
  )
  assertEquals(status(checked, target('ash'), vocab), { state: 'moved' })
  assertEquals(
    status(checked, {
      entity: { eid: 'target' },
      tombstone: {},
    }, vocab),
    { state: 'moved' },
  )
})

Deno.test('checking again records the new content', () => {
  let moved = target('ash')
  let checked = verify(cite, target('oak'), vocab)
  let again = verify(checked, moved, vocab)
  assertEquals(status(again, moved, vocab), { state: 'current' })
})

Deno.test('missing checks and old marks never claim freshness', () => {
  assertEquals(status(cite, target('oak'), vocab), {
    state: 'unverified',
  })
  assertEquals(status({ ...cite, verified: {} }, target('oak'), vocab), {
    state: 'unknown',
    why: 'verified against no content hash',
  })
  assertThrows(
    () =>
      verify(cite, {
        entity: { eid: 'target' },
        tombstone: {},
      }, vocab),
    Error,
    'deleted entity',
  )
})
