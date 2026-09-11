// The frozen 432-set census contains table names only (no owner bodies/IDs).
// Every curated web registration and terminal overlay must keep its old pick,
// including qualified views, unnamed defaults, tabs and registration ties.
import './Entity.tsx'
import { overrides } from '../tui/App.tsx'
import { assertEquals, assertStrictEquals } from '@std/assert'
import { Archetypes } from '@yaks/archetype'
import { applicable, define, extend, resolve } from '@yaks/render'
import { registry, vocab } from './registry.ts'
import fixture from './fixtures/archetypes.json' with { type: 'json' }

let sets = new Archetypes()
let entries = fixture.map((tables) => sets.intern(tables))
let archetypes = (id: string) => sets.get(id)?.tables

for (let terminal of [false, true]) {
  Deno.test(`432 archetypes preserve every ${terminal ? 'TUI' : 'web'} registry pick`, () => {
    assertEquals(entries.length, 432)
    assertEquals(new Set(entries.map((a) => a.eid)).size, 432)
    let old = define(registry.renderers, { views: registry.views })
    let next = define(registry.renderers, { views: registry.views, archetypes })
    if (terminal) {
      extend(old, overrides)
      extend(next, overrides)
    }
    let views = [...new Set(old.renderers.map((r) => r.view))]
    // Column-only view names reject an entity subject in the old registry;
    // preserve that refusal too rather than dropping those registrations.
    let pick = (
      reg: typeof old,
      b: Parameters<typeof resolve>[1],
      view?: string,
    ) => {
      try {
        return resolve(reg, b, view, vocab)
      } catch (error) {
        return String(error)
      }
    }
    for (let a of entries) {
      let complete = {
        entity: { eid: 'fixture', archetype: a.eid },
        ...Object.fromEntries(a.tables.map((t) => [t, {}])),
      }
      // Only the value matcher needs values; column controls are not entity
      // presence queries. The table-only picks must also work on projections.
      let projected = { entity: complete.entity }
      for (
        let view of [
          undefined,
          'Unknown.View',
          ...views,
          ...views.map((v) => `Board.${v}`),
        ]
      ) {
        let expected = pick(old, complete, view)
        assertStrictEquals(
          pick(next, complete, view),
          expected,
          `${a.eid} ${view}`,
        )
        assertStrictEquals(
          pick(next, projected, view),
          expected,
          `projected ${a.eid} ${view}`,
        )
      }
      assertEquals(
        applicable(next, projected, vocab),
        applicable(old, complete, vocab),
      )
    }
  })
}
