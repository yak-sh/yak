// The owner can request a safe move; the hero answers only the latest request,
// and a saved acknowledgment keeps that move from replaying on another page.
import {
  assertEquals,
  assertObjectMatch,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Bundle } from './net.ts'
import type { Net } from './net.ts'
import type { Intent } from './input.ts'
import { game } from './play.ts'
import { destinationOf, nextTeleport } from './teleport.ts'
import { flat, vale } from './terrain.ts'
import { workerOf } from './worker.js'

Deno.test('teleport destinations stay in their land and refuse unsafe coordinates', () => {
  let world = vale()
  let named = destinationOf(world, { level: 'tombsands' })
  assertEquals(named.level, 'tombsands')
  assertEquals(destinationOf(world, { x: named.x, z: named.z }), named)
  let blocked = flat(5, [{ x: 10, z: 10, r: 0.5, top: 9 }])
  assertThrows(
    () => destinationOf(blocked, { x: 10, z: 10 }),
    Error,
    'not a walkable place',
  )
  assertThrows(
    () => destinationOf(blocked, { x: Infinity, z: 10 }),
    Error,
    'finite world metres',
  )
})

Deno.test('a seen acknowledgment consumes the latest admin move', () => {
  let request = (eid: string, at: string): Bundle => ({
    entity: { eid },
    created: { at },
    teleport_request: { player: 'hero', level: 'mossvale', x: 10, z: 10 },
  })
  let old = request('old', '2026-09-28T01:00:00Z')
  let newest = request('new', '2026-09-28T02:00:00Z')
  let rows = [old, newest]
  assertEquals(
    nextTeleport(rows, 'hero', undefined, undefined)?.entity.eid,
    'new',
  )
  assertEquals(nextTeleport(rows, 'hero', 'new', undefined), null)
  assertEquals(nextTeleport(rows, 'hero', undefined, 'new'), null)
})

Deno.test('the teleport worker admits owner and refuses editor', async () => {
  let wrote: Bundle[] = []
  let env = {
    STORE: {
      fetch: (path: string, init?: RequestInit) => {
        if (path.startsWith('query?')) {
          return Promise.resolve(Response.json([{
            entity: { eid: 'hero' },
            player: {},
          }]))
        }
        wrote = JSON.parse(String(init?.body)).entities
        return Promise.resolve(Response.json({ ok: true, bundles: wrote }))
      },
    },
  }
  let worker = workerOf(flat(5))
  let ask = (role: string, x: number) =>
    new Request('https://yourname.yaks.app/vale/teleport', {
      method: 'POST',
      headers: { 'x-yak-role': role, 'content-type': 'application/json' },
      body: JSON.stringify({ player: 'hero', x, z: 50 }),
    })
  let denied = await worker.fetch(ask('editor', 50), env)
  assertEquals(denied.status, 403)
  assertEquals(wrote.length, 0)
  let unsafe = await worker.fetch(ask('owner', Number.MAX_SAFE_INTEGER), env)
  assertEquals(unsafe.status, 400)
  assertStringIncludes(await unsafe.text(), 'finite world metres')
  assertEquals(wrote.length, 0)
  let accepted = await worker.fetch(ask('owner', 50), env)
  assertEquals(accepted.status, 200)
  assertEquals(wrote[0].teleport_request, {
    player: 'hero',
    level: 'mossvale',
    x: 50,
    z: 50,
  })
})

Deno.test('teleport targets live positions and stored companion spots', async () => {
  let target = '01234567-89ab-cdef-0123-456789abcdef'
  let wrote: Bundle[] = []
  let present = true
  let stored = false
  let env = {
    STORE: {
      fetch: (path: string, init?: RequestInit) => {
        if (path.startsWith('query?live=1')) {
          return Promise.resolve(Response.json(
            present
              ? [{
                entity: { eid: target },
                position: { level: 'mossvale', x: 50, z: 50 },
              }]
              : [],
          ))
        }
        if (path.startsWith('query?')) {
          if (path.includes(target)) {
            return Promise.resolve(Response.json([{
              entity: { eid: target },
              player: {},
              seen: { level: 'mossvale', x: 90, z: 90 },
              ...(stored ? { companion: { x: 51, z: 52 } } : {}),
            }]))
          }
          return Promise.resolve(Response.json([{
            entity: { eid: 'hero' },
            player: {},
          }]))
        }
        wrote = JSON.parse(String(init?.body)).entities
        return Promise.resolve(Response.json({ ok: true, bundles: wrote }))
      },
    },
  }
  let ask = (to: string) =>
    new Request('https://yourname.yaks.app/vale/teleport', {
      method: 'POST',
      headers: { 'x-yak-role': 'owner' },
      body: JSON.stringify({ player: 'hero', to }),
    })
  let worker = workerOf(flat(5))
  let moved = await worker.fetch(ask(target), env)
  assertEquals(moved.status, 200)
  assertEquals(wrote[0].teleport_request, {
    player: 'hero',
    level: 'mossvale',
    x: 50,
    z: 50,
  })
  present = false
  let absent = await worker.fetch(ask(target), env)
  assertEquals(absent.status, 404)
  assertStringIncludes(await absent.text(), 'no usable position')
  assertEquals(wrote.length, 1)
  stored = true
  let resumed = await worker.fetch(ask(target), env)
  assertEquals(resumed.status, 200)
  assertEquals(wrote[0].teleport_request, {
    player: 'hero',
    level: 'mossvale',
    x: 51,
    z: 52,
  })
})

