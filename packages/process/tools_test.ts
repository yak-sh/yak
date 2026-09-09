// Real children again (see run_test.ts): what is under test is a call that
// outlives its budget, so a fake child would be testing the fake. The poll is
// 5ms and every child is short or killed, so the file runs in well under a
// second.

import { assert, assertEquals, assertMatch } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { EXIT } from './comp.ts'
import { tracked } from './harness.ts'
import { type ShellOpts, shellTools } from './tools.ts'

let opts = (): ShellOpts => ({
  dir: Deno.makeTempDirSync({ prefix: 'yaks-process-' }),
  poll: 5,
  grace: 500,
})

let named = (g: ReturnType<typeof tracked>, o = opts()) => {
  let tools = shellTools(g, o)
  let by = (name: string) => tools.find((t) => t.name == name)!
  return { shell: by('shell'), wait: by('wait'), stop: by('stop') }
}

// The id the answers name, so a test reaches the same process the model would.
let eidIn = (said: string) => {
  let m = said.match(/^process (\S+) /)
  assert(m, `no process named in: ${said}`)
  return m[1]
}

Deno.test('a short command answers inline, with its output and its code', async () => {
  let g = tracked()
  let said = await named(g).shell.run({ command: 'echo hi; exit 2' })
  assertMatch(said, /^process \S+ exited 2\nhi$/)
})

Deno.test('a command that outlives its budget answers with the process, and stop ends it', async () => {
  let g = tracked()
  let { shell, stop } = named(g)
  let said = await shell.run({ command: 'sleep 30', timeout: 50 })
  assertMatch(said, /still running \(pid \d+\) after 50ms/)
  let eid = eidIn(said)

  let ended = await stop.run({ process: eid })
  assertMatch(ended, new RegExp(`^process ${eid} exited \\d+$`))
  let [row] = await g.storage.tx((tx) => tx.get([eid]))
  assert((row[EXIT] as Comp)?.code != null, 'the exit is stamped on the row')
  // Stamped means finished: a boot reconcile has nothing left to pick up.
  assertEquals(await g.read('.process&.exit='), [])
})

Deno.test('wait answers the code of a child that outlived its call', async () => {
  let g = tracked()
  let { shell, wait } = named(g)
  let eid = eidIn(
    await shell.run({ command: 'sleep 0.05; echo done; exit 3', timeout: 1 }),
  )
  assertEquals(
    await wait.run({ process: eid }),
    `process ${eid} exited 3\ndone`,
  )
})

Deno.test('wait says still running when its own timeout passes, and names nothing it cannot find', async () => {
  let g = tracked()
  let { shell, wait, stop } = named(g)
  let eid = eidIn(await shell.run({ command: 'sleep 30', timeout: 1 }))
  assertMatch(
    await wait.run({ process: eid, timeout: 20 }),
    /still running \(pid \d+\) after 20ms/,
  )
  assertEquals(await wait.run({ process: 'nope' }), 'no such process: nope')
  await stop.run({ process: eid })
})
