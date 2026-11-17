/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { clock, estimate } from './clock.ts'
import { wire } from './socket.ts'
import { pair } from './testing.ts'

test('four clock timestamps remove server work from the round trip', () => {
  equal(estimate(1000, 1110, 1150, 1060), { offset: 100, delay: 20 })
  equal(estimate(1000, 910, 950, 1060), { offset: -100, delay: 20 })
  equal(estimate(1000, 1110, 1100, 1060), undefined)
  equal(estimate(1000, 1110, 1150, 990), undefined)
  equal(estimate(1000, 1110, 1200, 1060), undefined)
  equal(estimate(1000, NaN, 1150, 1060), undefined)
})

test('clock filtering rejects queued trips and ages out old offsets', () => {
  let time = 1060
  let c = clock(() => time)
  equal(c.now(), time)
  c.sample(1000, 1110, 1150)
  equal(c.now(), time + 100)
  // A long inbound queue suggests the wrong offset, but is not our best trip.
  time = 2000
  c.sample(1500, 1610, 1610)
  equal(c.now(), time + 100)
  for (let i = 0; i < 8; i++) {
    time += 1000
    c.sample(time - 20, time + 190, time + 190)
  }
  equal(c.now(), time + 200)
  c.reset()
  equal(c.now(), time + 200)
  c.sample(time - 20, time - 60, time - 60)
  equal(c.now(), time - 50)
})

test('socket clock calibrates, refines, holds through reconnect, and stops on close', () => {
  let time = 1000
  let sockets = [pair(), pair()]
  let next = 0
  let due: (() => void)[] = []
  let w = wire({
    url: 'http://clock.test',
    connect: () => sockets[next++].client,
    time: () => time,
    timer: (fn) => due.push(fn),
    land: () => {
      throw new Error('clock is not a subscription frame')
    },
    report: (e) => {
      if ((e as Error).name != 'Dropped') throw e
    },
  })
  equal(w.now(), 1000) // opens without a subscription
  sockets[0].client.emit('open')
  due.shift()!() // its handshake's deadline, which it met
  equal(sockets[0].client.asked, [1000])
  time = 1060
  sockets[0].server.send(
    JSON.stringify({ clock: 1000, received: 1110, sent: 1150 }),
  )
  equal(w.now(), 1160)
  time = 2000
  due.shift()!()
  // A stale reply must not change the in-flight trip.
  sockets[0].server.send(
    JSON.stringify({ clock: 1000, received: 5000, sent: 5000 }),
  )
  time = 2020
  sockets[0].server.send(
    JSON.stringify({ clock: 2000, received: 2210, sent: 2210 }),
  )
  equal(w.now(), 2220)
  sockets[0].client.close() // it held a second, so it is reopened at once
  equal(w.now(), 2220)
  due.shift()!() // obsolete sample timer cannot send
  sockets[1].client.emit('open')
  time = 2040
  sockets[1].server.send(
    JSON.stringify({ clock: 2020, received: 1980, sent: 1980 }),
  )
  equal(w.now(), 1990)
  w.close()
  let asked = sockets[1].client.asked.length
  for (let fn of due) fn()
  equal(sockets[1].client.asked.length, asked)
})

test('a server that accepts and hangs up waits out a growing backoff; one that held is retried at once', () => {
  let time = 0
  let sockets: ReturnType<typeof pair>[] = []
  let due: { fn: () => void; ms: number }[] = []
  let w = wire({
    url: 'http://drop.test',
    connect: () => (sockets.push(pair()), sockets.at(-1)!.client),
    time: () => time,
    timer: (fn, ms) => due.push({ fn, ms }),
    land: () => {},
    report: () => {},
  })
  w.open()
  // Open the newest socket, close it `after` ms later, and say the timer the
  // reconnect was scheduled on, if one was.
  let hangUp = (after: number) => {
    let s = sockets.at(-1)!.client
    s.emit('open')
    time += after
    let from = due.length
    s.close()
    return due[from]
  }
  let waits = [1, 1, 1, 1].map((after) => {
    let reconnect = hangUp(after)!
    reconnect.fn() // after its wait
    return reconnect.ms
  })
  equal(waits, [250, 500, 1000, 2000])
  let made = sockets.length
  hangUp(60_000) // held a minute, so the next opens at once
  equal(sockets.length, made + 1)
  w.close()
})
