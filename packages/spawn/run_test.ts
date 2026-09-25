import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { claude } from './adapters.ts'
import { asked, follow } from './run.ts'
import { asking, FAKE, tracked } from './testing.ts'

// A log file and the run that wrote it, both already over: `follow` then does
// one pass and returns, which is the whole importer without a process.
let logged = async (lines: unknown[], code = 0) => {
  let { g } = tracked()
  let dir = Deno.makeTempDirSync({ prefix: 'spawn-' })
  await g.apply(asking('S1', 'E1', 'do it'))
  await g.apply([{
    entity: { eid: 'S1' },
    process: { pid: 1, command: 'fake' },
    exit: { code },
  }])
  Deno.writeTextFileSync(
    `${dir}/S1.out`,
    lines.map((l) => typeof l == 'string' ? l : JSON.stringify(l)).join('\n') +
      '\n',
  )
  return { g, dir, close: () => Deno.removeSync(dir, { recursive: true }) }
}

let entries = async (g: { read: (q: string) => unknown }) =>
  (await g.read('.entry&.order=entry.seq&*')) as Bundle[]

let comp = (b: Bundle | undefined, name: string) => b?.[name] as Comp

Deno.test('a request is the using on the transcript, read back as a job', async () => {
  let { g } = tracked()
  await g.apply(asking('S1', 'E1', 'fix it', { effort: 'high' }))
  assertEquals(await asked(g, 'S1'), {
    provider: 'fake',
    session: 'S1',
    model: 'fake-1',
    effort: 'high',
    instruction: 'fix it',
    ask: { to: FAKE.model, through: 'E1' },
  })
  // A transcript nobody asked a provider for is nobody's to start.
  await g.apply([{ entity: { eid: 'S2' }, session: {} }])
  assertEquals(await asked(g, 'S2'), null)
})

Deno.test('an effort the model does not serve is refused, not launched', async () => {
  let { g } = tracked()
  await g.apply(asking('S1', 'E1', 'fix it', { effort: 'extreme' }))
  await g.apply([{
    entity: { eid: FAKE.model },
    model: { efforts: 'low medium high' },
  }])
  let said = await asked(g, 'S1').catch((e: Error) => e.message)
  assert(String(said).includes('unknown effort: extreme'), String(said))
})

Deno.test('the log becomes the transcript: one entry per line that says something', async () => {
  let { g, dir, close } = await logged([
    { type: 'system', subtype: 'init', session_id: 'abc' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
    'Client.listTools() called but server does not advertise tools capability',
    { type: 'result', usage: { output_tokens: 3 } },
  ])
  try {
    await follow(g, 'S1', claude, { dir })
    let said = await entries(g)
    // The request, what it said, and the ending — the line that was not JSON
    // is left in the file.
    assertEquals(said.length, 3)
    assertEquals(comp(said[1], 'content').body, 'hi')
    // Everything a provider prints is output, and the run is the session.
    assertEquals(comp(said[1], 'output').source, 'S1')
    assertEquals(comp(said[1], 'imported').line, 2)
    assertEquals(comp(said[1], 'imported').source, `${dir}/S1.out`)
    assertEquals(comp(said[2], 'stop'), {})
    assertEquals(comp(said[2], 'usage').output_tokens, 3)
    // The line that says what the provider calls its own thread patches the
    // session rather than becoming an entry.
    let [row] = await g.read('.session&*')
    assertEquals(comp(row, 'session').id, 'abc')

    // The stamp is the cursor: reading the same file again imports nothing.
    await follow(g, 'S1', claude, { dir })
    assertEquals((await entries(g)).length, 3)
  } finally {
    close()
  }
})

Deno.test('a run that stopped talking is still over, and says so once', async () => {
  let { g, dir, close } = await logged([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
  ], 3)
  try {
    await follow(g, 'S1', claude, { dir })
    let said = await entries(g)
    let last = said.at(-1)!
    assertEquals(comp(last, 'stop'), {})
    assertEquals(comp(last, 'error').code, 'exit')
    assertEquals(comp(last, 'content').body, 'the provider exited 3')
    // And it is written once, however often the tail is run again.
    await follow(g, 'S1', claude, { dir })
    assertEquals((await entries(g)).length, said.length)
  } finally {
    close()
  }
})
