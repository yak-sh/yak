import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/render'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { sessionDoc } from './comp.ts'
import { sessionViews } from './lines.ts'

let vocab = loadVocab([sessionDoc, toolsDoc, provenanceDoc])
let body = 'x'.repeat(100) + '\nchild final output'
let entry = {
  entity: { eid: 'e' },
  entry: { session: 's', seq: 1 },
  content: { body },
}

test('Line full retains multiline prose; the default stays a compact preview', () => {
  let compact = render(sessionViews, entry, 'Line', vocab, {}, 'plain')
  let full = render(sessionViews, entry, 'Line', vocab, { full: true }, 'plain')
  assert(compact.endsWith('x'.repeat(70)))
  assertEquals(compact.includes('child final output'), false)
  assert(full.endsWith(body))
})

test('Body omits metadata but retains resolved target and full prose', () => {
  let call = { ...entry, call: { to: 'tool' } }
  assertEquals(
    render(sessionViews, call, 'Body', vocab, {
      full: true,
      names: { tool: 'shell' },
    }, 'plain'),
    '→ shell ' + body,
  )
  assertEquals(
    render(
      sessionViews,
      entry,
      'Body',
      vocab,
      { full: true },
      'plain',
    ),
    body,
  )
})

test('a session’s line is the word that reaches it, and no status it lacks', () => {
  let tile = (b: Bundle) =>
    render(sessionViews, b, 'Tile', vocab, { id: () => 'S-3' }, 'plain')
  let named = { entity: { eid: 's', num: 3 }, session: { id: 'abc' } }
  assertEquals(tile(named), 'S-3')
  assertEquals(
    tile({ ...named, session: { id: 'abc', status: 'running' } }),
    'S-3: running',
  )
  // Unnumbered, it is its runner's own id, which every session tool takes.
  assertEquals(tile({ entity: { eid: 's' }, session: { id: 'abc' } }), 'abc')
})

test('words said in a transcript, in a list, are who said them, when, where, and the passage', () => {
  let said = {
    ...entry,
    content: { body: `${'filler words '.repeat(30)}results run miles long` },
    created: { by: 'jeff', at: '2026-10-23T18:26:21Z' },
  }
  let ctx = {
    name: (eid: string) => ({ jeff: 'Jeff', s: 'S-3' })[eid] ?? eid,
    when: () => '2 hours ago',
    words: ['miles'],
  }
  let tile = (b: Bundle) => render(sessionViews, b, 'Tile', vocab, ctx, 'plain')
  assertEquals(
    tile(said),
    'Jeff · 2 hours ago · in S-3 …filler words filler words filler words ' +
      'filler words results run miles long',
  )
  assertEquals(
    tile({ ...said, result: { call: 'c' } }).startsWith(
      'Jeff · tool result · 2 hours ago · in S-3',
    ),
    true,
  )
})
