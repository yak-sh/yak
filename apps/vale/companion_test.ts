// The companion acts only for its owner's objective and credits one harvest
// per node life, including when two pages finish together.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  advance,
  objectiveOf,
  progressOf,
  routeTo,
  treesOf,
} from './companion.ts'
import { effort, LODES, naturalEid, respawnOf } from './gather.ts'
import type { Natural } from './nature.ts'
import { comp } from './bundle.ts'
import type { Bundle } from './net.ts'
import { flat, type Prop, withoutSpent } from './terrain.ts'
import { fits } from './sim.ts'
import { type WorkFrame, working } from './work.ts'
import words from './vocab.json' with { type: 'json' }
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let row = (eid: string, by: string, at: number, part: Bundle): Bundle => ({
  ...part,
  entity: { eid },
  created: { by, at: new Date(at).toISOString() },
})

test('the latest objective from a hero’s owner directs their companion', () => {
  let hero = row('hero', 'owner', 0, { entity: { eid: 'hero' }, player: {} })
  let request = (eid: string, by: string, at: number) =>
    row(eid, by, at, {
      entity: { eid },
      directive: { player: 'hero', goal: 'wood', count: 2 },
    })
  let own = request('own', 'owner', 1)
  let foreign = request('foreign', 'other', 2)
  assertEquals(objectiveOf(hero, [own, foreign])?.eid, 'own')
  assertEquals(objectiveOf(hero, [own, request('new', 'owner', 3)])?.eid, 'new')
  assertEquals(objectiveOf(hero, [foreign]), null)
  assertEquals(
    progressOf([
      { entity: { eid: 'i1' }, gathered: { directive: 'own' } },
      { entity: { eid: 'i2' }, gathered: { directive: 'else' } },
    ], 'own'),
    1,
  )
})

test('a companion advances along a route without jumping to the tree', () => {
  let path: [number, number, number][] = [[1, 0, 0], [3, 0, 0]]
  let first = advance([0, 0, 0], path, 0.5)
  assertEquals(first.at, [1, 0, 0])
  let next = advance(first.at, first.path, 1)
  assertEquals(next.at, [3, 0, 0])
  assertEquals(next.path, [])
})

test('a natural tree is chosen and reached through the world’s walk', () => {
  let prop: Prop = { kind: 'oak', x: 5, z: 5, seed: 1, natural: true }
  let natural: Natural[] = [{ prop, at: [5, 5, 5] }]
  let [tree] = treesOf(1, 5, natural, [], 1000)
  assertEquals(tree.kind, 'oak')
  let route = routeTo(flat(5, [], [prop]), [1, 5, 5], tree)
  assert(route?.path.length)
  let at: [number, number, number] = [1, 5, 5]
  let path = route.path.slice(1)
  for (let i = 0; i < 30 && path.length; i++) {
    ;({ at, path } = advance(at, path, 0.2))
  }
  assertEquals(path, [])
  assert(Math.hypot(at[0] - tree.x, at[2] - tree.z) < 2.4)
})

test('companion work gathers by the hero’s ordinary rules', () => {
  let prop: Prop = { kind: 'oak', x: 5, z: 5, seed: 1, natural: true }
  let natural: Natural[] = [{ prop, at: [5, 5, 5] }]
  let rows: Bundle[] = []
  let toil = working({
    hero: 'hero',
    mine: (name: string) => name == 'item' ? rows : [],
    gathered: () => rows,
    keep: (...bundles: Bundle[]) => {
      rows = [...rows, ...bundles]
    },
  })
  let v = flat(5, [], [prop])
  let f: WorkFrame = {
    body: { x: 3, y: 5, z: 5 },
    sheet: { bag: [], worn: {} },
    down: false,
    now: 1000,
  }
  let as = { target: naturalEid(prop), directive: 'order' }
  assert(toil.tick(v, f, true, false, natural, as).doing)
  f.now += effort(LODES.oak, 1)
  assert(
    toil.tick(v, f, false, false, natural, as).events.some((e) =>
      e.type == 'got' && e.item == 'oaklog'
    ),
  )
  assertEquals(comp(rows[0], 'item').owner, 'hero')
  assertEquals(comp(rows[0], 'gathered').directive, 'order')
  assertEquals(comp(rows[0], 'gathered').node, as.target)
  assertEquals(comp(rows[0], 'gathered').life, 0)
  let blocked = flat(5, [{ x: 5, z: 5, r: 0.8, top: 9, prop }], [prop])
  let walking = withoutSpent(blocked, (p) => toil.spent(p, f.now))
  assertEquals(fits(blocked, 5, 5, 5), false)
  let spent = () =>
    toil.tick(v, f, false, false, natural).nodes.find((n) =>
      n.eid == as.target
    )!.spent
  assertEquals(spent(), true)
  assertEquals(fits(walking, 5, 5, 5), true)
  let at = Number(comp(rows[0], 'gathered').at)
  let back = at + respawnOf(as.target, 'wood', at) * 1000
  f.now = back - 1
  assertEquals(spent(), true)
  assertEquals(treesOf(3, 5, natural, rows, f.now), [])
  assertEquals(fits(walking, 5, 5, 5), true)
  f.now = back
  assertEquals(spent(), false)
  assertEquals(treesOf(3, 5, natural, rows, f.now).length, 1)
  assertEquals(fits(walking, 5, 5, 5), false)
})

test('two gathers cannot credit the same node life', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  let item = (eid: string, life: number) => ({
    entity: { eid },
    item: { kind: 'oaklog', n: 1, owner: 'hero', at: life + 1 },
    gathered: { node: 'tree', life, kind: 'oak', at: life + 1 },
  })
  await g.apply([item('first', 0)])
  assertThrows(() => g.apply([item('second', 0)]))
  assertEquals((await g.read('.item.owner=hero')).length, 1)
  await g.apply([item('third', 3600000)])
  assert((await g.read('.item.owner=hero')).length == 2)
})
