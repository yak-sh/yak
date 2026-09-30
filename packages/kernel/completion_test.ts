import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel } from './plugin.ts'
import { kernelDoc, kernelKeywords } from './vocab.ts'

let vocab = loadVocab([kernelDoc, {
  $defs: { person: { component: true, type: 'object', properties: {} } },
}], [kernelKeywords])

test('completion uses by, never a second actor property', () => {
  assertEquals(vocab.prop('completed', 'actor'), undefined)
  // The mark is written bare and signed: when, by whom and through what are
  // the server's, so there is nothing left for a client to state.
  assertEquals(vocab.comp('completed')!.writable, [])
  assertEquals(vocab.comp('completed')!.stamped, ['at', 'by', 'via'])
})

test('completion fills an author gap but preserves a named author and later edits', async () => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [kernel()] })
  await g.apply([
    { entity: { eid: 'writer' }, person: {} },
    { entity: { eid: 'named' }, person: {} },
    { entity: { eid: 'inferred' }, completed: {} },
    { entity: { eid: 'voice' }, $actor: { by: 'writer' } },
  ])
  // Server code may still name the author outright; the wire may not.
  await g.apply(
    [{ entity: { eid: 'explicit' }, completed: { by: 'named' } }],
    { trusted: true },
  )
  let authors = async () =>
    (await g.read('.completed&*')).map((b) => (b.completed as Comp).by).sort()
  assertEquals(await authors(), ['named', 'writer'])
  // Saying it again, in somebody else's voice, does not rewrite who finished it.
  await g.apply([
    { entity: { eid: 'inferred' }, completed: {} },
    { entity: { eid: 'explicit' }, completed: {} },
    { entity: { eid: 'voice' }, $actor: { by: 'named' } },
  ])
  assertEquals(await authors(), ['named', 'writer'])
})
