// Hosted-tool contracts: local calls receive host authority with an allowlisted
// environment, Tasks identity stays outside model arguments, and calls return
// durable facets.
import { assertEquals, assertMatch, assertRejects } from '@std/assert'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { type IO } from './mcp.ts'
import { type Change, type Snapshot } from './types.ts'
import type { Mutation } from './mutation.ts'
import { slow } from './testing.ts'

let scratch = async () => await Deno.makeTempDir({ prefix: 'tasks-tools-' })

slow(
  'local tools use Bash with host authority and managed identity',
  async () => {
    let tree = await scratch()
    let sibling = await scratch()
    try {
      await Deno.writeTextFile(`${sibling}/secret.txt`, 'outside')
      let tools = await localTools({ tree, session: 'managed-session' })
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
        command:
          `values=(zero one); [[ "${'$'}{values[1]}" == one ]] || exit 9; ` +
          `printf '%s|%s|%s|%s|%s' "$HOME" "$(cat ${sibling}/secret.txt)" ` +
          `"$(command -v git)" "$TASKS_SESSION" "$TASKS_TREE"`,
      })
      assertEquals(
        out.output,
        `${Deno.env.get('HOME')}|outside|/usr/bin/git|managed-session|${tree}`,
      )
      assertEquals(out.facets?.exit.code, 0)
    } finally {
      await Deno.remove(tree, { recursive: true })
      await Deno.remove(sibling, { recursive: true })
    }
  },
)

