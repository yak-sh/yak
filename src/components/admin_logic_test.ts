// The admin census derives from the vocabulary — held as a property: a comp
// added to types.ts appears in the admin's columns and sidebar with ZERO admin
// edits. These are PURE derivation tests: they import only admin.ts (which
// pulls types.ts + client.ts, no view), so they never mount and stay sub-ms.
// The DOM-mount tests that render <Admin/> live in admin_test.ts, which must
// import the heavy Admin.tsx view and cannot hit the 1ms budget.
import {
  adminRoute,
  censusComps,
  columnsFor,
  countsByPresence,
  inSection,
} from './admin.ts'
import { comps, stamped } from '../types.ts'
import { assertEquals } from '@std/assert'

// Warm the derivation path once at import so the first test isn't charged for
// the vocabulary's first traversal — keeps every test in this file sub-ms.
columnsFor('task')

Deno.test("columnsFor: a kind's columns ARE its vocabulary row", () => {
  let keys = columnsFor('task').map((c) => c.key)
  assertEquals(keys[0], 'id')
  assertEquals(keys[1], 'title')
  for (let prop of Object.keys(comps.task)) {
    assertEquals(keys.includes(prop), true)
  }
  assertEquals(keys[keys.length - 1], 'modified')
})

Deno.test('columnsFor: stamped columns render too', () => {
  // any vocabulary comp that also has stamped columns — found, not named,
  // so a comp rename never breaks the property being held
  let kind = Object.keys(stamped).find((k) => comps[k])!
  let keys = columnsFor(kind).map((c) => c.key)
  for (let prop of Object.keys(stamped[kind])) {
    assertEquals(keys.includes(prop), true)
  }
})

Deno.test('derivation: a new comp needs zero admin edits', () => {
  ;(comps as Record<string, Record<string, unknown>>).gadget = {
    size: 'number',
    owner: { eid: '' },
  }
  try {
    let cols = columnsFor('gadget')
    assertEquals(cols.map((c) => c.key), [
      'id',
      'title',
      'size',
      'owner',
      'modified',
    ])
    assertEquals(cols[2].t, 'number')
    assertEquals(censusComps().includes('gadget'), true)
  } finally {
    delete (comps as Record<string, unknown>).gadget
  }
})

// P-19's shape: a project that also wears an alias facet. kindOf(P-19) is
// 'project', so a kind filter would empty the alias section — presence lists it
// under both. A revert to r.kind == kind fails these.
let faceted = {
  eid: 'p',
  num: 19,
  kind: 'project',
  comps: { doc: {}, project: {}, alias: { slug: 'home' } },
}
let plain = { eid: 't', num: 2, kind: 'task', comps: { doc: {}, task: {} } }

Deno.test('inSection: an entity appears under every component it wears', () => {
  let rows = [faceted, plain]
  assertEquals(inSection(rows, 'alias'), [faceted])
  assertEquals(inSection(rows, 'project'), [faceted])
  // a plain entity lands only in its own section — presence == kind there
  assertEquals(inSection(rows, 'task'), [plain])
})

Deno.test('countsByPresence: each entity counts under every component', () => {
  let counts = countsByPresence([faceted, plain], ['project', 'alias', 'task'])
  assertEquals(counts.project, 1)
  assertEquals(counts.alias, 1)
  assertEquals(counts.task, 1)
})

Deno.test('censusComps: every vocabulary component gets a section', () => {
  assertEquals(censusComps(), Object.keys(comps).sort())
  assertEquals(censusComps().includes('task'), true)
  assertEquals(censusComps().includes('alias'), true)
  assertEquals(censusComps().includes('created'), true)
})

Deno.test('adminRoute: bare, kind, and new forms', () => {
  assertEquals(adminRoute('/admin'), { kind: censusComps()[0], form: false })
  assertEquals(adminRoute('/admin/memory'), { kind: 'memory', form: false })
  assertEquals(adminRoute('/admin/person/new'), { kind: 'person', form: true })
})
