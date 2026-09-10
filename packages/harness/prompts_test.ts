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
