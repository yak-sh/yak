// Saved peer state crosses the kernel's vouched socket door and the store's
// ordinary apply guard. HTTP reads prove that it reached persistent storage.
import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import {
  client,
  connector,
  type Kernel,
  relay,
  seed,
  workerd,
} from './probe.ts'
import { browserOf } from './session.ts'

type Row = {
  entity: { eid: string }
  hero?: { name: string }
  position?: { x: number; z: number }
  cursor?: { x: number }
  doc?: { title: string }
  created?: { by?: unknown; via?: unknown }
  updated?: { by?: unknown; via?: unknown }
}
type Frame = { id?: string; bundles?: Row[]; relay?: Row[]; refused?: unknown }

let idOf = (v: unknown) =>
  typeof v == 'string' ? v : (v as { eid?: string } | undefined)?.eid
let kept = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]

let socket = async (origin: string) => {
  let ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/arena/api/ws`)
  let frames: Frame[] = []
  ws.addEventListener('message', (e) => frames.push(JSON.parse(e.data)))
  await until(() => ws.readyState == WebSocket.OPEN, {
    timeout: 15_000,
    label: 'the app socket opens',
  })
  return {
    ws,
    frames,
    send: (frame: unknown) => ws.send(JSON.stringify(frame)),
    heard: async (fact: (frame: Frame) => boolean) => {
      await until(() => frames.some(fact), {
        timeout: 15_000,
        label: 'the app socket answers',
      })
    },
  }
}

let arena = async (
  save: string,
  run: (p: {
    k: Kernel
    host: string
    owner: Awaited<ReturnType<typeof seed>>
    hero: string
    cookie: string
    via: string
    page: ReturnType<typeof client>
    writer: Awaited<ReturnType<typeof socket>>
    observer: Awaited<ReturnType<typeof socket>>
    connect: (cookie: string) => Promise<Awaited<ReturnType<typeof socket>>>
    row: () => Promise<Row>
  }) => Promise<void>,
) => {
  let k = workerd()
  let space = `save${crypto.randomUUID().slice(0, 8)}`
  let host = `${space}.yaks.app`
  let owner = await seed(k, [{ slug: space, apps: ['arena'] }])
  let agent = connector(k, owner.cookie)
  let wires: Awaited<ReturnType<typeof relay>>[] = []
  let sockets: Awaited<ReturnType<typeof socket>>[] = []
  try {
    let at = { space, app: 'arena' }
    await agent.tool('app_set', { ...at, access: 'open' })
    await agent.tool('app_files', {
      ...at,
      files: [{
        path: 'vocab.json',
        content: JSON.stringify({
          $defs: {
            hero: { properties: { name: { type: 'string' } } },
            position: {
              sync: 'peers',
              durable: 'forever',
              save,
              properties: { x: { type: 'number' }, z: { type: 'number' } },
            },
            cursor: {
              sync: 'peers',
              durable: 'connection',
              pace: '100ms',
              properties: { x: { type: 'number' } },
            },
          },
        }),
      }],
    })
    await agent.tool('app_deploy', at)
    let hero = crypto.randomUUID()
    let first = await client(k, host, 'arena').post([{
      entity: { eid: hero },
      hero: { name: 'Guest hero' },
      doc: { title: 'Before moving' },
      $actor: { by: owner.person, via: 'invented' },
    }])
    let cookie = kept(first)
    assertEquals(first.status, 200, await first.text())
    let browser = await browserOf(
      new Request(`https://${host}/`, { headers: { cookie } }),
      k.secret,
    )
    assert(browser, 'the guest has a vouched instrument')
    let page = client(k, host, 'arena', cookie)
    let connect = async (cookie: string) => {
      let wire = await relay(k, host, cookie, `https://${host}`)
      wires.push(wire)
      let one = await socket(wire.origin)
      sockets.push(one)
      return one
    }
    let writer = await connect(cookie)
    let observer = await connect(owner.cookie)
    observer.send({ subscribe: '.hero&?position&?cursor', id: 'heroes' })
    await observer.heard((f) => f.id == 'heroes' && !!f.bundles)
    let row = async () =>
      (await page.get(
        `.entity.eid=${hero}&?hero&?position&?cursor&?doc&?created&?updated`,
      ))[0] as Row
    await run({
      k,
      host,
      owner,
      hero,
      cookie,
      via: browser.via,
      page,
      writer,
      observer,
      connect,
      row,
    })
  } finally {
    for (let one of sockets) one.ws.close()
    try {
      await Promise.all(wires.map((w) => w.stop()))
    } finally {
      try {
        await agent.tool('app_delete', { space, app: 'arena', forever: true })
      } finally {
        await agent.tool('space_delete', { space, forever: true })
        await k.stop()
      }
    }
  }
}

