import { equal, test } from '@yaks/testing'
import { admitter, NEED, room, roomOf } from './room.ts'

let GB = 1024 ** 3
let text = (kb: number, avg10: number) =>
  `MemTotal: 25165824 kB\nMemAvailable:   ${kb} kB\nSwapFree: 1 kB\n` +
  `some avg10=${avg10} avg60=0.10 avg300=0.42 total=3197474\n` +
  `full avg10=0.00 avg60=0.02 avg300=0.12 total=1207753\n`

test('a room is read from meminfo and memory pressure', async () => {
  equal(roomOf(text(1024, 12.5)), { available: 1024 ** 2, pressure: 12.5 })
  let said = ''
  let transport = {
    execute: (s: string) => (said = s, Promise.resolve(text(2048, 0))),
  }
  equal((await room(transport)).available, 2 * 1024 ** 2)
  equal(said, 'cat /proc/meminfo /proc/pressure/memory')
})

// How many of `n` starts are admitted, at `gb` free and `avg10` pressure, the
// clock at `at` for each.
let admitted = async (gb: number, avg10: number, at: number[]) => {
  let i = 0
  let admit = admitter(
    () => Promise.resolve({ available: gb * GB, pressure: avg10 }),
    NEED,
    () => at[Math.min(i++, at.length - 1)],
  )
  return (await Promise.all(at.map(() => admit()))).filter(Boolean).length
}

test('a burst is admitted only as far as the room holds it', async () => {
  equal(await admitted(13, 0, [0, 0, 0, 0, 0, 0]), 3)
  equal(await admitted(3, 0, [0]), 0)
})

test('a pressed machine admits nothing, however much is free', async () => {
  equal(await admitted(20, 10, [0]), 0)
})

test('a reservation lapses once its run has settled', async () => {
  equal(await admitted(5, 0, [0, 1, NEED.settle]), 2)
})
