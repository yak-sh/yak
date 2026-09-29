// Real children again (see @yaks/process's run_test.ts): what is under test is a call that
// outlives its budget, so a fake child would be testing the fake. The poll is
// 5ms and every child is short or killed, so the file runs in well under a
// second.

import { assert, assertEquals, assertMatch } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { EXIT, processDoc, processes } from '@yaks/process'
import { ram } from '@yaks/ram'
import { sessionDoc } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { type Opts } from '@yaks/process'
import { boxMachine } from './box.ts'
import { machineTools } from './machine.ts'

// Process rows, in a graph that also knows sessions and models.
let vocab = loadVocab([processDoc, sessionDoc, toolsDoc, modelDoc])
let tracked = () =>
  graph({ storage: ram(vocab), vocab, plugins: [processes()] })

let opts = (): Opts => ({
  dir: Deno.makeTempDirSync({ prefix: 'yaks-process-' }),
  poll: 5,
})

let named = (g: ReturnType<typeof tracked>, cwd?: string) => {
  let tools = machineTools(boxMachine(g, opts()), {
    grace: 500,
    cwd: () => cwd,
  })
  let by = (name: string) => tools.find((t) => t.name == name)!
  return {
    shell: by('shell'),
    wait: by('wait'),
    stop: by('stop'),
    read: by('read'),
    write: by('write'),
  }
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

Deno.test('a command tail keeps a line wider than a read block whole', async () => {
  let g = tracked()
  let said = await named(g).shell.run({
    command: `printf 'x%.0s' {1..70000}; printf '\\n\\nlast'`,
  })
  let [head, long, blank, last] = said.split('\n')
  assertMatch(head, /^process \S+ exited 0$/)
  assertEquals(long, 'x'.repeat(70_000))
  assertEquals(blank, '')
  assertEquals(last, 'last')
})

Deno.test('a command that outlives its budget answers with the process, and stop ends it', async () => {
  let g = tracked()
  let { shell, stop } = named(g)
  let said = await shell.run({ command: 'sleep 30', timeout: 50 })
  assertMatch(said, /still running \(pid \d+\) after 50ms/)
  let eid = eidIn(said)

  let ended = await stop.run({ process: eid })
  assertMatch(ended, new RegExp(`^process ${eid} exited \\d+$`))
  let [row] = await g.get([eid])
  assert((row[EXIT] as Comp)?.code != null, 'the exit is stamped on the row')
  // Stamped means finished: a boot reconcile has nothing left to pick up.
  assertEquals(await g.read('.process&!exit&*'), [])
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

Deno.test('an interrupted shell call recovers its process without running twice', async () => {
  let g = tracked()
  let o = opts()
  let dir = await Deno.makeTempDir({ prefix: 'yaks-shell-recovery-' })
  let command = `printf 'once\\n' >> '${dir}/started'; sleep 0.05; echo done`
  let call = { entity: { eid: crypto.randomUUID() } }
  let ctx = { session: crypto.randomUUID(), call, entries: [] }
  let m = boxMachine(g, o)
  let shell = machineTools(m).find((t) => t.name == 'shell')!
  let wait = machineTools(m).find((t) => t.name == 'wait')!
  try {
    let id = eidIn(await shell.run({ command, timeout: 1 }, ctx))
    assertEquals(await m.start(command, undefined, call.entity.eid), id)
    await wait.run({ process: id })
    let resumed = machineTools(boxMachine(g, o)).find((t) => t.name == 'shell')!
    assertEquals(
      await resumed.recover!({ command }, ctx),
      `process ${id} exited 0\ndone`,
    )
    assertEquals(
      await resumed.recover!({ command }, {
        ...ctx,
        call: { entity: { eid: crypto.randomUUID() } },
      }),
      'Shell execution has no process receipt; inspect before retrying.',
    )
    assertEquals(await Deno.readTextFile(`${dir}/started`), 'once\n')
    assertEquals((await g.read('.process&*')).length, 1)
  } finally {
    await Deno.remove(dir, { recursive: true })
    await Deno.remove(o.dir!, { recursive: true })
  }
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

Deno.test('shell uses bash and inherits the harness environment', async () => {
  // A variable the environment already carries, so the test sets none of the
  // state this process shares with every other test file.
  let said = await named(tracked()).shell.run({
    command: '[[ -n "$BASH_VERSION" ]] && printf "%s" "$PATH"',
  })
  assertEquals(said, `process ${eidIn(said)} exited 0\n${Deno.env.get('PATH')}`)
})

Deno.test('a session shell speaks as its transcript, not its launcher', async () => {
  let g = tracked()
  let o = opts()
  let env = {
    PATH: Deno.env.get('PATH') ?? '',
    CLAUDE_CODE_SESSION_ID: 'launcher',
    CODEX_THREAD_ID: 'launcher-thread',
    TASKS_SESSION: 'launcher-task',
  }
  let shell = machineTools(boxMachine(g, o, () => env))
    .find((t) => t.name == 'shell')!
  let ctx = {
    session: 'native-session',
    call: { entity: { eid: crypto.randomUUID() } },
    entries: [],
  }
  try {
    let said = await shell.run({
      command:
        'printf "%s|%s|%s" "$TASKS_SESSION" "$CLAUDE_CODE_SESSION_ID" "$CODEX_THREAD_ID"',
    }, ctx)
    assertEquals(said, `process ${eidIn(said)} exited 0\nnative-session||`)
  } finally {
    await Deno.remove(o.dir!, { recursive: true })
  }
})

Deno.test('write makes the directory it needs, and read gives the text back', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'yaks-machine-' })
  let { read, write } = named(tracked(), dir)
  assertEquals(
    await write.run({ path: 'src/lib.rs', content: 'fn main() {}' }),
    'wrote src/lib.rs',
  )
  assertEquals(await read.run({ path: `${dir}/src/lib.rs` }), 'fn main() {}')
  await Deno.remove(dir, { recursive: true })
})
