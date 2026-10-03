/// <reference lib="deno.ns" />
// What every platform tool says about itself: its title and the four MCP
// behavior hints (T-34345, T-34346, T-34347, T-34356). A host reads the hints
// to decide what it may call without stopping to ask, and both connector
// directories review them mechanically — a read-only tool advertised
// destructive is a person asked to approve a list of their own apps.
//
// Writers declare their behavior rather than inheriting a destructive
// transport default; read-only tools never tell a host they can destroy.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { annotated, core } from '@yaks/mcp'
import { read } from '@yaks/yaml'
import { WORDS } from './content.ts'
import { UNDO } from './guide.ts'
import { PUBLISHED } from './published.ts'
import { TOOLS } from './tools.ts'
import { platformVocab } from './vocab.ts'

let sorted = (names: string[]) => [...names].sort()

// The connector's roster: the platform's tools, and the names a directory
// listed that they answer under still (published.ts).
let ROSTER = [...TOOLS, ...PUBLISHED]

// The words are the file's (tools.yml, M-34605), and this is the pair of
// checks that keeps the file and the roster one list: a row whose name the
// file does not know throws at load (tool.ts `worded`), and an entry no row
// claims is a description nobody will ever read.
test('the tool words are the file, and the file is the roster', () => {
  let yml = read(
    Deno.readTextFileSync(new URL('./tools.yml', import.meta.url)),
    'tools.yml',
  ) as Record<string, { title: string; description: string }>
  assertEquals(sorted(Object.keys(yml)), sorted(Object.keys(WORDS)))
  assertEquals(
    sorted(Object.keys(yml)),
    sorted(ROSTER.map((t) => t.name)),
    'tools.yml and the roster name different tools',
  )
  // And what a row wears is what its entry says — the one row with a slot
  // (`guide`) says the pages there are, so its description grows from the
  // file rather than matching it.
  for (let t of ROSTER) {
    assertEquals(t.title, yml[t.name].title, t.name)
    let said = yml[t.name].description
    let hole = said.indexOf('{{')
    assert(
      hole == -1
        ? t.description == said
        : t.description.startsWith(said.slice(0, hole)),
      `${t.name} does not say what tools.yml says`,
    )
  }
})

test('every platform tool has a title', () => {
  for (let t of ROSTER) {
    assert(t.title, `${t.name} has no title`)
    assert(t.title.length <= 40, `${t.name}'s title is a sentence: ${t.title}`)
    assert(!t.title.endsWith('.'), `${t.name}'s title ends in a period`)
  }
  assertEquals(
    new Set(ROSTER.map((t) => t.title)).size,
    ROSTER.length,
    'two tools share a title',
  )
})

test('a read tool is never destructive, and every write says which', () => {
  for (let t of ROSTER) {
    let a = annotated(t)
    assert(
      !(a.readOnlyHint && a.destructiveHint),
      `${t.name} both reads and destroys`,
    )
    // The declaration is the point: a writer that says nothing gets the safe
    // default, which is a permission prompt nobody chose.
    assert(
      t.readOnly || t.destructive != null,
      `${t.name} writes and never says whether it destroys`,
    )
  }
})

// And the generic tier, whose own package cannot know it (@yaks/mcp
// `CoreOpts.undo`): a store's way back is store_restore, and graph_apply is
// where an agent about to delete a row is reading.
test('graph_apply is told this store has a way back', () => {
  assert(
    core({ vocab: platformVocab(), undo: UNDO })
      .find((t) => t.name == 'graph_apply')!.description.endsWith(UNDO),
    'graph_apply does not end with this store’s way back',
  )
})

test('annotated derives the four hints from the tool', () => {
  assertEquals(annotated({ readOnly: true }), {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  })
  // Silence on a writer is destructive, never the other way.
  assertEquals(annotated({}), {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  })
  assertEquals(
    annotated({ destructive: false, idempotent: true, openWorld: true }),
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  )
})
