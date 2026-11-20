import { equal, test } from '@yaks/testing'
import { admitter, fits, NEED, room, roomOf } from './room.ts'

let GB = 1024 ** 3
let pressure = (avg10: number) =>
  `some avg10=${avg10} avg60=0.10 avg300=0.42 total=3197474\n` +
  `full avg10=0.00 avg60=0.02 avg300=0.12 total=1207753\n`
let text = (kb: number, avg10: number) =>
  `MemTotal: 25165824 kB\nMemAvailable:   ${kb} kB\nSwapFree: 1 kB\n` +
  pressure(avg10)

test('a room is read from meminfo and memory pressure', async () => {
  equal(roomOf(text(1024, 12.5)), { available: 1024 ** 2, pressure: 12.5 })
  let transport = { execute: () => Promise.resolve(text(2048, 0)) }
  equal((await room(transport)).available, 2 * 1024 ** 2)
})

test('room uses free memory and reclaimable cache without MemAvailable', () => {
  let out = pressure(1.25) + 'MemTotal: 25165824 kB\n' +
    'MemFree: 1024 kB\nBuffers: 256 kB\nCached: 1024 kB\nShmem: 256 kB\n'
  equal(roomOf(out), { available: 2 * 1024 ** 2, pressure: 1.25 })
})

test('a total-only meminfo uses the machine cgroup usage', () => {
  let out = pressure(0) + 'MemTotal: 25165824 kB\n'
  equal(roomOf(out + `CgroupMemory: ${8 * GB} ${3 * GB}\n`).available, 5 * GB)
  equal(roomOf(out + `CgroupMemory: max ${20 * GB}\n`).available, 4 * GB)
  equal(roomOf(out + `CgroupMemory: ${8 * GB} ${9 * GB}\n`).available, 0)
  equal(fits(roomOf(out)), false)
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