let relayed =
  (eid: string, comp: 'position' | 'cursor', x: number) => (f: Frame) =>
    f.relay?.some((r) => r.entity.eid == eid && r[comp]?.x == x) ??
      false

test('a guest peer position is saved as its vouched writer and rejects a stranger', async () => {
  await arena('!position | .updated.at<="1s ago"', async (p) => {
    let move = (x: number) =>
      p.writer.send({
        relay: [{
          entity: { eid: p.hero },
          position: { x, z: 4 },
          ...(x == 1 ? { cursor: { x: 1 } } : {}),
          $actor: { by: p.owner.person, via: 'invented' },
        }],
      })
    move(1)
    await p.observer.heard(relayed(p.hero, 'position', 1))
    await p.observer.heard(relayed(p.hero, 'cursor', 1))
    await until(async () => (await p.row()).position?.x == 1, {
      timeout: 15_000,
      label: 'the first peer position is stored',
    })
    move(2)
    await p.observer.heard(relayed(p.hero, 'position', 2))
    await until(async () => (await p.row()).position?.x == 2, {
      timeout: 15_000,
      label: 'the latest peer position is stored',
    })
    let saved = await p.row()
    assertEquals(saved.position, { x: 2, z: 4 })
    assertEquals(saved.cursor, undefined)
    assertEquals(idOf(saved.created?.by), undefined)
    assertEquals(idOf(saved.created?.via), p.via)
    assertEquals(idOf(saved.updated?.by), undefined)
    assertEquals(idOf(saved.updated?.via), p.via)

    let visit = await p.k.at(p.host, '/arena/api/query?.hero')
    let stranger = kept(visit)
    await visit.body?.cancel()
    assert(stranger && stranger != p.cookie)
    let other = await p.connect(stranger)
    other.send({
      id: 'stolen',
      relay: [{
        entity: { eid: p.hero },
        position: { x: 99, z: 99 },
        $actor: { by: p.owner.person, via: p.via },
      }],
    })
    await other.heard((f) => f.id == 'stolen' && !!f.refused)
    assertEquals((await p.row()).position, { x: 2, z: 4 })
    assertEquals(p.observer.frames.some(relayed(p.hero, 'position', 99)), false)

    // The HTTP write door continues to admit ordinary durable components.
    await p.page.applied([{
      entity: { eid: p.hero },
      doc: { title: 'After moving' },
    }])
    assertEquals((await p.row()).doc?.title, 'After moving')
  })
})

test('closing a guest socket keeps its final position when its save query becomes true', async () => {
  await arena('!position | .updated.at<="1s ago"', async (p) => {
    let move = (x: number) =>
      p.writer.send({
        relay: [{ entity: { eid: p.hero }, position: { x, z: 8 } }],
      })
    move(1)
    await until(async () => (await p.row()).position?.x == 1, {
      timeout: 15_000,
      label: 'the first position is stored',
    })
    move(2)
    await p.observer.heard(relayed(p.hero, 'position', 2))
    p.writer.ws.close()
    await until(async () => (await p.row()).position?.x == 2, {
      timeout: 15_000,
      label: "the disconnected writer's final position becomes eligible",
    })
    assertEquals((await p.row()).position, { x: 2, z: 8 })
    assertEquals(idOf((await p.row()).updated?.via), p.via)
  })
})
