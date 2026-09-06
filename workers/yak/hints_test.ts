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
import { assert, assertEquals } from '@std/assert'
import { annotated } from '@yaks/mcp'
import { TOOLS } from './tools.ts'

// A pure look-up: it fetches, lists or retrieves and changes nothing. `about`
// is here too — it says one fixed paragraph, plus who the caller is signed in
// as, and writes nothing.
let READS = [
  'about',
  'app_list',
  'app_published',
  'app_secret_list',
  'app_versions',
  'domain_status',
  'guide',
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
]

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