Deno.test('teleport can meet a villager at their current world position', async () => {
  let wrote: Bundle[] = []
  let env = {
    STORE: {
      fetch: (path: string, init?: RequestInit) => {
        if (path.startsWith('query?live=1')) {
          return Promise.resolve(Response.json([]))
        }
        if (path.startsWith('query?')) {
          return Promise.resolve(
            Response.json(
              path.includes('hero')
                ? [{ entity: { eid: 'hero' }, player: {} }]
                : [],
            ),
          )
        }
        wrote = JSON.parse(String(init?.body)).entities
        return Promise.resolve(Response.json({ ok: true, bundles: wrote }))
      },
    },
  }
  let worker = workerOf(vale())
  let moved = await worker.fetch(
    new Request('https://yourname.yaks.app/vale/teleport', {
      method: 'POST',
      headers: { 'x-yak-role': 'owner' },
      body: JSON.stringify({ player: 'hero', to: 'wren' }),
    }),
    env,
  )
  assertEquals(moved.status, 200)
  assertObjectMatch(wrote[0], {
    teleport_request: { player: 'hero', level: 'mossvale' },
  })
})

Deno.test('an active hero moves once and a returning hero keeps the move', () => {
  let hero = 'hero', request = 'request', now = 1000
  let rows = new Map<string, Bundle>([[hero, {
    entity: { eid: hero },
    player: {},
    seen: {
      level: 'mossvale',
      x: 70,
      z: 70,
      yaw: 0,
      at: '2026-09-28T00:00:00Z',
    },
    position: { level: 'mossvale', x: 70, y: 5, z: 70, at: now },
    motion: { yaw: 0, gait: 'idle', vy: 0, vx: 0, vz: 0 },
  }]])
  let requests: Bundle[] = [{
    entity: { eid: request },
    created: { at: '2026-09-28T01:00:00Z' },
    teleport_request: { player: hero, level: 'mossvale', x: 50, z: 50 },
  }]
  let net = {
    client: {
      ent: (eid: string) => rows.get(eid),
      watch: () => ({ value: [] }),
    },
    hero,
    now: () => now,
    mine: (name: string) => name == 'teleport_request' ? requests : [],
    who: () => null,
    falls: () => [],
    follow: () => {},
    players: () => [],
    settled: () => true,
    keep: () => {},
    move: (bundles: Bundle[]) => {
      for (let b of bundles) {
        rows.set(b.entity.eid, { ...rows.get(b.entity.eid), ...b })
      }
    },
    tick: () => {},
  } as unknown as Net
  let still: Intent = {
    move: [0, 0],
    turn: 0,
    faceMove: false,
    jump: false,
    strike: false,
    ability: 0,
    dodge: false,
    talk: false,
    gather: false,
    drink: false,
    snap: false,
    mic: false,
    orbit: [0, 0],
    look: false,
    zoom: 0,
  }
  let v = flat(5)
  let play = game(net)
  let first = play.frame(v, still, 0, 0.016)!
  assertEquals([first.body.x, first.body.z, first.teleported], [
    50,
    50,
    request,
  ])
  now += 100
  let second = play.frame(v, still, 0, 0.016)!
  assertEquals(second.teleported, null)
  rows.set(hero, {
    ...rows.get(hero)!,
    seen: {
      level: 'mossvale',
      x: 50,
      z: 50,
      yaw: 0,
      at: '2026-09-28T01:00:01Z',
      teleport: request,
    },
  })
  let returned = game(net).frame(v, still, 0, 0.016)!
  assertEquals([returned.body.x, returned.body.z, returned.teleported], [
    50,
    50,
    null,
  ])
})
