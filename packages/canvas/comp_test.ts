import { assertEquals, assertThrows } from '@std/assert'
import { loadVocab, storable } from '@yaks/vocab'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { syncKeywords, tierOf } from '@yaks/sync'
import { canvasDoc, PER_CLIENT } from './comp.ts'
import { canvas } from './plugin.ts'

let v = loadVocab([canvasDoc], [syncKeywords, idKeywords, nameKeywords])

Deno.test('the document is storable — every column lowers to one', () => {
  assertEquals(storable(canvasDoc), [])
})

Deno.test('a card dies with what it shows', () => {
  assertEquals(v.column('card', 'target')!.death, 'cascade')
  assertEquals(
    v.deaths('cascade').some(([c, p]) => c == 'card' && p == 'target'),
    true,
  )
})

Deno.test('every component is wire — including the per-window ones', () => {
  for (let name of v.all) assertEquals(tierOf(v, name), 'wire', name)
  for (let name of PER_CLIENT) assertEquals(v.all.includes(name), true, name)
})

Deno.test('a camera is centre, scale and window size', () => {
  assertEquals(v.comp('camera')!.writable, [
    'client',
    'canvas',
    'x',
    'y',
    'zoom',
    'w',
    'h',
  ])
})

Deno.test("a client's ip is the server's to write", () => {
  assertEquals(v.comp('client')!.stamped, ['ip'])
  assertEquals(v.comp('client')!.writable, ['user_agent', 'actor'])
})

Deno.test('pane.parent is said in full, never bare', () => {
  assertThrows(() => v.route('parent'))
  assertEquals(v.route('zoom'), { comp: 'camera', prop: 'zoom' })
})

Deno.test('the plugin contributes the document and no hook', () => {
  let p = canvas()
  assertEquals(p.vocab, [canvasDoc])
  assertEquals(p.hooks, undefined)
})
