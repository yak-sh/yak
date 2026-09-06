import { assertEquals } from '@std/assert'
import { rosterLine } from '@yaks/mcp'
import { rosterAfter, saidBy, versionIn } from './roster.ts'
import type { Roster } from './store.ts'

// The line is @yaks/mcp's own, so everything here is tested against the words
// it actually writes rather than a copy of them.
let stale = rosterLine(['about'], ['about', 'mail_send'])!

let held: Roster = { version: '1a2b3c4d', tools: [{ name: 'about' }] }

Deno.test('the roster line is news about this program, not the answer', () => {
  assertEquals(saidBy({ content: [{ type: 'text', text: '[]' }] }), {
    text: '[]',
  })
  assertEquals(
    saidBy({
      content: [{ type: 'text', text: 'ok' }, { type: 'text', text: stale }],
    }),
    { text: 'ok', stale },
  )
})

Deno.test('an about answer names the list it served', () => {
  assertEquals(
    versionIn('The tools here right now, roster 1a2b3c4d:\nabout, search'),
    '1a2b3c4d',
  )
  assertEquals(versionIn('nothing of the sort'), undefined)
})

Deno.test('a cached list is dropped on the news, and never asked about', () => {
  // An ordinary answer says nothing about the list — the cache stands.
  assertEquals(rosterAfter(held, 'graph_query', { text: '[]' }), held)
  // The roster line says the list moved: drop it and list again.
  assertEquals(rosterAfter(held, 'graph_query', { text: '[]', stale }), null)
  // An `about` naming this version confirms it; naming another drops it.
  assertEquals(rosterAfter(held, 'about', { text: 'roster 1a2b3c4d' }), held)
  assertEquals(rosterAfter(held, 'about', { text: 'roster ffffffff' }), null)
  // A list nobody has stamped yet takes the version it just heard.
  assertEquals(
    rosterAfter({ tools: [] }, 'about', { text: 'roster 1a2b3c4d' }),
    {
      tools: [],
      version: '1a2b3c4d',
    },
  )
})
