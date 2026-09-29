// A command answer identifies a target and reports its useful public state
// without returning the underlying store rows.
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from './net.ts'
import { inspectOf } from './inspect.ts'

let row = (eid: string, more: Record<string, unknown> = {}): Bundle => ({
  entity: { eid },
  ...more,
})

Deno.test('inspect prefers live position and summarizes a hero objective', () => {
  let hero = row('hero', {
    player: {},
    seen: { level: 'mossvale', x: 1, z: 2 },
    created: { by: 'private-account' },
  })
  let text = inspectOf({
    row: hero,
    related: {
      look: row('look', { look: { name: 'Bramble', player: 'hero' } }),
      live: row('hero', {
        position: { level: 'tombsands', x: 123.4, z: 456.8 },
      }),
      objective: row('ask', {
        directive: { player: 'hero', goal: 'wood', count: 5 },
      }),
      progress: 2,
    },
  })
  assertStringIncludes(text, 'Bramble')
  assertStringIncludes(text, 'Hero `hero`')
  assertStringIncludes(text, 'Tombsands (123, 457)')
  assertStringIncludes(text, 'Companion: wood 2/5')
  assertEquals(text.includes('private-account'), false)
  assertEquals(text.includes('Last seen'), false)
})

Deno.test('inspect describes a villager, objective, item, and land', () => {
  let villager = inspectOf({
    row: row('wren', {
      doc: { title: 'Elder Wren' },
      villager: { id: 'wren', level: 'mossvale', home: 'oak grove' },
    }),
    related: { going: row('trip', { going: { go: 'work' } }) },
  })
  assertStringIncludes(villager, 'Elder Wren')
  assertStringIncludes(villager, 'Home: Mossvale, oak grove')
  assertStringIncludes(villager, 'Heading: work')
  let objective = inspectOf({
    row: row('ask', {
      directive: { player: 'hero', goal: 'wood', count: 4 },
      companion: { status: 'walking', x: 10, z: 20 },
    }),
    related: { progress: 1 },
  })
  assertStringIncludes(objective, 'wood: 1/4')
  assertStringIncludes(objective, 'Status: walking')
  let item = inspectOf({
    row: row('sword', {
      item: { kind: 'sword', rarity: 'rare', owner: 'hero' },
    }),
  })
  assertStringIncludes(item, 'Rarity: rare')
  assertStringIncludes(inspectOf({ level: 'tombsands' }), 'Land `tombsands`')
})

Deno.test('inspect reports saved heroes and live-only world targets', () => {
  let saved = inspectOf({
    row: row('hero', {
      player: {},
      seen: { level: 'mossvale', x: 8, z: 9 },
    }),
  })
  assertStringIncludes(saved, 'Last seen: Mossvale (8, 9)')
  let creature = inspectOf({
    row: row('creature', {
      position: { level: 'tombsands', x: 11, z: 12 },
    }),
  })
  assertStringIncludes(creature, 'World target')
  assertStringIncludes(creature, 'Position now: Tombsands (11, 12)')
})
