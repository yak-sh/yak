import { equal, test } from '@yaks/testing'
import { milliseconds } from './rusage.ts'

let usage = () => new DataView(new ArrayBuffer(144))

test('Darwin CPU time ignores padding after 32-bit microseconds', () => {
  let view = usage()
  view.setBigInt64(0, 2n, true)
  view.setInt32(8, 250_000, true)
  view.setUint32(12, 0xdeadbeef, true)
  view.setBigInt64(16, 1n, true)
  view.setInt32(24, 750_000, true)
  view.setUint32(28, 0xffffffff, true)
  equal(milliseconds(view, 32), 4000)
})

test('Linux CPU time decodes 64-bit timeval seconds and microseconds', () => {
  let view = usage()
  view.setBigInt64(0, 0x1_0000_0000n, true)
  view.setBigInt64(8, 125_000n, true)
  view.setBigInt64(16, 2n, true)
  view.setBigInt64(24, 375_000n, true)
  equal(milliseconds(view, 64), 0x1_0000_0000 * 1000 + 2500)
})
