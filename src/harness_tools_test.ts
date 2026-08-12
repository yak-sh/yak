// Hosted-tool contracts: local calls receive host authority with an allowlisted
// environment, Tasks identity stays outside model arguments, and calls return
// durable facets.
import { assertEquals, assertMatch, assertRejects } from '@std/assert'
import { combineTools, localTools, tasksTools } from './harness_tools.ts'
import { type IO } from './mcp.ts'
import { type Change, type Snapshot } from './types.ts'
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
    let writes: { changes: Change[]; via?: string }[] = []
    let io: IO = {
      read: () => Promise.resolve(empty),
      query: () => Promise.resolve([]),
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
