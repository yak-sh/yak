// Hosted-tool contracts: confinement is enforced by the host, Tasks identity
// is injected out of model arguments, and every call returns durable facets.
import { assertEquals, assertMatch, assertRejects } from '@std/assert'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { type IO } from './mcp.ts'
import { type Change, type Snapshot } from './types.ts'

let scratch = async () => await Deno.makeTempDir({ prefix: 'tasks-tools-' })

Deno.test('local tools confine writes and strip the owner environment', async () => {
  let tree = await scratch()
  let sibling = await scratch()
  try {
    await Deno.writeTextFile(`${tree}/seen.txt`, 'inside')
    await Deno.writeTextFile(`${sibling}/secret.txt`, 'outside')
    Deno.env.set('TASKS_TOOL_SECRET', 'credential-marker')
    let tools = await localTools({ tree })
    for (let tool of tools.tools.filter((tool) => tool.strict)) {
      let shape = tool.parameters as {
        properties: Record<string, unknown>
        required: string[]
      }
      assertEquals(
        shape.required.toSorted(),
        Object.keys(shape.properties).sort(),
      )
    }
    let out = await tools.call('shell', {
      command: `printf '%s|%s|%s' "$HOME" "${'$'}{TASKS_TOOL_SECRET-unset}" ` +
        `"$(test -e ${sibling}/secret.txt && echo leaked || echo confined)" && ` +
        `printf changed > made.txt`,
    })
    assertEquals(out.output, '/home/agent|unset|confined')
    assertEquals(out.facets?.exit.code, 0)
    assertEquals(await Deno.readTextFile(`${tree}/made.txt`), 'changed')
  } finally {
    Deno.env.delete('TASKS_TOOL_SECRET')
    await Deno.remove(tree, { recursive: true })
    await Deno.remove(sibling, { recursive: true })
  }
})

Deno.test('local patch records stdout, stderr, exit, and refuses weaker posture', async () => {
  let tree = await scratch()
  try {
    await Deno.writeTextFile(`${tree}/note.txt`, 'before\n')
    let tools = await localTools({ tree })
    let out = await tools.call('apply_patch', {
      diff: `--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-before\n+after\n`,
    })
    assertEquals(out.facets?.exit.code, 0)
    assertEquals(await Deno.readTextFile(`${tree}/note.txt`), 'after\n')
    await assertRejects(
      () => localTools({ tree, authority: 'host' }),
      Error,
      'unsupported authority',
    )
    await assertRejects(
      () => localTools({ tree, approval: 'ask' }),
      Error,
      'unsupported approval',
    )
  } finally {
    await Deno.remove(tree, { recursive: true })
  }
})

let empty: Snapshot = {
  changes: [],
  deps: [],
  cursor: 0,
  epoch: 'test',
  vocabHash: 'test',
  capabilities: [],
}

Deno.test('Tasks tools expose typed primitives and inject Session identity', async () => {
  let writes: { changes: Change[]; via?: string }[] = []
  let io: IO = {
    read: () => Promise.resolve(empty),
    write: (changes, via) => {
      writes.push({ changes, via })
      return Promise.resolve(changes)
    },
    find: () => Promise.resolve([]),
    upload: () => Promise.resolve(),
    touch: () => Promise.resolve(),
    logs: () => Promise.resolve({ entries: [] }),
    history: () => Promise.resolve([]),
    providers: () => Promise.resolve([]),
  }
  let tasks = await tasksTools(io, 'managed-session-1')
  try {
    assertEquals(tasks.tools.map((tool) => tool.name), [
      'task_context',
      'graph_query',
      'graph_apply',
    ])
    assertEquals(
      tasks.tools.find((tool) => tool.name == 'graph_apply')!.strict,
      false,
    )
    assertEquals(
      Object.keys(
        tasks.tools.find((tool) => tool.name == 'task_context')!.parameters
          .properties as Record<string, unknown>,
      ),
      [],
    )
    let queried = await tasks.call('graph_query', { query: '' })
    assertMatch(queried.output, /\[\]/)
    let change: Change = {
      eid: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'doc',
      comp: { title: 'hello' },
    }
    await tasks.call('graph_apply', { change })
    assertEquals(writes, [{ changes: [change], via: 'managed-session-1' }])
  } finally {
    await tasks.close?.()
  }
})

Deno.test('combined tools refuse name collisions and unknown calls', async () => {
  let host = {
    tools: [{
      type: 'function' as const,
      name: 'one',
      description: 'one',
      parameters: {},
      strict: true as const,
    }],
    call: () => Promise.resolve({ output: 'ok' }),
  }
  let combined = combineTools(host)
  assertEquals((await combined.call('one', {})).output, 'ok')
  await assertRejects(() => combined.call('missing', {}), Error, 'unknown tool')
  try {
    combineTools(host, host)
    throw new Error('expected collision')
  } catch (error) {
    assertMatch((error as Error).message, /duplicate tool/)
  }
})
