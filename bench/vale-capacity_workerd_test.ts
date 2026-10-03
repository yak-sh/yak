import { seedThemes } from '../apps/vale/themes_fixture.ts'
import { test } from '@yaks/testing'
// Populated socket capacity benchmark, run only by naming this file:
// CAPACITY_CLIENTS=100 deno task test --all --tag=workerd \
//   bench/vale-capacity_workerd_test.ts
// Repeat with 150 or 200. This drives scratch stores, never a hosted app.
// Workerd exposes wall delivery here, not isolate CPU or billable duration.
import { areaOf, looksOf, REACH } from '../apps/vale/area.ts'
import { SIZE } from '../apps/vale/levels.ts'
import { placeOf } from '../apps/vale/area.ts'
import type { Bundle } from '@yaks/graph'
import {
  client,
  connector,
  relay,
  seed,
  workerd,
} from '../workers/yak/probe.ts'

let path = Deno.env.get('VALE_PROBE_LOG')
let start = performance.now()
let mark = (phase: string, data: Record<string, unknown> = {}) =>
  path
    ? Deno.writeTextFileSync(
      path,
      JSON.stringify({
        phase,
        at_ms: Math.round(performance.now() - start),
        ...data,
      }) + '\n',
      { append: true, create: true },
    )
    : console.log(JSON.stringify({ phase, ...data }))
