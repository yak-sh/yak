// The effects facet writes files, so it is off unless a config turns it on.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { effectsIn } from '@yaks/vocab'
import { said, world } from './testing.ts'
import { effects } from './effects.ts'

let host = { graph: world(), vocab: said }

test('a host that did not ask for the files runs nothing', () => {
  assertEquals(effects(host), {})
})

test('one that did handles what the vocabulary declares', () => {
  let declared = effectsIn(said.docs).map((e) => e.name)
  let handled = Object.keys(effects(host, { files: true }))
  assert(handled.length)
  assert(handled.every((n) => declared.includes(n)), `${handled}`)
})

test('skills are an independent opt-in', () => {
  let skills = Object.keys(effects(host, { skills: true }))
  assertEquals(skills.sort(), ['skill_files', 'skill_watch'])
  assertEquals(Object.keys(effects(host, { files: true })), ['persona_files'])
  assertEquals(
    Object.keys(effects(host, { files: true, skills: true })).sort(),
    ['persona_files', 'skill_files', 'skill_watch'],
  )
})
