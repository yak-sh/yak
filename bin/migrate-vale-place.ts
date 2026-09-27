// One-time T-40840 migration. Read an admin export of the vale's store, make
// patches for its surviving world rows, and a copy of the app rows to prove
// those patches on a throwaway install. Delete this script after the live run.
import { placeOf } from '../apps/vale/area.ts'
import { nodesOf } from '../apps/vale/gather.ts'
import { homesOf } from '../apps/vale/homes.ts'
import { LEVELS } from '../apps/vale/levels.ts'
import { originOf } from '../apps/vale/regions.ts'
import words from '../apps/vale/vocab.json' with { type: 'json' }

type Row = { entity: { eid: string }; [key: string]: unknown }

let [input, out, app] = Deno.args
if (!input || !out || !app) {
  throw new Error(
    'usage: migrate-vale-place.ts rows.json output-dir space/vale',
  )
}
let rows = JSON.parse(await Deno.readTextFile(input)) as Row[]
let names = Object.entries(words.$defs).filter(([, d]) =>
  'component' in d && d.component
)
  .map(([name]) => name)
let cutoff = Date.parse('2026-09-27T04:34:47Z') // 529acc83
let homes = new Map(
  Object.keys(LEVELS).flatMap((id) => homesOf(id))
    .map((h) => [h.eid, h]),
)
let nodes = new Map(
  Object.keys(LEVELS).flatMap((id) => nodesOf(id))
    .map((n) => [n.eid, n]),
)
let patch = (b: Row, more: Record<string, unknown>) => ({
  $app: app,
  entity: { eid: b.entity.eid },
  ...more,
})

let players: Row[] = [], other: Row[] = [], seen: Row[] = []
let moves: Row[] = []
let counts = {
  homes: homes.size,
  nodes: nodes.size,
  seen: 0,
  creature: 0,
  orphanCreature: 0,
  slain: 0,
  orphanSlain: 0,
  gathered: 0,
  orphanGathered: 0,
}

for (let b of rows) {
  let comps = Object.fromEntries(
    names.filter((name) => b[name] != null)
      .map((name) => [name, b[name]]),
  )
  if (comps.player) players.push(patch(b, { player: comps.player }))
  delete comps.player
  if (comps.seen) seen.push(patch(b, { seen: comps.seen }))
  delete comps.seen
  if (Object.keys(comps).length) other.push(patch(b, comps))

  if (b.creature) {
    let h = homes.get(b.entity.eid)
    if (h) {
      counts.creature++
      moves.push(patch(b, { place: placeOf(...h.home) }))
    } else {
      counts.orphanCreature++
      moves.push(patch(b, { $delete: true }))
    }
  }
  if (b.slain && typeof b.slain == 'object') {
    let h = homes.get(String((b.slain as { creature?: string }).creature))
    if (h) {
      counts.slain++
      moves.push(patch(b, { place: placeOf(...h.home) }))
    } else counts.orphanSlain++ // keep the hero's earned XP and quest history
  }
  if (b.gathered && typeof b.gathered == 'object') {
    let n = nodes.get(String((b.gathered as { node?: string }).node))
    if (n) {
      counts.gathered++
      moves.push(patch(b, { place: placeOf(n.x, n.z) }))
    } else counts.orphanGathered++ // keep the item's trade XP
  }
  if (b.seen && typeof b.seen == 'object') {
    let s = b.seen as { at?: string; level?: string; x?: number; z?: number }
    if (
      Date.parse(s.at ?? '') >= cutoff || typeof s.x != 'number' ||
      typeof s.z != 'number' || !s.level || !LEVELS[s.level]
    ) continue
    let [ox, oz] = originOf(s.level)
    counts.seen++
    moves.push(patch(b, { seen: { x: s.x + ox, z: s.z + oz } }))
  }
}

let save = async (dir: string, bundles: Row[]) => {
  let path = `${out}/${dir}`
  await Deno.mkdir(path, { recursive: true })
  for (let i = 0; i < bundles.length; i += 50) {
    let name = String(i / 50).padStart(4, '0') + '.json'
    await Deno.writeTextFile(
      `${path}/${name}`,
      JSON.stringify(bundles.slice(i, i + 50)),
    )
  }
}
await save('copy/players', players)
await save('copy/other', other)
await save('copy/seen', seen)
await save('moves', moves)
await Deno.writeTextFile(
  `${out}/summary.json`,
  JSON.stringify(
    {
      rows: rows.length,
      copy: { players: players.length, other: other.length, seen: seen.length },
      moves: moves.length,
      ...counts,
    },
    null,
    2,
  ),
)
console.log(await Deno.readTextFile(`${out}/summary.json`))