slow('local Git opens linked-worktree metadata on the host', async () => {
  let root = await scratch()
  let repo = `${root}/repo`, tree = `${root}/tree`
  let git = async (args: string[], cwd = repo) => {
    let out = await new Deno.Command('/usr/bin/git', {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  }
  try {
    await Deno.mkdir(repo)
    await git(['init', '-q', '-b', 'main'])
    await git(['config', 'user.email', 'agent@example.test'])
    await git(['config', 'user.name', 'Agent'])
    await Deno.writeTextFile(`${repo}/note.txt`, 'base\n')
    await git(['add', 'note.txt'])
    await git(['commit', '-q', '-m', 'base'])
    await git(['worktree', 'add', '-q', '-b', 'session/test', tree])
    let tools = await localTools({ tree })
    let out = await tools.call('shell', {
      command: 'git rev-parse --show-toplevel',
    })
    assertEquals(out.output.trim(), tree)
    assertEquals(out.facets?.exit.code, 0)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

slow('large command streams move whole output to named files', async () => {
  let tree = await scratch()
  let files: string[] = []
  try {
    let tools = await localTools({ tree, outputLimit: 1024 })
    let out = await tools.call('shell', {
      command: `printf '%02000d' 0; printf '%01500d' 0 >&2`,
    })
    let stdout = out.output.match(/full stdout saved to (.+) \(2000 bytes\)/)
    let stderrText = String(out.facets?.stderr.text)
    let stderr = stderrText.match(/full stderr saved to (.+) \(1500 bytes\)/)
    if (stdout) files.push(stdout[1])
    if (stderr) files.push(stderr[1])
    assertEquals(out.output.slice(0, 1024), '0'.repeat(1024))
    assertEquals(stderrText.slice(0, 1024), '0'.repeat(1024))
    assertEquals(
      stdout?.[1] && await Deno.readTextFile(stdout[1]),
      '0'.repeat(2000),
    )
    assertEquals(
      stderr?.[1] && await Deno.readTextFile(stderr[1]),
      '0'.repeat(1500),
    )
  } finally {
    for (let file of files) await Deno.remove(file).catch(() => {})
    await Deno.remove(tree, { recursive: true })
  }
})

slow(
  'local patch delegates Codex grammar unchanged and records facets',
  async () => {
    let tree = await scratch()
    let sibling = await scratch()
    try {
      await Deno.writeTextFile(`${sibling}/note.txt`, 'before\n')
      let diff = `*** Begin Patch
*** Update File: note.txt
@@
-before
+after
*** End Patch`
      await Deno.writeTextFile(`${sibling}/expected.patch`, diff)
      let codex = `${tree}/codex`
      await Deno.writeTextFile(
        codex,
        `#!/bin/bash
[[ "$1" == '--codex-run-as-apply-patch' ]] || exit 91
[[ "$2" == "$(<expected.patch)" ]] || exit 92
printf 'after\\n' > note.txt
printf 'Success. Updated note.txt\\n'
`,
      )
      await Deno.chmod(codex, 0o755)
      let tools = await localTools({ tree, codex })
      let out = await tools.call('apply_patch', {
        diff,
        cwd: sibling,
      })
      assertEquals(out.output, 'Success. Updated note.txt\n')
      assertEquals(out.facets?.exit.code, 0)
      assertEquals(await Deno.readTextFile(`${sibling}/note.txt`), 'after\n')
    } finally {
      await Deno.remove(tree, { recursive: true })
      await Deno.remove(sibling, { recursive: true })
    }
  },
)

let empty: Snapshot = {
  changes: [],
  deps: [],
  cursor: 0,
  epoch: 'test',
  vocabHash: 'test',
  capabilities: [],
}

slow(
  'Tasks tools expose typed primitives and inject Session identity',
  async () => {
    let writes: { mutation: Mutation; via?: string }[] = []
    let reads = 0, gets = 0
    let io: IO = {
      read: () => {
        reads++
        return Promise.resolve(empty)
      },
      query: () => Promise.resolve([]),
      get: () => {
        gets++
        return Promise.resolve([])
      },
      deps: () => Promise.resolve([]),
      write: (mutation: Mutation, via) => {
        writes.push({ mutation, via })
        let aliases: Record<string, string> = 'entities' in mutation
          ? { note: 'nested-eid' }
          : {}
        return Promise.resolve({
          changes: Array.isArray(mutation) ? mutation : [],
          aliases,
        })
      },
      find: () => Promise.resolve([]),
      upload: () => Promise.resolve(),
      touch: () => Promise.resolve(),
      history: () => Promise.resolve([]),
      providers: () => Promise.resolve([]),
      backfill: () => Promise.resolve([]),
    }
    let tasks = await tasksTools(io, 'managed-session-1')
    try {
      assertEquals({ reads, gets }, { reads: 0, gets: 1 })
      assertEquals(tasks.tools.map((tool) => tool.name), [
        'task_context',
        'graph_query',
        'graph_apply',
      ])
      assertEquals(
        tasks.tools.find((tool) => tool.name == 'graph_apply')!.strict,
        false,
      )
      let applyProperties = tasks.tools.find((tool) =>
        tool.name == 'graph_apply'
      )!.parameters.properties as Record<string, unknown>
      assertEquals('changes' in applyProperties, true)
      assertEquals('entities' in applyProperties, true)
      assertEquals(
        Object.keys(
          tasks.tools.find((tool) => tool.name == 'task_context')!.parameters
            .properties as Record<string, unknown>,
        ),
        [],
      )
      let queried = await tasks.call('graph_query', { query: '' })
      assertMatch(queried.output, /\[\]/)
      // Two dependent component patches on one new entity: a doc + a task on
      // the same eid, an entity that is only a well-formed task if both land.
      // The hosted tool threads the whole array to one io.write — never one
      // write per change — so the batch stays atomic and the injected Session
      // identity rides beside it, outside model input.
      let batch: Change[] = [
        {
          eid: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'doc',
          comp: { title: 'hello' },
        },
        {
          eid: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'task',
          comp: {},
        },
      ]
      await tasks.call('graph_apply', { changes: batch })
      assertEquals(writes, [{ mutation: batch, via: 'managed-session-1' }])
      let entities = [{ key: 'note', comps: { doc: { title: 'nested' } } }]
      let nested = await tasks.call('graph_apply', { entities })
      assertMatch(nested.output, /"note": "nested-eid"/)
      assertEquals(writes.at(-1), {
        mutation: { entities },
        via: 'managed-session-1',
      })
      // The old single-`change` shape and a non-array are refused at the door,
      // so a batch can never silently collapse to one change.
      await assertRejects(
        () => tasks.call('graph_apply', { change: batch[0] }),
        Error,
        'unknown tool argument',
      )
      await assertRejects(
        () => tasks.call('graph_apply', { changes: batch[0] }),
        Error,
        'exactly one non-empty',
      )
    } finally {
      await tasks.close?.()
    }
  },
)

slow('combined tools refuse name collisions and unknown calls', async () => {
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
