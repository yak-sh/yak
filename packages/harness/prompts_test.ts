import type { Comp } from '@yaks/graph'
import { assertEquals, assertRejects } from '@std/assert'
import { instructionFiles, promptEntry } from './prompts.ts'
import { input } from '../openai/responses.ts'

Deno.test('instruction admission snapshots files in stable ancestor order', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.mkdir(dir + '/home/.agents', { recursive: true })
    await Deno.mkdir(dir + '/repo/sub', { recursive: true })
    await Deno.writeTextFile(dir + '/home/.agents/AGENTS.md', 'global')
    await Deno.writeTextFile(dir + '/repo/AGENTS.md', 'repo')
    await Deno.writeTextFile(dir + '/repo/sub/AGENTS.md', 'nested')
    let files = await instructionFiles(dir + '/repo/sub', dir + '/home')
    assertEquals(files.map((f) => f.body), ['global', 'repo', 'nested'])
    let snapshot = promptEntry(
      's',
      1,
      files[1].body,
      files[1].source,
      'shared',
      files[1].revision,
    )
    await Deno.writeTextFile(dir + '/repo/AGENTS.md', 'changed')
    assertEquals(snapshot.content, { body: 'repo' })
    assertEquals(files[1].revision.length, 64)
    assertEquals(
      (await instructionFiles(dir + '/repo/sub', dir + '/missing')).length,
      2,
    )
    await assertRejects(() => instructionFiles(dir + '/absent'))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('instruction items map to ordered developer messages, never user text', () => {
  assertEquals(
    input([
      { kind: 'user', text: 'before' },
      { kind: 'instruction', text: 'new guidance' },
      { kind: 'user', text: 'after' },
    ]),
    [
      { role: 'user', content: [{ type: 'input_text', text: 'before' }] },
      {
        role: 'developer',
        content: [{ type: 'input_text', text: 'new guidance' }],
      },
      { role: 'user', content: [{ type: 'input_text', text: 'after' }] },
    ],
  )
})

Deno.test('root admission is snapshotted and explicit later context is an instruction', async () => {
  let dir = await Deno.makeTempDir()
  let { agent } = await import('./run.ts')
  let { open } = await import('./store.ts')
  let requests: import('@yaks/model').Request[] = []
  await Deno.writeTextFile(dir + '/AGENTS.md', 'shared rule')
  let a = await agent({
    h: open(':memory:'),
    model: (req) => {
      requests.push(req)
      return Promise.resolve({
        id: 'r',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'ok' }],
      })
    },
    name: 'fake',
    cwd: dir,
  })
  try {
    let id = await a.start('work')
    await a.idle(id)
    assertEquals(
      requests[0].items.filter((i) => i.kind == 'instruction').map((i) =>
        i.text
      ),
      ['shared rule'],
    )
    await Deno.writeTextFile(dir + '/AGENTS.md', 'changed rule')
    await a.instruct(id, 'additional rule', 'test')
    await a.idle(id)
    assertEquals(
      requests.at(-1)!.items.filter((i) => i.kind == 'instruction').map((i) =>
        i.text
      ),
      ['shared rule', 'additional rule'],
    )
  } finally {
    await a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('retired CLI instructions are omitted on future asks without rewriting history', async () => {
  let { agent } = await import('./run.ts')
  let { open } = await import('./store.ts')
  let dir = await Deno.makeTempDir()
  let h = open(':memory:')
  let requests: import('@yaks/model').Request[] = []
  let a = agent({
    h,
    cwd: dir,
    name: 'fake',
    model: (req) => {
      requests.push(req)
      return Promise.resolve({
        id: 'reply',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'ok' }],
      })
    },
  })
  let retired =
    'You are an agent in a self-contained harness. You have a shell, and the ' +
    'graph you yourself live in: your transcript, the work on your list and ' +
    'the programs you start are all entities you can read and write with the ' +
    'graph_ tools. Be terse; say what you did, not what you are about to do.'
  try {
    await Deno.writeTextFile(dir + '/AGENTS.md', 'Keep repository guidance.')
    let id = await a.start('first')
    await a.idle(id)
    assertEquals(requests[0].instructions, undefined)
    assertEquals(
      requests[0].items.filter((i) => i.kind == 'instruction').map((i) =>
        i.text
      ),
      ['Keep repository guidance.'],
    )
    let history = await a.transcript(id)
    let ask = history.find((b) => b.ask)!
    await h.g.apply([{ entity: ask.entity, using: { instructions: retired } }])
    await a.send(id, 'continue')
    await a.idle(id)
    assertEquals(requests.at(-1)!.instructions, undefined)
    assertEquals(
      ((await a.transcript(id)).find((b) => b.entity.eid == ask.entity.eid)!
        .using as Comp).instructions,
      retired,
    )
    let current = await a.transcript(id)
    let latest = current.filter((b) => b.ask).at(-1)!
    assertEquals((latest.using as Comp).instructions, null)
    // A child of historical context must not reintroduce the old baseline.
    let child = crypto.randomUUID()
    await h.g.apply([
      {
        entity: { eid: child },
        session: { id: child },
        fork: { from: String((ask.ask as Comp).through) },
      },
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session: child },
        content: { body: 'child assignment' },
        using: { ...(ask.using as Comp), instructions: retired },
      },
    ])
    await a.idle(child)
    assertEquals(requests.at(-1)!.instructions, undefined)
    await h.g.apply([{
      entity: latest.entity,
      using: { instructions: 'Custom instructions stay.' },
    }])
    await a.send(id, 'custom')
    await a.idle(id)
    assertEquals(requests.at(-1)!.instructions, 'Custom instructions stay.')
  } finally {
    await a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('explicit configuration and custom inherited instructions remain supported', async () => {
  let { inheritedInstructions } = await import('./legacy_instructions.ts')
  assertEquals(inheritedInstructions(undefined, 'configured'), 'configured')
  assertEquals(inheritedInstructions('custom', 'configured'), 'custom')
  assertEquals(inheritedInstructions('', 'configured'), '')
})
