/** Specialized box operations through the registered CLI and real MCP HTTP
 * doors. Each metric is one operation family, never an inference from startup
 * or generic graph I/O. SQLite, session state and the HTTP listener are private
 * to this collection; no duties, providers, external connections or live writes.
 */
import type { Sample, Samples } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { declarations } from '../packages/cli/declarations.ts'
import type { Config } from '../packages/cli/config.ts'
import { initialize, rpc } from '../packages/cli/rpc.ts'

let root = new URL('../', import.meta.url).pathname
let decode = new TextDecoder()
let id = (n: number) => `b66dbec0-632c-4fe8-a5ed-${String(n).padStart(12, '0')}`
let PERSON = id(1), PROJECT = id(2), TARGET = id(3), SESSION = id(4)
let PERSONA = id(5), BOARD = id(6)
export let OPERATION_TASKS = 2000

/** Names are deliberately separate across process and HTTP boundaries. */
export let OPERATION_FAMILIES = [
  'task-new',
  'task-update',
  'comment-new',
  'decision-new',
  'decision-answer',
  'graph-schema',
  'history',
  'board-check',
  'project-check',
  'claim-take',
  'claim-release',
  'memory-save',
  'memory-recall',
  'topic-new',
  'topic-find',
  'persona-read',
  'storage-check',
  'archetype-check',
  'effect-check',
]
export let OPERATION_COMMANDS = ['cli', 'connector'].flatMap((door) =>
  OPERATION_FAMILIES.map((family) => `${door}/${family}`)
)

/** Full discovered command inventory, including unmeasured doors. This is a
 * report, not a claim that one measured family covers every registered door.
 * Pass the host's actual config to audit plugins beyond this fixture. */
export let inventory = async (
  config: Config = {
    ...starter(PERSON),
    plugins: [...starter(PERSON).plugins!, '@yaks/sqlite'],
  },
) => {
  let said = await declarations(config, true)
  let { TOOLS } = await import('../packages/cli/yak.ts')
  let toolNames = said.tools.map((tool) => tool.name).sort()
  let controls = said.controls.flatMap(({ value }) =>
    value?.commands?.map((c) => c.name) ?? []
  )
  return {
    tools: toolNames,
    fixture:
      'starter plus sqlite; CLI-only overrides may be absent from HTTP tools/list',
    cli: [
      ...new Set([
        ...TOOLS.map((t) => t.name),
        'trace',
        ...controls,
        ...toolNames,
      ]),
    ].sort(),
    measuredTools: OPERATION_FAMILIES.map((family) =>
      family.replaceAll('-', '_')
    ).sort(),
    unmeasuredTools: toolNames.filter((name) =>
      !OPERATION_FAMILIES.some((family) => family.replaceAll('-', '_') == name)
    ),
  }
}

export let SCALE_FAMILIES = [
  'task-list',
  'filtered-query',
  'history',
  'transcript-query',
]
export let OPERATION_SCALE = ['cli', 'connector'].flatMap((door) =>
  SCALE_FAMILIES.map((family) => `${door}/${family}`)
)
export let SCALE_TASKS = 50_000
export let SCALE_ENTRIES = 1000

type Operation = {
  family: string
  tool: string
  command: string[]
  args: () => Record<string, unknown>
  prepare?: () => Promise<void>
  verify: (text: string, args: Record<string, unknown>) => Promise<void> | void
}
let includes = (text: string, mark: string) => {
  if (!text.includes(mark)) {
    throw new Error(`missing ${mark}: ${text.slice(0, 800)}`)
  }
}

