// A waiting call looks often at first and seldom later: a short command still
// answers promptly, while a long wait costs few looks.
import { clock, equal, ok, test } from '@yaks/testing'
import { follow, settle } from './workspace.ts'

// Wait up to `ms` on a command ending `after` ms in, on a virtual clock.
// Polling every 100 ms would look ten times a second.
let waited = async (after: number, ms: number) => {
  let time = clock(), looks = 0
  let p = await settle(
    {
      look: () => {
        looks++
        return Promise.resolve(
          time.now() >= after ? { pid: 1, exit: { code: 0 } } : { pid: 1 },
        )
      },
    },
    'p',
    { ms, now: time.now, sleep: (gap) => time.advance(gap) },
  )
  let at = time.now()
  return { looks, at, ended: p?.exit != null, few: looks <= 10 + at / 1_000 }
}

test('a short command is answered within its first look interval', async () => {
  let { at, ended } = await waited(200, 5_000)
  ok(ended && at - 200 < 100)
})

for (let [after, ms] of [[10_000, 60_000], [120_000, 600_000]]) {
  test(`a ${after / 1000}s command costs a look a second, and is answered within two`, async () => {
    let { looks, at, ended, few } = await waited(after, ms)
    ok(ended && at - after <= 2_000)
    ok(few, `${looks} looks`)
  })
}

test('a command outliving its wait is still running at the deadline, after few looks', async () => {
  let { looks, at, ended, few } = await waited(Infinity, 600_000)
  equal([ended, at], [false, 600_000])
  ok(few, `${looks} looks`)
})

// A command printing a chunk every `every` ms, followed on a virtual clock.
let followed = async (chunks: string[], every: number) => {
  let time = clock(), printed = '', looks = 0
  let end = chunks.length * every
  let said = () => chunks.slice(0, Math.floor(time.now() / every)).join('')
  let p = await follow(
    {
      look: () => {
        looks++
        return Promise.resolve(
          time.now() >= end ? { pid: 1, exit: { code: 3 } } : { pid: 1 },
        )
      },
      output: (_, from) =>
        Promise.resolve(new TextEncoder().encode(said().slice(from))),
    },
    'p',
    (bytes) => {
      printed += new TextDecoder().decode(bytes)
    },
    { sleep: (gap) => time.advance(gap) },
  )
  return { printed, exit: p?.exit, late: time.now() - end, looks }
}

test('following a command passes on all it printed, in order, with its exit', async () => {
  let { printed, exit, late, looks } = await followed(['a', 'b', 'c'], 5_000)
  equal([printed, exit], ['abc', { code: 3 }])
  ok(late <= 1_000, `${late} ms late`)
  ok(looks <= 30, `${looks} looks`)
})
