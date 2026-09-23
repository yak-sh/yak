import { assertEquals, assertThrows } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { idDoc } from './vocab.ts'
import { numbers } from './number.ts'

let shop: VocabDoc = {
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    book: {
      component: true,
      type: 'object',
      kind: true,
      prefix: 'B',
      properties: { title: { type: 'string' } },
    },
  },
}
let vocab = loadVocab([shop, idDoc])

// An allocator with the contract the plugin requires: the same entity gets the
// same number however often it is asked.
let counting = () => {
  let held = new Map<string, number>()
  return (eid: string) => {
    if (!held.has(eid)) held.set(eid, held.size + 1)
    return { eid, num: held.get(eid)! }
  }
}

let numbered = (): Graph =>
  graph({ storage: ram(vocab), vocab, plugins: [numbers(counting())] })

// RAM storage is synchronous, so `apply` answers without a promise — which is
// the point of the plugin's `then`: registering it must not make every write
// asynchronous.
let wrote = (g: Graph, bundles: Bundle[]): Bundle[] =>
  g.apply(bundles) as Bundle[]

Deno.test('a number goes to the entity that asked, and to no other', () => {
  let out = wrote(numbered(), [
    { entity: { eid: 'a' }, $num: true, book: { title: 'Dune' } },
    { entity: { eid: 'b' }, book: { title: 'Emma' } },
  ])
  let at = new Map(out.map((b) => [b.entity.eid, b.entity.num]))
  assertEquals(at.get('a'), 1)
  assertEquals(at.get('b'), undefined)
})

Deno.test('asking twice gives the same number', () => {
  let g = numbered()
  let one = wrote(g, [{ entity: { eid: 'a' }, $num: true, book: {} }])
  let two = wrote(g, [{ entity: { eid: 'a' }, $num: true, book: {} }])
  assertEquals(one[0].entity.num, 1)
  assertEquals(two[0].entity.num, 1)
})

Deno.test('a graph without the plugin refuses the request', () => {
  let bare = graph({ storage: ram(vocab), vocab })
  assertThrows(
    () => bare.apply([{ entity: { eid: 'a' }, $num: true, book: {} }]),
    Error,
    'unknown request: $num',
  )
})

Deno.test('a graph without the plugin has no num column at all', () => {
  assertEquals(loadVocab([shop]).props('entity'), [])
  assertEquals(vocab.props('entity'), ['num'])
})
