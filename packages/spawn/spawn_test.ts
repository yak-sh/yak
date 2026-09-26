// A real child, because a spawn that only ever launched a fake one would
// prove nothing: the two escapes, the pidfile, the detached log and the
// ending are the thing under test. The provider is a shell script, so the
// whole file costs a few hundred milliseconds.

import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { effectDoc, type Effects, effects, POOL, take } from '@yaks/effects'
import { modelDoc } from '@yaks/model'
import { ram } from '@yaks/ram'
import { sessionDoc, sessions, transcriptUsage } from '@yaks/session'
import { toolsDoc } from '@yaks/tools/vocab'
import { loadVocab } from '@yaks/vocab'
import { launch, processDoc, processes, store } from '@yaks/process'
import { spawning } from './effects.ts'
import { adopting } from './service.ts'
import { checkoutDoc } from '@yaks/git/vocab'
import { checkoutOf, down, speaking } from './run.ts'
import { asking, fake, tracked, until } from './testing.ts'
import { spawnDoc } from './vocab.ts'

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-spawn-' })

// The facet, composed the way `yak serve` composes it.
let watching = (g: ReturnType<typeof tracked>, o: Record<string, unknown>) =>
  g.fx.handle(spawning({ adapters: { fake }, ...o })({ graph: g.g }))

let said = (g: { read: (q: string) => unknown }) =>
  g.read('.entry&.order=entry.seq&*') as Promise<Bundle[]>

let bodies = async (g: { read: (q: string) => unknown }) =>
  (await said(g)).map((b) => String(comp(b, 'content')?.body ?? ''))

