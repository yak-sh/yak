import { equal, ok, test } from '@yaks/testing'
import { cputime, threadtime } from './host.ts'
import { milliseconds, nanos } from './rusage.ts'

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

test('a timespec decodes to milliseconds', () => {
  let view = new DataView(new ArrayBuffer(16))
  view.setBigInt64(0, 3n, true)
  view.setBigInt64(8, 250_000_000n, true)
  equal(nanos(view), 3250)
})

// The worker spins until its own thread has used 5 ms, however busy the box.
// It starts as the file loads: a runtime's first worker costs its starter
// about 2 ms, which is not what the test measures.
let spinner = new Worker(
  `data:text/javascript,${
    encodeURIComponent(`
      import { threadtime } from '${new URL('./host.ts', import.meta.url)}'
      onmessage = () => {
        let end = threadtime() + 5
        while (threadtime() < end);
        postMessage(0)
      }
      postMessage(0)`)
  }`,
  { type: 'module' },
)
let heard = () => new Promise((ok) => spinner.onmessage = ok)
await heard()

test("the thread clock leaves out another thread's work", async () => {
  try {
    let process = cputime(), thread = threadtime()
    let done = heard()
    spinner.postMessage(0)
    await done
    let others = (cputime() - process) - (threadtime() - thread)
    ok(others >= 5, `${others}ms on other threads`)
  } finally {
    spinner.terminate()
  }
})
