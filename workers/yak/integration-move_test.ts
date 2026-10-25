// A custom integration made before owners were kept takes the space holding
// its oldest connection, and one no space holds a connection through keeps
// none.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { connectionsDoc, integrationEid } from '@yaks/connections'
import { integrationOwnerRule } from './integration-move.ts'

let vocab = loadVocab([kernelDoc, provenanceDoc, connectionsDoc, {
  $defs: {
    space: { component: true, type: 'object', properties: {} },
    person: { component: true, type: 'object', properties: {} },
  },
}])
let g = graph({ vocab, storage: ram(vocab) })
let at = (n: number) => ({ at: new Date(Date.UTC(2026, 9, n)).toISOString() })
let made = (name: string) => ({
  entity: { eid: integrationEid(name) },
  integration: { name, hosts: [`api.${name}.example`] },
})
let through = (name: string, owner: string, n: number) => ({
  entity: { eid: `${name}-${owner}` },
  connection: { integration: name, owner, status: 'needed' },
  created: at(n),
})
await g.apply([
  { entity: { eid: 'ada' }, space: {} },
  { entity: { eid: 'bob' }, space: {} },
  { entity: { eid: 'cy' }, person: {} },
  made('esv'),
  made('lonely'),
  made('theirs'),
  // A person's own came first; the oldest a space holds is ada's.
  through('esv', 'cy', 1),
  through('esv', 'bob', 3),
  through('esv', 'ada', 2),
  through('theirs', 'cy', 1),
], { trusted: true, stamp: false })
let rows = await g.read(integrationOwnerRule.find)
let read = (line: string) => g.read(line) as Bundle[]

test('a custom integration made before owners were kept takes the space that first asked for it', () => {
  let moved = Object.fromEntries(
    rows.map((row) => [
      (row.integration as { name: string }).name,
      integrationOwnerRule.move(row, read).map((b) => b.integration),
    ]),
  )
  assertEquals(moved, {
    esv: [{ owner: 'ada' }],
    lonely: [],
    theirs: [],
  })
})
