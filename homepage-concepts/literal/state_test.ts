import { assert, assertEquals } from '@std/assert'
import { act, initial, reserve, summary } from './demo-state.js'

Deno.test('reservations are persistent-shaped records, not generated copy', () => {
  const first = reserve(initial(), 'projector', 'Lea').state
  assertEquals(first.reservations.length, 1)
  assertEquals(reserve(first, 'projector', 'Other').state, first)
  assertEquals(reserve(first, 'missing', 'Lea').state, first)
  assertEquals(reserve(first, 'screen', ' ').state, first)
  const after = act(act(first, 'neighbor'), 'checklist')
  assert(after.checklist)
  assertEquals(after.reservations.map((r: { person: string }) => r.person), [
    'Lea',
    'Priya (demo neighbor)',
  ])
  assert(summary(after).includes('outdoor screen'))
  assert(summary(reserve(after, 'screen', 'Mo').state).startsWith('All three'))
  assertEquals(JSON.parse(JSON.stringify(after)), after)
})
Deno.test('publication and interface changes do not remove existing records', () => {
  const state = reserve(initial(), 'screen', 'Mo').state
  assertEquals(act(state, 'publish').reservations, state.reservations)
  assertEquals(act(state, 'checklist').reservations, state.reservations)
  assertEquals(act(act(state, 'neighbor'), 'neighbor').reservations.length, 2)
  assertEquals(initial().reservations.length, 0)
})
Deno.test('all directions share one demonstrator and resolve local assets', async () => {
  const root = new URL('.', import.meta.url)
  for (
    const page of [
      'index.html',
      'publish.html',
      'timeline.html',
      'bring.html',
      'demo.html',
    ]
  ) {
    const html = await Deno.readTextFile(new URL(page, root))
    assert(html.includes('lang="en"'))
    for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
      if (/^(https?:|mailto:)/.test(match[1])) continue
      assert((await Deno.stat(new URL(match[1], root))).isFile, match[1])
    }
  }
  const source = await Deno.readTextFile(new URL('main.js', root))
  assert(source.includes('Scripted walkthrough, not live AI'))
  assert(!source.includes('testimonials'))
})
