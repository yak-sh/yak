// The readiness gate folds two facts: the account is signed in, and the bus
// answers. Signed out never probes; the bus verdict is held for a TTL.
import { assertEquals } from '@std/assert'
import type { AccountStatus } from './accounts.ts'
import { codexReadiness } from './codex_ready.ts'

let status = (ready: boolean): AccountStatus => ({
  provider: 'codex',
  state: ready ? 'ready' : 'signed_out',
  ready,
  auth: ready ? 'chatgpt' : null,
})

Deno.test('signed out is not ready and never touches the bus', async () => {
  let probes = 0
  let ready = codexReadiness(
    () => Promise.resolve(status(false)),
    () => {
      probes++
      return Promise.resolve(true)
    },
  )
  assertEquals(await ready(), false)
  assertEquals(probes, 0)
})

Deno.test('a status failure reads as not ready', async () => {
  let ready = codexReadiness(
    () => Promise.reject(new Error('account service unreachable')),
    () => Promise.resolve(true),
  )
  assertEquals(await ready(), false)
})

Deno.test('signed in follows the bus, reachable or not', async () => {
  assertEquals(
    await codexReadiness(
      () => Promise.resolve(status(true)),
      () => Promise.resolve(true),
    )(),
    true,
  )
  assertEquals(
    await codexReadiness(
      () => Promise.resolve(status(true)),
      () => Promise.resolve(false),
    )(),
    false,
  )
  // A throwing probe is unreachable, never a rejection out of the gate.
  assertEquals(
    await codexReadiness(
      () => Promise.resolve(status(true)),
      () => Promise.reject(new Error('boom')),
    )(),
    false,
  )
})

Deno.test('the bus verdict is held for a TTL, then re-probed', async () => {
  let probes = 0
  let clock = 1000
  let ready = codexReadiness(
    () => Promise.resolve(status(true)),
    () => {
      probes++
      return Promise.resolve(true)
    },
    5000,
    () => clock,
  )
  await ready()
  await ready()
  assertEquals(probes, 1) // held within the window
  clock += 6000
  await ready()
  assertEquals(probes, 2) // re-probed past the TTL
})
