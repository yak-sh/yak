// A space born before the starter became $20 keeps the $100 it held; a space
// with a starter of its own, or born after, is left alone.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { starterRule } from './starter-move.ts'

let comp = (props: Record<string, { type: string }> = {}) => ({
  component: true,
  type: 'object',
  properties: props,
})
let vocab = loadVocab([kernelDoc, {
  $defs: {
    space: comp(),
    starter: comp({ dollars: { type: 'number' } }),
    created: comp({ at: { type: 'string' } }),
  },
}])
let g = graph({ vocab, storage: ram(vocab) })
let born = (at: string) => ({ created: { at } })
await g.apply([
  { entity: { eid: 'old' }, space: {}, ...born('2026-10-01T00:00:00.000Z') },
  {
    entity: { eid: 'later' },
    space: {},
    starter: { dollars: 0 },
    ...born('2026-10-01T00:00:00.000Z'),
  },
  { entity: { eid: 'new' }, space: {}, ...born('2026-11-21T00:00:00.000Z') },
], { trusted: true, stamp: false })

test('a space born before the $20 starter keeps its $100, and only it', async () => {
  let rows = await g.read(starterRule.find)
  await g.apply(rows.flatMap((row) => starterRule.move(row)), {
    trusted: true,
    stamp: false,
  })
  let held = Object.fromEntries(
    (await g.read('.space&?starter')).map((r) => [
      r.entity.eid,
      (r.starter as { dollars?: number } | undefined)?.dollars ?? null,
    ]),
  )
  assertEquals(held, { old: 100, later: 0, new: null })
})
