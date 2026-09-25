// A real child, because a spawn that only ever launched a fake one would
// prove nothing: the two escapes, the pidfile, the detached log and the
// ending are the thing under test. The provider is a shell script, so the
// whole file costs a few hundred milliseconds.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { launch, selfEid, store } from '@yaks/process'
import { spawning } from './effects.ts'
import { down, resume } from './run.ts'
import { asking, fake, tracked, until } from './harness.ts'

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? undefined) as Comp | undefined

let dir = () => Deno.makeTempDirSync({ prefix: 'yaks-spawn-' })

// The facet, composed the way `yak serve` composes it.
let watching = (g: ReturnType<typeof tracked>, o: Record<string, unknown>) => {
  for (
    let { comp, ...watch } of spawning({ adapters: { fake }, ...o })({
      graph: g.g,
      me: selfEid(),
    })
  ) g.fx.on(comp, watch)
}

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
    await until(
      () => Deno.statSync(`${where}/S1.out`).size > 100,
      'the log to fill',
    )
    assertEquals((await said(g.g)).length, 1) // only the request so far

    // The restart.
    let runs = await resume(g.g, { adapters: { fake }, dir: where, poll: 20 })
    assertEquals(runs.length, 1)
    await until(
      async () => (await bodies(g.g)).includes('working: linger here'),
      'the lines written while we were away',
    )
    await down(g.g, 'S1', { dir: where, poll: 20, grace: 500 })
    await until(
      async () => comp((await g.g.read('.session&*'))[0], 'exit'),
      'the agent to go',
    )
  } finally {
    Deno.removeSync(where, { recursive: true })
  }
})
