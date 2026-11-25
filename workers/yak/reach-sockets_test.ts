// A tab's sockets at its stores (reach.ts `socketsOf`): the lines it watches
// at one store share one socket there, and a socket that keeps dropping
// backs off rather than coming straight back.
import { clock, equal, test } from '@yaks/testing'
import type { Frame } from '@yaks/reach'
import type { Door } from '@yaks/durable-object/door'
import { socketsOf } from './reach.ts'

type Socket = {
  said: unknown[]
  closed: boolean
  answer: (id: string, frame: Frame) => void
  drop: () => void
}

// A store whose every socket is kept, to answer and drop as a test says.
let store = () => {
  let sockets: Socket[] = []
  let door = (async () => {
    let heard: Record<string, ((e: { data?: unknown }) => void)[]> = {}
    let fire = (type: string, data?: unknown) =>
      (heard[type] ?? []).forEach((fn) => fn({ data }))
    let socket: Socket = {
      said: [],
      closed: false,
      answer: (id, frame) => fire('message', JSON.stringify({ ...frame, id })),
      drop: () => {
        socket.closed = true
        fire('close')
      },
    }
    sockets.push(socket)
    return Object.assign(new Response(null), {
      webSocket: {
        accept: () => {},
        send: (text: string) => socket.said.push(JSON.parse(text)),
        close: () => void (socket.closed = true),
        addEventListener: (type: string, fn: (e: { data?: unknown }) => void) =>
          (heard[type] ??= []).push(fn),
      },
    })
  }) as unknown as Door
  return { door, sockets }
}

let rows = [{ entity: { eid: 'a' } }]

test('the lines a tab watches at one store share one socket, each hearing its own answers', async () => {
  let c = clock()
  let { door, sockets } = store()
  let watch = socketsOf({ clock: c })
  let heard: Record<string, Frame[]> = { one: [], two: [], three: [] }
  let stop = Object.keys(heard).map((line) =>
    watch(door, 'directory', line, (f) => heard[line].push(f), { p: 'ada' })
  )
  await c.advance(0)
  equal(sockets.length, 1)
  equal(sockets[0].said, [
    { subscribe: 'one', id: 'w0' },
    { subscribe: 'two', id: 'w1' },
    { subscribe: 'three', id: 'w2' },
  ])
  sockets[0].answer('w1', { bundles: rows })
  equal(heard, { one: [], two: [{ bundles: rows }], three: [] })

  // Another caller, or a line with something to say, has a socket of its own.
  watch(door, 'directory', 'one', () => {}, { p: 'bea' })
  watch(door, 'directory', 'one', () => {}, { p: 'ada' }, '/ws', () => () => {})
  await c.advance(0)
  equal(sockets.length, 3)

  stop[0]()
  equal(sockets[0].said.at(-1), { unsubscribe: 'w0' })
  stop[1]()
  stop[2]()
  equal(sockets[0].closed, true)
})

test('a socket that keeps dropping waits longer each time, until one holds ten seconds', async () => {
  let c = clock()
  let { door, sockets } = store()
  let heard: Frame[] = []
  socketsOf({ clock: c, random: () => 1 })(
    door,
    'operator',
    'waiting',
    (f) => heard.push(f),
    {},
  )
  await c.advance(0)
  // How long the newest socket, answered then dropped, waits to open again.
  let waited = async (held = 0) => {
    let socket = sockets.at(-1)!
    socket.answer(String((socket.said[0] as { id: string }).id), {
      bundles: rows,
    })
    await c.advance(held)
    socket.drop()
    let before = sockets.length, start = c.now()
    while (sockets.length == before) await c.advance(100)
    return c.now() - start
  }
  equal([await waited(), await waited(), await waited()], [1000, 2000, 4000])
  equal(await waited(10_000), 1000)
  // Each answer after a socket opened again is said whole.
  equal(heard.map((f) => !!f.reset), [false, true, true, true])
})