Deno.test('the request starts the provider, and what it printed is the transcript', async () => {
  let g = tracked()
  let where = dir()
  watching(g, { dir: where, poll: 20 })
  try {
    await g.g.apply(asking('S1', 'E1', 'do the thing'))
    // The turn's ending is an entry, so the transcript settles by itself. It
    // is read in after the text before it, so wait for the ending itself.
    await until(
      async () => comp((await said(g.g)).at(-1), 'stop'),
      'the turn to end',
    )
    assert((await bodies(g.g)).includes('working: do the thing'))
    let last = (await said(g.g)).at(-1)!
    assertEquals(comp(last, 'stop'), {})
    assertEquals(comp(last, 'usage')?.output_tokens, 34)
    // Where a daemon's ask keeps it, so what reads a transcript's usage reads
    // a run's.
    let [cost] = await transcriptUsage(g.g, 'S1')
    assertEquals(comp(cost, 'usage')?.output_tokens, 34)
    assertEquals(comp(cost, 'ask')?.through, 'E1')
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the ending',
    )
    let [row] = await g.g.read('.session&*')
    // The process rides the session's own entity, and the provider was told
    // to call its thread by that same name.
    assertEquals(comp(row, 'session')?.id, 'S1')
    assertEquals(comp(row, 'exit')?.code, 0)
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

Deno.test('a request made beside a server is started by the server, not the command', async () => {
  let vocab = loadVocab(
    [sessionDoc, toolsDoc, modelDoc, processDoc, edgeDoc, effectDoc, spawnDoc],
    [edgeKeywords],
  )
  let storage = ram(vocab, { number: true })
  // One store, two processes: a one-shot command and a server working the
  // effects. Each has its own registry and graph, as it would.
  let process = (me: string) => {
    let fx: Effects = effects(vocab, {
      owner: me,
      write: (b) => g.apply(b, { trusted: true }),
    })
    let g = graph({ storage, vocab, plugins: [sessions(), processes(), fx] })
    fx.handle(
      spawning({ adapters: { fake } })({ graph: g }, { dir: where, poll: 20 }),
    )
    return { g, fx }
  }
  let where = dir()
  let cmd = process('cmd')
  let g = cmd.g
  // The server is up and working the pool.
  await take(g, `${POOL}/server`, { holder: 'server' })
  try {
    await g.apply(asking('S1', 'E1', 'do the thing'))
    await cmd.fx.work(g)
    // The command started nothing, and the run waits for the server.
    assertEquals(comp((await g.read('.session&*'))[0], 'process'), undefined)
    let [row] = await g.read('.effect.comp=using&*')
    assertEquals(comp(row, 'effect')?.state, 'pending')
    assertEquals(comp(row, 'effect')?.attempts, 0)
    // The server's next pass starts it.
    let server = process('server')
    await server.fx.work(server.g)
    await until(
      async () => comp((await g.read('.session&*'))[0], 'exit'),
      'the run the server started to end',
    )
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

Deno.test('a run works in a checkout of its own, taken back when it ends', async () => {
  let vocab = loadVocab(
    [
      sessionDoc,
      toolsDoc,
      modelDoc,
      processDoc,
      edgeDoc,
      checkoutDoc,
      spawnDoc,
    ],
    [edgeKeywords],
  )
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [sessions(), processes(), fx],
  })
  let top = await Deno.realPath(dir())
  let repo = `${top}/repo`
  let runs = `${top}/runs`
  await Deno.mkdir(repo)
  await Deno.mkdir(runs)
  let sh = (...args: string[]) =>
    new Deno.Command('git', { cwd: repo, args, stdout: 'null' }).output()
  let branches = async () =>
    new TextDecoder().decode(
      (await new Deno.Command('git', { cwd: repo, args: ['branch', '--list'] })
        .output()).stdout,
    )
  await sh('init', '-q', '-b', 'main', '.')
  await sh(
    '-c',
    'user.email=t@example.org',
    '-c',
    'user.name=T',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'initial',
  )
  fx.handle(
    spawning({ adapters: { fake } })({ graph: g }, {
      dir: top,
      poll: 20,
      cwd: repo,
      worktrees: runs,
    }),
  )
  try {
    await g.apply(asking('S1', 'E1', 'do the thing'))
    await until(
      async () => comp((await g.read('.session&*'))[0], 'process'),
      'the run to start',
    )
    let [row] = await g.read('.session&*')
    assertEquals(comp(row, 'process')?.cwd, checkoutOf('S1', runs))
    // It held nothing, so once it ends its checkout is gone again, and then
    // the branch it was cut on (@yaks/git `reclaim`). The branch goes last:
    // until it has, git is still writing in the repository.
    await until(
      async () =>
        await Deno.stat(checkoutOf('S1', runs)).then(() => false, () => true) &&
        !(await branches()).includes('session-S1'),
      'its checkout and its branch to be taken back',
    )
  } finally {
    Deno.removeSync(top, { recursive: true })
  }
})

Deno.test('a run speaks as its own session, never its launcher’s', () => {
  let env = speaking('S1', {
    PATH: '/bin',
    CLAUDE_CODE_SESSION_ID: 'launcher',
    CODEX_THREAD_ID: 'launcher-thread',
    TASKS_SESSION: 'launcher-task',
  })
  assertEquals(env, { PATH: '/bin', TASKS_SESSION: 'S1' })
})

Deno.test('a stop on the session reaches the agent', async () => {
  let g = tracked()
  let where = dir()
  watching(g, { dir: where, poll: 20, grace: 500 })
  try {
    await g.g.apply(asking('S1', 'E1', 'linger here'))
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'process')?.pid,
      'a pid',
    )
    await g.g.apply([{ entity: { eid: 'S1' }, stop: {} }])
    let over = await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the agent to go',
    )
    assert(over, 'no ending stamped')
    // It was killed rather than finishing, and the transcript says so.
    let lines = await said(g.g)
    assertEquals(comp(lines.at(-1), 'stop'), {})
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})

Deno.test('a command passing through adopts no run', async () => {
  // Its tails would outlive the lease it gives back on the way out, so it
  // does not so much as look.
  let looked = false
  let untouched = new Proxy({}, { get: () => (looked = true, undefined) })
  await adopting()({ graph: untouched } as never, {}, AbortSignal.abort())
  assertEquals(looked, false)
})

Deno.test('a restart adopts the run and reads its log on from where it stands', async () => {
  let g = tracked()
  let where = dir()
  try {
    // A server that launched an agent and then went away: the rows are there,
    // the log is being written, and nobody is reading it.
    await g.g.apply(asking('S1', 'E1', 'linger here'))
    let argv = fake.argv({ session: 'S1', instruction: 'linger here' })
    await launch(store(g.g), {
      command: argv[0],
      args: argv.slice(1),
      env: Deno.env.toObject(),
    }, { eid: 'S1', stream: false, dir: where, poll: 20 })
    // The wrapper opens the log after launch returns, so at first it is absent.
    await until(
      async () =>
        ((await Deno.stat(`${where}/S1.out`).catch(() => null))?.size ?? 0) >
          100,
      'the log to fill',
    )
    assertEquals((await said(g.g)).length, 1) // only the request so far

    // The restart: the duty, held by a process that stays up.
    let up = new AbortController()
    let duty = adopting({ adapters: { fake } })(
      { graph: g.g },
      { dir: where, poll: 20 },
      up.signal,
    )
    await until(
      async () => (await bodies(g.g)).includes('working: linger here'),
      'the lines written while we were away',
    )
    await down(g.g, 'S1', { dir: where, poll: 20, grace: 500 })
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the agent to go',
    )
    up.abort()
    await duty
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})
