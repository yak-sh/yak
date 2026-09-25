// Winding down at its seam: what the first signal asks, what the grace or a
// second signal ends, and a command with nothing open ending at once.

import { assertEquals } from '@std/assert'
import { until } from '../../bin/testing.ts'
import { winding } from './signal.ts'

let wound = (open = true, grace = 60_000) => {
  let said: string[] = []
  let on = winding({
    stop: () => (said.push('stop'), open),
    close: (code) => (said.push(`close ${code}`), Promise.resolve()),
    exit: (code) => void said.push(`exit ${code}`),
    grace,
  })
  return { said, on }
}

Deno.test('a first signal asks what is open to wind down, and nothing more', () => {
  let { said, on } = wound()
  on(143)
  assertEquals(said, ['stop'])
})

Deno.test('a second signal closes with its code and ends the process', async () => {
  let { said, on } = wound()
  on(130)
  on(130)
  await until(() => said.includes('exit 130'))
  assertEquals(said, ['stop', 'close 130', 'exit 130'])
})

Deno.test('the grace running out ends what never wound down', async () => {
  let { said, on } = wound(true, 1)
  on(143)
  await until(() => said.includes('exit 143'))
  assertEquals(said, ['stop', 'close 143', 'exit 143'])
})

Deno.test('a command with nothing open ends at once', async () => {
  let { said, on } = wound(false)
  on(130)
  await until(() => said.includes('exit 130'))
  assertEquals(said, ['stop', 'close 130', 'exit 130'])
})
