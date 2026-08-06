// The supervisor trusts a child only after its private ready handshake. This
// probe uses a tiny child instead of booting the graph server.
import { assertEquals } from '@std/assert'
import { insist, launch } from './dev.ts'

let tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

Deno.test('launch: returns a child only after its ready signal', async () => {
  let js = `
    let arg = Deno.args.find((a) => a.startsWith('--ready='))
    using conn = await Deno.connect({
      hostname: '127.0.0.1',
      port: Number(arg.split('=')[1]),
    })
    await conn.write(new Uint8Array([1]))
  `
  // '--' hands the appended --ready flag to the code as Deno.args.
  let child = await launch(Deno.execPath(), ['eval', js, '--'])
  assertEquals((await child.status).success, true)
})

Deno.test('insist: a handoff that failed comes back until it takes', async () => {
  let tries = 0
  insist(() => Promise.resolve(++tries == 3), [0], 0)()
  while (tries < 3) await tick(1)
  await tick(10)
  assertEquals(tries, 3) // and stops the moment one succeeds
})

Deno.test('insist: a rejected attempt is a failure, not a death', async () => {
  let tries = 0
  let fail = () => Promise.reject('insist probe: this rejection is the test')
  insist(() => ++tries == 2 ? Promise.resolve(true) : fail(), [0], 0)()
  while (tries < 2) await tick(1)
  await tick(10)
  assertEquals(tries, 2)
})

Deno.test('insist: edits arriving together make one attempt', async () => {
  let tries = 0
  let poke = insist(() => Promise.resolve(!!++tries), [0], 5)
  poke()
  poke()
  poke()
  await tick(60)
  assertEquals(tries, 1)
})