async function collect(
  args: string[] = [],
  scale = false,
): Promise<Record<string, Samples>> {
  let tasks = scale ? SCALE_TASKS : OPERATION_TASKS
  let n = Number(args[0] ?? 3)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-operations-' })
  let configPath = `${dir}/yak.json`
  let env = {
    TASKS_HOME: `${dir}/tasks`,
    HARNESS_HOME: `${dir}/harness`,
    HARNESS_WORKTREE_DIR: `${dir}/worktrees`,
    PROCESS_DIR: `${dir}/process`,
    YAK_RUNTIME_CACHE: `${dir}/runtime`,
    TASKS_SESSION: '',
    CLAUDE_SESSION_ID: '',
  }
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let results: Record<string, Samples> = {}
  try {
    await Deno.mkdir(`${dir}/transcripts`)
    let config = starter(PERSON)
    config.db = `${dir}/yak.db`
    config.duties = false
    config.plugins!.push('@yaks/sqlite')
    config.plugins = config.plugins?.map((p) =>
      p == '@yaks/session'
        ? { use: '@yaks/session', with: { transcripts: `${dir}/transcripts` } }
        : p
    )
    await Deno.writeTextFile(configPath, JSON.stringify(config))
    host = await compose(read(configPath), ['graph', 'web'])
    let graph = host.graph
    await graph.apply([
      {
        entity: { eid: PERSON },
        person: {},
        doc: { title: 'Operation person' },
      },
      {
        entity: { eid: PROJECT },
        project: {},
        doc: { title: 'Operation portfolio' },
      },
      {
        entity: { eid: SESSION },
        session: { id: 'benchmark-operation-session' },
      },
      {
        entity: { eid: PERSONA },
        persona: {},
        doc: {
          title: 'Operation persona',
          body: 'operation persona instructions',
        },
      },
      {
        entity: { eid: BOARD },
        board: { query: '.task !completed' },
        doc: { title: 'Operation board' },
      },
      ...Array.from({ length: tasks }, (_, i) => ({
        entity: { eid: i == 0 ? TARGET : crypto.randomUUID() },
        task: {},
        doc: {
          title: i == 0 ? 'Operation target' : `Operation task ${i}`,
          body: 'A populated independent-operation fixture.',
        },
        filed: { project: PROJECT },
      })),
    ])
    if (scale) {
      // A real long session in the same graph, not a phantom transcript count.
      for (let from = 0; from < SCALE_ENTRIES; from += 100) {
        await graph.apply(
          Array.from(
            { length: Math.min(100, SCALE_ENTRIES - from) },
            (_, i) => ({
              entity: { eid: crypto.randomUUID() },
              entry: { session: SESSION },
              content: {
                body: `Scale transcript turn ${from + i}: ${'x'.repeat(2048)}`,
              },
            }),
          ),
        )
      }
    }
    // The history read is populated, not the fast empty-log path.
    for (let i = 0; i < 40; i++) {
      await graph.apply([{
        entity: { eid: TARGET },
        doc: { body: `History revision ${i}` },
      }])
    }
    let cli = async (operation: Operation, input: Record<string, unknown>) => {
      let flags = Object.entries(input).flatMap(([key, value]) => [
        `--${key.replaceAll('_', '-')}`,
        typeof value == 'string' ? value : JSON.stringify(value),
      ])
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          '--config',
          `${root}deno.json`,
          `${root}packages/cli/yak.ts`,
          '--config',
          configPath,
          '--no-duties',
          ...operation.command,
          ...flags,
          '--json',
        ],
        cwd: root,
        env,
        stdin: 'null',
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (!out.success) {
        throw new Error(`${operation.tool}: ${decode.decode(out.stderr)}`)
      }
      return decode.decode(out.stdout)
    }
    if (!host.handler) throw new Error('missing HTTP handler')
    server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      host.handler,
    )
    let ask = rpc({ url: `http://127.0.0.1:${server.addr.port}/mcp` })
    await initialize(ask)
    let listed = await ask('tools/list', {})
    let registered = new Set(
      (listed.tools as { name: string }[]).map((t) => t.name),
    )
    console.error(
      'operation fixture registered tools:',
      [...registered].sort().join(', '),
    )
    console.error(
      'operation inventory:',
      JSON.stringify(await inventory(config)),
    )
    let seq = 0
    let fresh = (kind: string) => `operation ${kind} ${++seq}`
    let saved = async (q: string, mark: string) =>
      includes(JSON.stringify(await graph.read(q)), mark)
    let decision = id(7)
    let operations: Operation[] = [
      {
        family: 'task-new',
        tool: 'task_new',
        command: ['task', 'new'],
        args: () => ({ title: fresh('created task'), project: PROJECT }),
        verify: async (text, input) => {
          includes(text, String(input.title))
          await saved(`.task .doc.title="${input.title}" ?filed`, PROJECT)
        },
      },
      {
        family: 'task-update',
        tool: 'task_update',
        command: ['task', 'update'],
        args: () => ({
          task: TARGET,
          status: 'done',
          body: fresh('task body'),
        }),
        verify: async (text, input) => {
          includes(text, 'completed')
          await saved(
            `.entity.eid=${TARGET} ?doc ?completed`,
            String(input.body),
          )
        },
      },
      {
        family: 'comment-new',
        tool: 'comment_new',
        command: ['comment', 'new'],
        args: () => ({ target: TARGET, body: fresh('comment') }),
        verify: async (text, input) => {
          includes(text, String(input.body))
          await saved(`.comment.target=${TARGET} ?doc`, String(input.body))
        },
      },
      {
        family: 'decision-new',
        tool: 'decision_new',
        command: ['decision', 'new'],
        args: () => ({
          question: fresh('decision'),
          choices: [{ label: 'yes', description: 'Proceed' }, {
            label: 'no',
            description: 'Stop',
          }],
          recommended: 'yes',
          project: PROJECT,
        }),
        verify: async (text, input) => {
          includes(text, String(input.question))
          await saved(`.decision.question="${input.question}"`, 'yes')
        },
      },
      {
        family: 'decision-answer',
        tool: 'decision_answer',
        command: ['decision', 'answer'],
        prepare: async () => {
          decision = crypto.randomUUID()
          await graph.apply([{
            entity: { eid: decision },
            task: {},
            filed: { project: PROJECT },
            decision: {
              question: 'Proceed?',
              choices: [{ label: 'yes', description: 'Proceed' }, {
                label: 'no',
                description: 'Stop',
              }],
              recommended: 'yes',
            },
          }])
        },
        args: () => ({ decision, choice: 'yes' }),
        verify: async (text) => {
          includes(text, 'decided')
          await saved(
            `.entity.eid=${decision} ?decided ?completed`,
            'completed',
          )
        },
      },
      {
        family: 'graph-schema',
        tool: 'graph_schema',
        command: ['graph', 'schema'],
        args: () => ({ component: 'filed' }),
        verify: (text) => includes(text, 'priority'),
      },
      {
        family: 'history',
        tool: 'history',
        command: ['history'],
        args: () => ({ entity: TARGET, limit: 12 }),
        verify: (text) => includes(text, TARGET),
      },
      {
        family: 'board-check',
        tool: 'board_check',
        command: ['board', 'check'],
        args: () => ({}),
        verify: (text) =>
          includes(text, 'every saved board query still routes'),
      },
      {
        family: 'project-check',
        tool: 'project_check',
        command: ['project', 'check'],
        args: () => ({}),
        verify: (text) =>
          includes(text, 'every governed entity is reachable from a project'),
      },
      {
        family: 'claim-take',
        tool: 'claim_take',
        command: ['claim', 'take'],
        prepare: async () => {
          await graph.apply([{ entity: { eid: TARGET }, claim: null }])
        },
        args: () => ({ target: TARGET, session: SESSION }),
        verify: async (text) => {
          includes(text, SESSION)
          await saved(`.entity.eid=${TARGET} ?claim`, SESSION)
        },
      },
      {
        family: 'claim-release',
        tool: 'claim_release',
        command: ['claim', 'release'],
        prepare: async () => {
          await graph.apply([{
            entity: { eid: TARGET },
            claim: { session: SESSION },
          }])
        },
        args: () => ({ target: TARGET }),
        verify: async (text) => {
          includes(text, TARGET)
          if (
            JSON.stringify(await graph.read(`.entity.eid=${TARGET} ?claim`))
              .includes('"claim"')
          ) throw new Error('claim not released')
        },
      },
      {
        family: 'memory-save',
        tool: 'memory_save',
        command: ['memory', 'save'],
        args: () => ({
          said: fresh('remembered words'),
          title: 'Operation memory',
          scope: PROJECT,
        }),
        verify: async (text, input) => {
          includes(text, String(input.said))
          await saved('.memory ?doc', String(input.said))
        },
      },
      {
        family: 'memory-recall',
        tool: 'memory_recall',
        command: ['memory', 'recall'],
        args: () => ({ scope: PROJECT, limit: 3 }),
        verify: (text) => includes(text, 'Operation memory'),
      },
      {
        family: 'topic-new',
        tool: 'topic_new',
        command: ['topic', 'new'],
        args: () => ({
          name: fresh('topic'),
          body: 'Independent operation topics',
        }),
        verify: (text, input) => includes(text, String(input.name)),
      },
      {
        family: 'topic-find',
        tool: 'topic_find',
        command: ['topic', 'find'],
        args: () => ({ said: 'operation', limit: 3 }),
        verify: (text) => includes(text, 'Independent operation topics'),
      },
      {
        family: 'persona-read',
        tool: 'persona_read',
        command: ['persona', 'read'],
        args: () => ({ persona: PERSONA }),
        verify: (text) => includes(text, 'operation persona instructions'),
      },
      {
        family: 'storage-check',
        tool: 'storage_check',
        command: ['storage', 'check'],
        args: () => ({}),
        verify: (text) => includes(text, 'orphaned row'),
      },
      {
        family: 'archetype-check',
        tool: 'archetype_check',
        command: ['archetype', 'check'],
        args: () => ({}),
        verify: (text) => includes(text, 'archetype'),
      },
      {
        family: 'effect-check',
        tool: 'effect_check',
        command: ['effect', 'check'],
        args: () => ({}),
        verify: (text) => includes(text, 'effect'),
      },
    ]
    if (scale) {
      operations = [
        {
          family: 'task-list',
          tool: 'task_list',
          command: ['task', 'list'],
          args: () => ({ query: `.filed.project=${PROJECT}`, limit: 25 }),
          verify: (text) => includes(text, 'Operation task'),
        },
        {
          family: 'filtered-query',
          tool: 'graph_query',
          command: ['graph', 'query'],
          args: () => ({ q: `.task .filed.project=${PROJECT} .count` }),
          verify: (text) => includes(text, String(tasks)),
        },
        {
          family: 'history',
          tool: 'history',
          command: ['history'],
          args: () => ({ entity: TARGET, limit: 25 }),
          verify: (text) => includes(text, 'History revision 39'),
        },
        {
          family: 'transcript-query',
          tool: 'graph_query',
          command: ['graph', 'query'],
          args: () => ({ q: `.entry.session=${SESSION} ?content .limit=25` }),
          verify: (text) => includes(text, 'Scale transcript turn'),
        },
      ]
    }
    for (let operation of operations) {
      if (!registered.has(operation.tool)) {
        throw new Error(`unregistered operation ${operation.tool}`)
      }
      for (let door of ['cli', 'connector']) {
        let samples: Sample[] = []
        for (let i = 0; i < n; i++) {
          await operation.prepare?.()
          let input = operation.args()
          let start = performance.now()
          let text: string
          if (door == 'cli') text = await cli(operation, input)
          else {
            let answer = await ask('tools/call', {
              name: operation.tool,
              arguments: input,
            })
            if (answer.isError) {
              throw new Error(`${operation.tool}: ${JSON.stringify(answer)}`)
            }
            text = JSON.stringify(answer)
          }
          let value = performance.now() - start
          // Checks are outside the clock: the endpoint's complete response is
          // timed, while read-back proves a saved change rather than an ack.
          await operation.verify(text, input)
          samples.push({
            value,
            source: 'end-to-end',
            counts: { tasks, transcriptEntries: scale ? SCALE_ENTRIES : 0 },
            details: {
              fixture: 'starter SQLite; own HTTP; no duties',
              tool: operation.tool,
            },
          })
        }
        let name = `${door}/${operation.family}`
        results[name] = samples
        console.error(name, JSON.stringify(samples))
      }
    }
    return results
  } finally {
    await server?.shutdown()
    await host?.close()
    await Deno.remove(dir, { recursive: true })
  }
}
export let measure = (args: string[] = []) => collect(args)
export let measureScale = (args: string[] = []) => collect(args, true)
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
