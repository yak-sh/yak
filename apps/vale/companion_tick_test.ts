// A scheduled companion keeps its state across workers, credits one shared
// harvest, and the same rows answer another player's view.
import { assert, assertEquals } from '@std/assert'
import { companionTick, type Snapshot } from './companion-tick.ts'
import { comp } from './bundle.ts'
import type { Bundle } from './net.ts'
import { flat, type Prop } from './terrain.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let row = (eid: string, by: string, part: Record<string, unknown>): Bundle => ({
  entity: { eid },
  created: { by, at: '2026-09-28T00:00:00Z' },
  ...part,
})

Deno.test('a scheduled objective resumes, retries once, and credits its hero', async () => {
  let tree: Prop = { kind: 'oak', x: 5, z: 5, seed: 1, natural: true }
  let hero = row('hero', 'owner', {
    player: {},
    seen: { level: 'mossvale', x: 1, z: 5, at: '2026-09-28T00:00:00Z' },
  })
  let directive = row('order', 'owner', {
    directive: { player: 'hero', goal: 'wood', count: 1 },
  })
  let snap: Snapshot = {
    hero,
    directive,
    directives: [directive],
    items: [],
    upgraded: [],
    gathered: [],
  }
  let v = flat(5, [], [tree])
  let calls = ['choose', 'walk', 'chop', 'gather']
  for (let i = 0; i < calls.length; i++) {
    let now = 1_000 + i * 5_000
    let rows = await companionTick(
      v,
      snap,
      calls[i],
      now,
      (choices) => Promise.resolve(choices[0]),
    )
    let state = rows.find((b) => b.companion)
    assert(state)
    snap.directive = { ...snap.directive, ...state }
    snap.directives = [snap.directive]
    let items = rows.filter((b) => b.item)
    snap.items.push(...items)
    snap.gathered.push(...items)
    assertEquals(
      await companionTick(
        v,
        snap,
        calls[i],
        now,
        () => Promise.reject(new Error('a retry must not choose again')),
      ),
      [],
    )
  }
  let [item] = snap.items
  assert(item)
  assertEquals(comp(item, 'item').owner, 'hero')
  assertEquals(comp(item, 'gathered').directive, 'order')
  assertEquals(comp(snap.directive, 'companion').status, 'Done')
  // Another player's page reads these same store rows, without a page tick.
  assertEquals(snap.gathered.filter((b) => b.item).length, 1)
})
