// The writer baton is what makes a deploy single-writer (T-20223): a successor
// must WAIT for the predecessor's baton, never write beside it. These probes
// drive real advisory locks on a throwaway file — the mechanism is the point,
// so they ride the slow tier. flock is per open-file-description on Linux, so
// two opens of one path contend even inside this one process, which lets the
// contention cases run without spawning a second server.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { takeBaton } from './baton.ts'
import { slow } from './testing.ts'

let tmp = () => `${Deno.makeTempDirSync()}/graph.db`

// An instant stand-in for the poll delay, so the waiting cases prove their
// logic without burning real milliseconds.
let now = () => Promise.resolve()

slow(':memory: never contends — the baton is a no-op', async () => {
  assertEquals(await takeBaton(':memory:'), undefined)
  assertEquals(await takeBaton(':memory:', { wait: true }), undefined)
})

slow('a free graph is taken; a second sole taker is refused', async () => {
  let db = tmp()
  let held = await takeBaton(db)
  try {
    let e = await assertRejects(() => takeBaton(db, { rest: now }))
    assertStringIncludes((e as Error).message, 'already held')
    assertStringIncludes((e as Error).message, db)
  } finally {
    held!.close()
  }
  // Released (the holder closed), so a fresh sole taker takes it again.
  let again = await takeBaton(db)
  again!.close()
})

slow(
  'a successor waits, then takes the baton the predecessor drops',
  async () => {
    let db = tmp()
    let pred = await takeBaton(db)
    let polls = 0
    // Drop the predecessor's baton after a couple of polls — the kernel release
    // a real exit would do. The waiter must then acquire it.
    let rest = () => {
      if (++polls == 2) pred!.close()
      return Promise.resolve()
    }
    let succ = await takeBaton(db, { wait: true, rest })
    assertEquals(polls, 2) // it waited, it did not fail open
    succ!.close()
  },
)

slow('a predecessor that never lets go trips the deadline', async () => {
  let db = tmp()
  let pred = await takeBaton(db)
  try {
    let e = await assertRejects(() =>
      // A tiny deadline + instant polls: the loop runs out without a release.
      takeBaton(db, { wait: true, deadlineMs: 0, rest: now })
    )
    assertStringIncludes((e as Error).message, 'did not release')
  } finally {
    pred!.close()
  }
})
