/// <reference lib="deno.ns" />
// What every platform tool SAYS about itself: its title and the four MCP
// behavior hints (T-34345, T-34346, T-34347, T-34356). A host reads the hints
// to decide what it may call without stopping to ask, and both connector
// directories review them mechanically — a read-only tool advertised
// destructive is a person asked to approve a list of their own apps.
//
// The lists below are PINNED on purpose. A new tool with no hints lands in
// none of them and the diff says which line to add it to, which is the whole
// point: the table is the declaration, and a tool that forgot to declare
// cannot slip through wearing whatever the default happened to be.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { annotated, core } from '@yaks/mcp'
import { UNDO } from './guide.ts'
import { TOOLS } from './tools.ts'
import { platformVocab } from './vocab.ts'

// A pure look-up: it fetches, lists or retrieves and changes nothing. `about`
// is here too — it says one fixed paragraph, plus who the caller is signed in
// as, and writes nothing.
let READS = [
  'about',
  'app_list',
  'app_published',
  'app_secret_list',
  'app_versions',
  'app_stats',
  'domain_status',
  'gallery_search',
  'guide',
  'memory_recall',
  'sandbox_read',
]

// It can delete, or change something no second call takes back. A CREATE is
// not here: it only adds, and the undo of a create is the delete that is.
let DESTROYS = [
  'app_delete',
  'app_files',
  'app_rollback',
  'app_secret_remove',
  'app_unpublish',
  'app_update',
  'member_remove',
  'sandbox_exec',
  'sandbox_ship',
  'sandbox_write',
  'space_delete',
  'domain_detach',
  // Reversible — the way back is written down before anything moves — and
  // still destructive: it throws away everything written since the moment
  // asked for, and a host should stop and ask before it does that.
  'store_restore',
]

// It reaches past yaks.app: a letter to somebody's inbox, a page the whole web
// can then read, a record at Cloudflare.
let OUTSIDE = [
  'app_deploy',
  'app_files',
  'app_publish',
  'app_rollback',
  'app_unpublish',
  'domain_attach',
  'domain_detach',
  'domain_status',
  'feedback',
  'member_add',
  'sandbox_exec',
  'sandbox_ship',
  // It mints an account at Stripe and hands back a link onto Stripe's own
  // hosted form.
  'space_sell',
]

// The way back out of each of them, in the words its own description has to
// END with (T-34509). Nothing here is lost by a simple mistake, and the place
// an agent needs to be told that is the tool it is reading at the moment it is
// deciding whether to dare — not a guide it may not have opened.
//
// PINNED like the lists above, and for the same reason: a new destructive tool
// with no entry here fails, so naming the way back is part of declaring one.
// Two of them say honestly that there is nothing to name, which is the truthful
// entry and not an exemption.
let BACK: Record<string, string> = {
  app_delete: 'The way back: app_restore',
  app_deploy: 'The way back: app_rollback',
  app_files: 'The way back from any write, patch, fetch or delete here',
  app_rollback: 'The way back: another app_rollback',
  app_secret_remove: 'The way back: app_secret_set with the value again',
  app_unpublish: 'The way back: app_publish',
  app_update: 'The way back: app_rollback',
  domain_detach: 'The way back: domain_attach with the same hostname',
  member_remove: 'The way back: member_add with the same address',
  sandbox_exec: 'The way back: none is needed',
  sandbox_ship: 'The way back: these land through app_files',
  sandbox_write: 'The way back: none is needed',
  space_delete: 'The way back: space_restore',
  store_restore: 'The way back: another store_restore',
}

// How much of a description counts as its ENDING. Long enough for a closing
// sentence, short enough that a mention buried in the middle does not pass.
let ending = (said: string) => said.trimEnd().slice(-200)

let sorted = (names: string[]) => [...names].sort()

let picked = (has: (t: (typeof TOOLS)[number]) => boolean) =>
  sorted(TOOLS.filter(has).map((t) => t.name))

Deno.test('every platform tool has a title', () => {
  for (let t of TOOLS) {
    assert(t.title, `${t.name} has no title`)
    assert(t.title.length <= 40, `${t.name}'s title is a sentence: ${t.title}`)
    assert(!t.title.endsWith('.'), `${t.name}'s title ends in a period`)
  }
  assertEquals(
    new Set(TOOLS.map((t) => t.title)).size,
    TOOLS.length,
    'two tools share a title',
  )
})

Deno.test('the read-only tools are the pinned ones', () => {
  assertEquals(picked((t) => !!t.readOnly), sorted(READS))
})

Deno.test('the destructive tools are the pinned ones', () => {
  // Through the transport, not the field: what a client is told is what
  // `annotated` derives, and an unsaid `destructive` on a writer means true.
  assertEquals(
    sorted(
      TOOLS.filter((t) => annotated(t).destructiveHint).map((t) => t.name),
    ),
    sorted(DESTROYS),
  )
})

Deno.test('the open-world tools are the pinned ones', () => {
  assertEquals(picked((t) => !!t.openWorld), sorted(OUTSIDE))
})

Deno.test('a read tool is never destructive, and every write says which', () => {
  for (let t of TOOLS) {
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

Deno.test('every destructive tool ends by naming its way back', () => {
  let destroys = TOOLS.filter((t) => annotated(t).destructiveHint)
  // app_deploy is not destructive — it only adds a version — but it replaces
  // what the app serves, so it says its way back with the rest.
  for (let t of [...destroys, TOOLS.find((x) => x.name == 'app_deploy')!]) {
    let back = BACK[t.name]
    assert(back, `${t.name} names no way back — add it to BACK`)
    assertStringIncludes(
      ending(t.description),
      back,
      `${t.name} does not END by naming its way back`,
    )
  }
  // Nothing in the table that is not one of them: a way back named for a tool
  // that cannot destroy is a line nobody will maintain.
  assertEquals(
    sorted(Object.keys(BACK)),
    sorted([...destroys.map((t) => t.name), 'app_deploy']),
  )
})

// And the generic tier, whose own package cannot know it (@yaks/mcp
// `CoreOpts.undo`): a store's way back is store_restore, and graph_apply is
// where an agent about to delete a row is reading.
Deno.test('graph_apply is told this store has a way back', () => {
  assertStringIncludes(UNDO, 'store_restore')
  assert(
    core({ vocab: platformVocab(), undo: UNDO })
      .find((t) => t.name == 'graph_apply')!.description.endsWith(UNDO),
    'graph_apply does not end with this store’s way back',
  )
})

Deno.test('annotated derives the four hints from the tool', () => {
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
