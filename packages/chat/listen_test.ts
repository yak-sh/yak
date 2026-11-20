// Listening on a toy platform's socket over fake sockets and timers: it
// opens on an alarm, beats when due, reconnects when told or dropped, stops
// on a close its platform says is final, and follows its credential.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Platform, Said, Socket as Steps } from './mod.ts'
import { listener, type Socket } from './listen.ts'

type Toy = { opened: number }
let toy: Platform = {
  name: 'toy',
  title: 'Toy',
  limit: 100,
  send: () => Promise.resolve({}),
  socket: (token) =>
    ({
      start: { opened: 0 },
      url: (s) => `wss://toy/${token}/${s.opened}`,
      step: (s, f) => {
        let frame = f as { hello?: number; say?: string; again?: boolean }
        if (frame.hello) {
          return { state: { opened: s.opened + 1 }, every: frame.hello }
        }
        if (frame.say) {
          let said: Said = {
            id: frame.say,
            room: 'r',
            author: { id: 'a', name: 'A' },
            text: frame.say,
            at: '2026-11-20T00:00:00Z',
          }
          return { state: s, heard: [said] }
        }
        return { state: s, again: !!frame.again }
      },
      beat: (s) => ({ state: s, send: [{ beat: s.opened }] }),
      ends: (code) => code == 4004 ? 'bad token' : undefined,
    }) satisfies Steps<Toy> as Steps<unknown>,
}

let rig = (token: string | null = 'T') => {
  let kept = { token }
  let opened: {
    url: string
    sent: unknown[]
    fire: Record<string, (e: { data?: unknown; code?: number }) => void>
    closed?: number
  }[] = []
  let beats: (() => void)[] = []
  let soon: (() => void)[] = []
  let heard: string[] = []
  let reported: string[] = []
  let l = listener({
    platform: toy,
    credential: () => Promise.resolve(kept.token ?? undefined),
    open: (url) => {
      let o: (typeof opened)[number] = { url, sent: [], fire: {} }
      opened.push(o)
      let s: Socket = {
        send: (t) => o.sent.push(JSON.parse(t)),
        close: (code) => o.closed = code,
        addEventListener: (type, fn) => o.fire[type] = fn,
      }
      return Promise.resolve(s)
    },
    heard: (said) => {
      heard.push(...said.map((s) => s.text))
      return Promise.resolve()
    },
    report: (e) => reported.push((e as Error).message),
    every: (_, fn) => {
      beats.push(fn)
      return () => beats.splice(beats.indexOf(fn), 1)
    },
    later: (_, fn) => void soon.push(fn),
  })
  let frame = async (f: unknown) => {
    opened.at(-1)!.fire.message({ data: JSON.stringify(f) })
    await new Promise((r) => setTimeout(r, 0))
  }
  let run = async () => {
    for (let fn of soon.splice(0)) fn()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { l, kept, opened, beats, heard, reported, frame, run }
}

test('an alarm opens the socket once; what is said is heard, and beats go when due', async () => {
  let { l, opened, beats, heard, frame } = rig()
  assertEquals(l.status(), { open: false })
  await Promise.all([l.alarm(), l.alarm()])
  assertEquals(opened.map((o) => o.url), ['wss://toy/T/0'])
  await frame({ hello: 10 })
  await frame({ say: 'hi' })
  beats[0]()
  assertEquals([heard, opened[0].sent], [['hi'], [{ beat: 1 }]])
  assertEquals(await l.alarm(), { open: true })
  assertEquals(opened.length, 1)
})

test('told to reconnect, or dropped, it opens again where its state left off', async () => {
  let { l, opened, beats, frame, run } = rig()
  await l.alarm()
  await frame({ hello: 10 })
  await frame({ again: true })
  assertEquals([opened[0].closed, beats.length], [4000, 0])
  await run()
  assertEquals(opened.map((o) => o.url), ['wss://toy/T/0', 'wss://toy/T/1'])
  opened[1].fire.close({ code: 1006 })
  await run()
  assertEquals(opened.length, 3)
})

test('a final close stops it, says why, and an alarm does not reopen it', async () => {
  let { l, opened, reported, run } = rig()
  await l.alarm()
  opened[0].fire.close({ code: 4004 })
  await run()
  assertEquals(l.status(), { open: false, ended: 'bad token' })
  assertEquals(reported, ['Toy closed its socket: bad token'])
  await l.alarm()
  assertEquals(opened.length, 1)
  l.close()
  await l.alarm()
  assertEquals(opened.length, 2)
})

test('with no bot kept it waits, and says so', async () => {
  let { l, opened } = rig(null)
  assertEquals(await l.alarm(), {
    open: false,
    waiting: 'no Toy bot is kept yet',
  })
  assertEquals(opened.length, 0)
})

test('a new credential starts afresh, even after a final close, and none closes the socket', async () => {
  let { l, kept, opened, frame } = rig()
  await l.alarm()
  await frame({ hello: 10 })
  opened[0].fire.close({ code: 4004 })
  kept.token = 'U'
  await l.alarm()
  assertEquals(opened.map((o) => o.url), ['wss://toy/T/0', 'wss://toy/U/0'])
  kept.token = null
  assertEquals(await l.alarm(), {
    open: false,
    waiting: 'no Toy bot is kept yet',
  })
  assertEquals(opened[1].closed, 4000)
})

test('closed, it opens nothing it had begun before', async () => {
  let { l, opened, frame, run } = rig()
  await l.alarm()
  await frame({ again: true })
  l.close()
  await run()
  assertEquals([opened.length, l.status()], [1, { open: false }])
})
