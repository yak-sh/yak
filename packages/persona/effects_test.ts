// The effects facet writes files, so it is off unless a config turns it on.

import { assertEquals } from '@std/assert'
import { said, world } from './testing.ts'
import { effects } from './effects.ts'

let host = { graph: world(), vocab: said }

Deno.test('a host that did not ask for the files watches nothing', () => {
  assertEquals(effects(host), [])
})

Deno.test('one that did watches personas, docs and the links between them', () => {
  assertEquals(
    effects(host, { files: true }).map((w) => w.comp),
    ['persona', 'doc', 'edge', 'contains', 'reads'],
  )
})
