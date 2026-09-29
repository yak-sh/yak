/// <reference lib="deno.ns" />
// Memory arrives through the host, not through an import (memory.ts
// `memoryPlugin`, T-34602). Nothing names memory.ts from tools.ts, guide.ts or
// vocab.ts any more, so what is pinned here is that the four contributions
// still land: the component in the directory's words, the two rows in the
// roster, the page in the guide — and that pulling the plugin out of PLUGINS
// is what would take them away, which is the seam doing its job.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { memoryPlugin } from './memory.ts'
import { pagesOf, toolsOf, vocabOf } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { PAGES } from './guide.ts'
import { TOOLS } from './tools.ts'
import { platformVocab } from './vocab.ts'

test('the host composes the memory plugin', () => {
  assert(PLUGINS.includes(memoryPlugin), 'memory is not in PLUGINS')
})

test('its words reach the directory vocabulary', () => {
  // The component the directory keeps a memory under, loaded because the
  // plugin brought the document — vocab.ts names no memory of its own.
  assert(platformVocab().comp('memory'), 'the directory has no memory comp')
  assert(
    vocabOf([memoryPlugin]).length == 1,
    'the plugin brought no vocabulary document',
  )
})

test('its two tools reach the roster', () => {
  let named = TOOLS.map((t) => t.name)
  for (let name of ['memory_save', 'memory_recall']) {
    assert(named.includes(name), `${name} is not on the roster`)
  }
  assertEquals(
    toolsOf([memoryPlugin]).map((t) => t.name),
    ['memory_save', 'memory_recall'],
  )
})

test('its guide page reaches the guide', () => {
  assert(
    PAGES.some((p) => p.slug == 'memory'),
    'the memory page is not among the guide pages',
  )
  assertEquals(pagesOf([memoryPlugin]).map((p) => p.slug), ['memory'])
})
