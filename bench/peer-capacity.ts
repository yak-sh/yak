// Local process CPU for populated area/reference subscription fan-out.
// deno run -A bench/peer-capacity.ts 100
// Includes simulated clients and serialization; not Cloudflare Store CPU.
import process from 'node:process'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { queue, type Sink, subscriptions } from '@yaks/api'
import { appVocab } from '../workers/yak/vocab.ts'
import { seedThemes } from '../apps/vale/themes_fixture.ts'
import { areaOf, looksOf, placeOf, REACH } from '../apps/vale/area.ts'
import { SIZE } from '../apps/vale/levels.ts'

let count = Number(Deno.args[0] ?? 100)
let v = appVocab(
  await Deno.readTextFile(new URL('../apps/vale/vocab.json', import.meta.url)),
)
let g = graph({ storage: ram(v), vocab: v })
let subs = subscriptions(g)
seedThemes()
let center = SIZE / 2, area = areaOf(center, center, REACH)
let players = Array.from({ length: count }, () => crypto.randomUUID())
let rows: Bundle[] = players.flatMap((eid, i) => [
  { entity: { eid }, player: {} },
  {
    entity: { eid: crypto.randomUUID() },
    look: { player: eid, name: `Hero ${i}` },
  },
])
for (let i = 0; i < 1282; i++) {
  rows.push({
    entity: { eid: crypto.randomUUID() },
    place: placeOf(center + i % 32, center + Math.floor(i / 32)),
    item: { kind: 'wood', owner: players[0], at: Date.now() },
  })
}
g.apply(rows)
let lags: number[] = [],
  seen = new Set<string>(),
  sends = new Map<string, number>()
let actions = new Set<string>(), actionSeen = new Set<string>()
let frames = 0, bytes = 0, acks = 0
let sinks: Sink[] = []
let records = (hero: string) => [
  `.slain.by=${hero}`,
  `.item.owner=${hero}&?gathered&?crafted`,
  `.used.by=${hero}`,
  `.upgraded.by=${hero}`,
  `.journal.player=${hero}`,
  `.equip.player=${hero}`,
  `.learned.player=${hero}`,
  `.respec.player=${hero}`,
  `.fire.player=${hero}`,
  `.directive.player=${hero}&?created&?companion&.order=-created.at&.limit=10`,
  `.teleport_request.player=${hero}&?created&.order=-created.at&.limit=10`,
]
let cpu = process.cpuUsage(), joined = performance.now()
for (let i = 0; i < count; i++) {
  let q = queue({
    send: (data) => {
      bytes += data.length
      let packet = JSON.parse(data)
      for (let frame of packet.frames ?? [packet]) {
        frames++
        if (frame.refused) throw Error(JSON.stringify(frame.refused))
        for (let row of [...frame.bundles ?? [], ...frame.relay ?? []]) {
          if (actions.has(row.entity.eid)) {
            actionSeen.add(`${i}:${row.entity.eid}`)
          }
          if (players[i] == row.entity.eid) continue
          let key = `${row.entity.eid}:${row.position?.x}`
          let sent = sends.get(key), pair = `${i}:${key}`
          if (sent == null || seen.has(pair)) continue
          seen.add(pair)
          lags.push(performance.now() - sent)
        }
      }
      if (packet.ack) {
        acks++
        q.ack(packet.ack)
      }
    },
  })
  q.enable(true)
  sinks.push(q.send)
  for (
    let [id, line] of [
      ...area.tiles.map((t) => t.query),
      area.moving,
      looksOf(area, players[i]),
      `.entity.eid=${players[i]}&*`,
      ...records(players[i]),
    ].entries()
  ) {
    await subs.open(q.send, String(id), line)
  }
}
console.log(
  JSON.stringify({
    phase: 'join',
    clients: count,
    rows: rows.length,
    wall_ms: performance.now() - joined,
    local_process_cpu_us: process.cpuUsage(cpu),
    frames,
    bytes,
    acks,
  }),
)
frames = bytes = acks = 0
cpu = process.cpuUsage()
let from = performance.now()
for (let tick = 0; tick < 4; tick++) {
  let x = center + 100 + tick / 10
  let done = players.map((eid, i) => {
    sends.set(`${eid}:${x}`, performance.now())
    return (subs.enqueue ?? subs.relay)(sinks[i], [{
      entity: { eid },
      position: { level: 'mossvale', x, y: 0, z: center, at: Date.now() },
      motion: { yaw: 0, gait: 'walk', vx: 1, vy: 0, vz: 0 },
    }])
  })
  await Promise.all(done)
  let eid = crypto.randomUUID()
  actions.add(eid)
  g.apply([{
    entity: { eid },
    item: { kind: 'wood', owner: players[tick] },
    place: placeOf(center + tick, center),
  }])
  await new Promise((done) => setTimeout(done, 150))
}
let wall = performance.now() - from
lags.sort((a, b) => a - b)
console.log(
  JSON.stringify({
    phase: 'movement',
    clients: count,
    wall_ms: wall,
    local_process_cpu_us: process.cpuUsage(cpu),
    observations: seen.size,
    expected: count * (count - 1) * 4,
    actions: actionSeen.size,
    frames,
    bytes,
    acks,
    p95_ms: lags[Math.floor(lags.length * .95)],
    p99_ms: lags[Math.floor(lags.length * .99)],
  }),
)
for (let sink of sinks) await subs.drop(sink)
