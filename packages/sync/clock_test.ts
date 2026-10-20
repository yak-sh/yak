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
  equal(sockets[0].client.sent, [{ clock: 1000 }])
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
  sockets[0].client.close()
  equal(w.now(), 2220)
  due.shift()!() // obsolete sample timer cannot send
  due.shift()!() // reconnect
  sockets[1].client.emit('open')
  time = 2040
  sockets[1].server.send(
    JSON.stringify({ clock: 2020, received: 1980, sent: 1980 }),
  )
  equal(w.now(), 1990)
  w.close()
  let sent = sockets[1].client.sent.length
  for (let fn of due) fn()
  equal(sockets[1].client.sent.length, sent)
})
