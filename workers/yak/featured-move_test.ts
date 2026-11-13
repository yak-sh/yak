// What yaks.app featured moves into its `featured` mark, once: an integration
// that said `featured` itself, and each app the home pages showed from the
// demo space, and nothing else.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { connectionsDoc, integrationEid } from '@yaks/connections'
import { platformDoc } from '@yaks/platform/vocab'
import { demoFeaturedRule, integrationFeaturedRule } from './featured-move.ts'

let vocab = loadVocab([
  kernelDoc,
  platformDoc,
  connectionsDoc,
  integrationFeaturedRule.source!,
])
let g = graph({ vocab, storage: ram(vocab) })
let integration = (name: string, featured?: boolean) => ({
  entity: { eid: integrationEid(name) },
  integration: {
    name,
    hosts: [`api.${name}.example`],
    ...featured == null ? {} : { featured },
  },
})
let app = (eid: string, slug: string, space: string) => ({
  entity: { eid },
  app: { slug, space, version: 1, access: 'public' },
})
await g.apply([
  { entity: { eid: 'demo' }, space: { slug: 'yourname' } },
  { entity: { eid: 'jeff' }, space: { slug: 'jeff' } },
  integration('slack', true),
  integration('ashby', false),
  integration('plain'),
  app('garden', 'garden', 'demo'),
  app('theirs', 'garden', 'jeff'),
  app('ledger', 'ledger', 'demo'),
], { trusted: true, stamp: false })

let moving = async (rule: typeof demoFeaturedRule) => {
  let rows = await g.read(rule.find)
  let read = (line: string) => g.read(line) as Bundle[]
  await g.apply(rows.flatMap((row) => rule.move(row, read)), { trusted: true })
  return rows.length
}
let featured = async (eids: string[]) =>
  (await g.read(`.entity.eid=${eids.join(',')}&?featured`))
    .filter((r) => r.featured).map((r) => r.entity.eid).sort()

test("an integration's own featured becomes the mark, and the property goes", async () => {
  assertEquals([
    await moving(integrationFeaturedRule),
    await moving(integrationFeaturedRule),
  ], [2, 0])
  let [slack, ashby, plain] = ['slack', 'ashby', 'plain'].map(integrationEid)
  assertEquals(await featured([slack, ashby, plain]), [slack])
  let rows = await g.read(`.entity.eid=${slack},${ashby}&.integration`)
  assertEquals(
    rows.map((r) => (r.integration as { featured?: unknown }).featured ?? null),
    [null, null],
  )
})

test("only the demo space's home-page apps are featured", async () => {
  assertEquals(
    [await moving(demoFeaturedRule), await moving(demoFeaturedRule)],
    [
      2,
      1,
    ],
  )
  assertEquals(await featured(['garden', 'theirs', 'ledger']), ['garden'])
})