let limit = <T>(promise: Promise<T>, ms: number, name: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${name} exceeded ${ms}ms`)), ms)
    ),
  ])

test('populated socket capacity', async () => {
  let k = workerd()
  let slug = `capacity${crypto.randomUUID().slice(0, 6)}`
  let host = `${slug}.yaks.app`
  let sockets: WebSocket[] = []
  let tunnel: Awaited<ReturnType<typeof relay>> | undefined
  let packets = 0, frames = 0, acks = 0, bytes = 0, errors = 0
  let socketFaults = 0
  let actions = new Set<string>()
  let delivered = new Set<string>(), arrivals = new Set<string>()
  let lags: number[] = [], sends = new Map<string, number>()
  let latestX = -1
  seedThemes()
  let center = SIZE / 2
  let area = areaOf(center, center, REACH)
  let now = Date.now()
  let clients = Number(Deno.env.get('CAPACITY_CLIENTS') ?? 100)
  let expected = clients * (clients - 1)
  let players = Array.from({ length: clients }, () => crypto.randomUUID())
  mark('begin', { slug, area: area.query, clients, watches: 14 })
  try {
    let person = await limit(
      seed(k, [{ slug, apps: ['vale'] }]),
      12_000,
      'space',
    )
    mark('space')
    let agent = connector(k, person.cookie)
    let vocab = await Deno.readTextFile(
      new URL('../apps/vale/vocab.json', import.meta.url),
    )
    await limit(
      agent.tool('app_files', {
        space: slug,
        app: 'vale',
        op: 'write',
        path: 'vocab.json',
        content: vocab,
      }),
      10_000,
      'vocab file',
    )
    await limit(
      agent.tool('app_deploy', { space: slug, app: 'vale' }),
      10_000,
      'deploy',
    )
    mark('deployed')
    let app = client(k, host, 'vale', person.cookie)
    let rows: Bundle[] = players.flatMap((eid, i) => [
      { entity: { eid }, player: {} },
      {
        entity: { eid: crypto.randomUUID() },
        look: { player: eid, name: `Hero ${i}` },
      },
    ])
    for (let i = 0; i < 1282; i++) {
      let x = center + i % 32, z = center + Math.floor(i / 32)
      rows.push({
        entity: { eid: crypto.randomUUID() },
        place: placeOf(x, z),
        ...(i % 3 == 0
          ? { slain: { creature: `creature-${i}`, by: players[0], at: now } }
          : i % 3 == 1
          ? { item: { kind: 'wood', owner: players[0], at: now } }
          : { gathered: { node: `node-${i}`, life: 0 } }),
      })
    }
    for (let i = 0; i < rows.length; i += 100) {
      await limit(app.applied(rows.slice(i, i + 100)), 6_000, `seed ${i}`)
      mark('seed', { rows: Math.min(i + 100, rows.length) })
    }
    tunnel = await limit(
      relay(k, host, person.cookie, `https://${host}`),
      4_000,
      'relay',
    )
    mark('seeded', { rows: rows.length })
    let records = (hero: string) => {
      let q = JSON.stringify(hero)
      return [
        `.slain.by=${q}`,
        `.item.owner=${q}&?gathered&?crafted`,
        `.used.by=${q}`,
        `.upgraded.by=${q}`,
        `.journal.player=${q}`,
        `.equip.player=${q}`,
        `.learned.player=${q}`,
        `.respec.player=${q}`,
        `.fire.player=${q}`,
        `.directive.player=${q}&?created&?companion&.order=-created.at&.limit=10`,
        `.teleport_request.player=${q}&?created&.order=-created.at&.limit=10`,
      ]
    }
    let open = async (i: number) => {
      let socket = new WebSocket(
        `${tunnel!.origin.replace(/^http/, 'ws')}/vale/api/ws`,
      )
      sockets.push(socket)
      let seen = new Set<string>()
      socket.addEventListener('error', () => socketFaults++)
      socket.addEventListener('close', () => socketFaults++)
      socket.addEventListener('message', (event) => {
        bytes += String(event.data).length
        let packet = JSON.parse(event.data)
        packets++
        for (let frame of packet.frames ?? [packet]) {
          frames++
          if (frame.refused || frame.error) {
            errors++
            mark('refused', { frame })
          }
          seen.add(frame.id)
          for (let row of [...frame.bundles ?? [], ...frame.relay ?? []]) {
            if (actions.has(row.entity.eid)) {
              actions.add(`${i}:${row.entity.eid}`)
            }
            let x = row.position?.x
            let key = `${row.entity.eid}:${x}`
            let sent = sends.get(key)
            if (sent == null || players[i] == row.entity.eid) continue
            let arrival = `${i}:${key}`
            if (arrivals.has(arrival)) continue
            arrivals.add(arrival)
            lags.push(performance.now() - sent)
            if (x == latestX) delivered.add(`${i}:${row.entity.eid}`)
          }
        }
        if (packet.ack) {
          acks++
          socket.send(JSON.stringify({ ack: packet.ack }))
        }
      })
      await limit(
        new Promise<void>((resolve, reject) => {
          socket.addEventListener('open', () => resolve(), { once: true })
          socket.addEventListener('error', reject, { once: true })
        }),
        3_000,
        `socket ${i}`,
      )
      let asks = [
        area.query,
        looksOf(area, players[i]),
        `.entity.eid=${JSON.stringify(players[i])}&?created&*`,
        ...records(players[i]),
      ]
      for (let [id, subscribe] of asks.entries()) {
        socket.send(JSON.stringify({
          subscribe,
          id: String(id),
          acks: true,
          frames: true,
        }))
      }
      await limit(
        new Promise<void>((resolve) => {
          let timer = setInterval(() => {
            if (seen.size == asks.length) {
              clearInterval(timer)
              resolve()
            }
          }, 5)
        }),
        7_000,
        `watch ${i}`,
      )
    }
    let before = performance.now()
    for (let i = 0; i < clients; i++) await open(i)
    mark('joined', {
      ms: Math.round(performance.now() - before),
      packets,
      frames,
      acks,
      bytes,
      errors,
      socketFaults,
    })
    let wait = async (expected: number, since: number) => {
      while (delivered.size < expected && performance.now() - since < 8_000) {
        await new Promise((done) => setTimeout(done, 20))
      }
    }
    let move = (tick: number) => {
      delivered.clear()
      latestX = center + 100 + tick / 10
      for (let i = 0; i < clients; i++) {
        sends.set(`${players[i]}:${latestX}`, performance.now())
        sockets[i].send(JSON.stringify({
          relay: [{
            entity: { eid: players[i] },
            position: {
              level: 'mossvale',
              x: latestX,
              y: 0,
              z: center,
              at: now + tick * 150,
            },
            motion: { yaw: 0, gait: 'walk', vx: 1, vy: 0, vz: 0 },
          }],
        }))
      }
    }
    let summary = (
      phase: string,
      from: number,
      sent: number,
      base: { packets: number; frames: number; acks: number; bytes: number },
    ) => {
      lags.sort((a, b) => a - b)
      let pct = (p: number) =>
        Math.round(lags[Math.floor((lags.length - 1) * p)] ?? 0)
      mark(phase, {
        ms: Math.round(performance.now() - from),
        sent,
        delivered: delivered.size,
        expected,
        observations: lags.length,
        p50_ms: pct(.5),
        p95_ms: pct(.95),
        p99_ms: pct(.99),

        packets: packets - base.packets,
        frames: frames - base.frames,
        acks: acks - base.acks,
        bytes: bytes - base.bytes,
        actionsSeen: actions.size - 3,
        errors,
        socketFaults,
      })
    }
    let counters = () => ({ packets, frames, acks, bytes })
    let base = counters(), from = performance.now()
    move(0)
    await wait(expected, from)
    summary('first_position', from, clients, base)
    await new Promise((done) => setTimeout(done, 250))
    delivered.clear()
    arrivals.clear()
    lags = []
    base = counters()
    from = performance.now()
    let ticks = Number(Deno.env.get('CAPACITY_TICKS') ?? 4)
    for (let tick = 1; tick <= ticks; tick++) {
      move(tick)
      if (tick <= 3) {
        let eid = crypto.randomUUID()
        actions.add(eid)
        let result = await limit(
          app.applied([{
            entity: { eid },
            item: { kind: 'wood', owner: players[tick], at: now + tick * 150 },
            place: placeOf(center + tick, center),
          }]),
          3_000,
          `action ${tick}`,
        )
        let applied = result as unknown as Bundle[]
        if (
          !Array.isArray(applied) ||
          !applied.some((row) => row.entity.eid == eid)
        ) {
          throw new Error(
            `action ${tick} missing eid: ${JSON.stringify(result)}`,
          )
        }
      }
      await new Promise((done) => setTimeout(done, 150))
    }
    await wait(expected, from)
    summary('continuous_and_actions', from, clients * ticks, base)
    if (
      delivered.size != expected || actions.size - 3 != clients * 3 || errors ||
      socketFaults
    ) {
      throw new Error('capacity delivery did not complete cleanly')
    }
  } catch (e) {
    mark('error', {
      error: String(e),
      stack: e instanceof Error ? e.stack : '',
    })
    throw e
  } finally {
    for (let socket of sockets) socket.close()
    await tunnel?.stop()
    await k.stop()
    mark('end', { packets, frames, acks, bytes, errors, socketFaults })
  }
})
