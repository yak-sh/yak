// The effects facet writes files, so it is off unless a config turns it on.

import { assert, assertEquals } from '@std/assert'
import { effectsIn } from '@yaks/vocab'
import { said, world } from './testing.ts'
import { effects } from './effects.ts'

let host = { graph: world(), vocab: said }

Deno.test('a host that did not ask for the files runs nothing', () => {
  assertEquals(effects(host), {})
})

Deno.test('one that did handles what the vocabulary declares', () => {
  let declared = effectsIn(said.docs).map((e) => e.name)
  let handled = Object.keys(effects(host, { files: true }))
  assert(handled.length)
  assert(handled.every((n) => declared.includes(n)), `${handled}`)
})
