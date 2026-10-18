/** Person waits through real CLI processes, the box MCP HTTP door and a PTY.
 * The fixed corpus is 2,000 tasks and a 1 MiB Claude transcript, not the live
 * graph. All databases, terminal state and owned processes go away in finally.
 * Timings include the response/paint, not merely dispatch. No detached duties.
 */
import type { Samples } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { initialize, rpc } from '../packages/cli/rpc.ts'

export let PERSON_COMMANDS = [
  'cli/help',
  'cli/task-list',
  'cli/graph-show',
  'cli/graph-query',
  'cli/graph-apply',
  'hook/UserPromptSubmit',
  'connector/graph-query',
  'connector/graph-apply',
  'tui/startup',
  'tui/query-navigation',
]
let root = new URL('../', import.meta.url).pathname
let decoder = new TextDecoder()
let delay = () => new Promise((resolve) => setTimeout(resolve, 10))
let quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
let PERSON = '1d55ab2c-76da-4b66-9c37-e871a427f100'
let TARGET = '1d55ab2c-76da-4b66-9c37-e871a427f101'
export let TASKS = 2000

/** Refuse an empty/error hook answer: shell `|| true` must not hide a failed
 * hook and accidentally bank a fast failure as a performance improvement. */
export let hookAnswer = (text: string): boolean =>
  text.includes('previous reply ended:') &&
  (text.includes('Prompt sent:') || text.includes('Prompt observed:'))

/** Bounded waiting is for an observed terminal paint, never a fixed startup
 * sleep. tmux's capture round trip is deliberately inside the timed boundary. */
let painted = async (capture: () => Promise<string>, mark: string) => {
  let until = performance.now() + 60_000
  let last = ''
  while (performance.now() < until) {
    last = await capture()
    if (last.includes(mark)) return
    await delay()
  }
  throw new Error(`terminal never painted ${mark}: ${last}`)
}

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(args[0] ?? 3)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127095-person-' })
  let configPath = `${dir}/yak.json`
  let transcript = `${dir}/transcript.jsonl`
  let env = {
    TASKS_HOME: `${dir}/tasks`,
    HARNESS_HOME: `${dir}/harness`,
    HARNESS_WORKTREE_DIR: `${dir}/worktrees`,
    PROCESS_DIR: `${dir}/process`,
    TASKS_TUI_STATE: `${dir}/tui.json`,
    YAK_RUNTIME_CACHE: `${dir}/runtime`,
    TASKS_SESSION: '',
    CLAUDE_SESSION_ID: '',
  }
  let command = [
    Deno.execPath(),
    'run',
    '-A',
    '--config',
    `${root}deno.json`,
    `${root}packages/cli/yak.ts`,
    '--config',
    configPath,
    '--no-duties',
  ]
  let cli = async (argv: string[], input?: string) => {
    let child = new Deno.Command(command[0], {
      args: [...command.slice(1), ...argv],
      cwd: root,
      env,
      stdin: input == null ? 'null' : 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    if (input != null) {
      let writer = child.stdin.getWriter()
      await writer.write(new TextEncoder().encode(input))
      await writer.close()
    }
    let result = await child.output()
    if (!result.success) {
      throw new Error(`${argv.join(' ')}: ${decoder.decode(result.stderr)}`)
    }
    return decoder.decode(result.stdout)
  }
  let results: Record<string, Samples> = {}
  let timed = async (name: string, run: () => Promise<void>) => {
    let samples = []
    for (let i = 0; i < n; i++) {
      let start = performance.now()
      await run()
      samples.push({
        value: performance.now() - start,
        source: 'end-to-end',
        counts: { tasks: TASKS },
        details: {
          fixture: 'starter SQLite; duties disabled; own ephemeral HTTP + PTY',
        },
      })
    }
    results[name] = samples
    console.error(name, JSON.stringify(samples))
  }
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let socket = `${dir}/tmux.sock`
  let tmuxStarted = false
  let tmux = async (...argv: string[]) => {
    let out = await new Deno.Command('tmux', {
      args: ['-f', '/dev/null', '-S', socket, ...argv],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!out.success) {
      throw new Error(`tmux ${argv.join(' ')}: ${decoder.decode(out.stderr)}`)
    }
    return decoder.decode(out.stdout)
  }
  try {
    let config = starter(PERSON)
    config.db = `${dir}/yak.db`
    config.duties = false
    config.plugins!.push('@yaks/inspect')
    // No live transcript import or filesystem persona service is ever run.
    config.plugins = config.plugins?.map((p) =>
      p == '@yaks/session'
        ? {
          use: '@yaks/session',
          with: { transcripts: `${dir}/empty-transcripts` },
        }
        : p
    )
    await Deno.mkdir(`${dir}/empty-transcripts`)
    await Deno.writeTextFile(configPath, JSON.stringify(config))
    host = await compose(read(configPath), ['graph', 'web'])
    await host.graph.apply([
      {
        entity: { eid: PERSON },
        person: {},
        doc: { title: 'Benchmark person' },
      },
      ...Array.from({ length: TASKS }, (_, i) => ({
        entity: { eid: i == 0 ? TARGET : crypto.randomUUID() },
        task: {},
        doc: {
          title: i == 0 ? 'Person benchmark target' : `Benchmark task ${i}`,
          body: 'A task whose read and edit cross the real command boundary.',
        },
      })),
    ])
    // Enough old turns to catch whole-transcript scanning, followed by a real
    // completed reply and pending matching prompt as Claude writes them.
    let old = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-16T12:00:00.000Z',
      message: { content: 'x'.repeat(2048), stop_reason: 'end_turn' },
    }) + '\n'
    let ended = '2026-10-17T12:00:00.000Z'
    await Deno.writeTextFile(
      transcript,
      old.repeat(512) +
        JSON.stringify({
          type: 'assistant',
          timestamp: ended,
          message: { stop_reason: 'end_turn' },
        }) + '\n' +
        JSON.stringify({
          type: 'queue-operation',
          operation: 'enqueue',
          timestamp: '2026-10-17T12:00:01.000Z',
          content: 'benchmark prompt',
        }) + '\n',
    )
    let hook = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'benchmark-person',
      transcript_path: transcript,
      cwd: root,
      prompt: 'benchmark prompt',
    })
    // Real HTTP server; the production MCP handler prepares, authenticates,
    // executes and serializes each response. No fake tool implementation.
    if (!host.handler) throw new Error('web host has no handler')
    server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      host.handler,
    )
    let url = `http://127.0.0.1:${server.addr.port}`
    // Composition starts the browser bundle in the background. Finish that
    // fixture work before timing commands, so its compiler cannot compete
    // with CLI startup or the connector on this same host.
    let asset = await fetch(`${url}/web/app.js`)
    if (!asset.ok) throw new Error(`fixture asset: ${asset.status}`)
    if (!(await asset.arrayBuffer()).byteLength) {
      throw new Error('fixture asset is empty')
    }
    // First: preserve today's cost before the independent hook fix changes it.
    await timed('hook/UserPromptSubmit', async () => {
      let out = await cli(['session', 'context', '--hook', '-'], hook)
      if (!hookAnswer(out)) {
        throw new Error(`hook returned no timing context: ${out}`)
      }
    })
    await timed('cli/help', async () => {
      if (!(await cli(['help'])).includes('yak')) {
        throw new Error('missing help')
      }
    })
    await timed('cli/task-list', async () => {
      if (!(await cli(['task', 'list'])).includes('Person benchmark target')) {
        throw new Error('missing task list')
      }
    })
    await timed('cli/graph-show', async () => {
      if (
        !(await cli(['graph', 'show', TARGET])).includes(
          'Person benchmark target',
        )
      ) throw new Error('missing shown task')
    })
    await timed('cli/graph-query', async () => {
      if (
        !(await cli(['graph', 'query', '.task .count', '--json'])).includes(
          String(TASKS),
        )
      ) throw new Error('wrong task count')
    })
    let edit = 0
    await timed('cli/graph-apply', async () => {
      let body = `CLI edit ${++edit}`
      await cli([
        'graph',
        'apply',
        '--bundles',
        JSON.stringify([{ entity: { eid: TARGET }, doc: { body } }]),
      ])
      if (
        JSON.stringify(await host!.graph.read(`.entity.eid=${TARGET} ?doc`))
          .includes(body) == false
      ) throw new Error('CLI write not committed')
    })
    let ask = rpc({ url: `${url}/mcp` })
    await initialize(ask)
    await timed('connector/graph-query', async () => {
      let answer = await ask('tools/call', {
        name: 'graph_query',
        arguments: { q: '.task .count' },
      })
      if (answer.isError || !JSON.stringify(answer).includes(String(TASKS))) {
        throw new Error(`MCP query: ${JSON.stringify(answer)}`)
      }
    })
    await timed('connector/graph-apply', async () => {
      let body = `Connector edit ${++edit}`
      let answer = await ask('tools/call', {
        name: 'graph_apply',
        arguments: { bundles: [{ entity: { eid: TARGET }, doc: { body } }] },
      })
      if (answer.isError || !JSON.stringify(answer).includes(body)) {
        throw new Error(`MCP apply: ${JSON.stringify(answer)}`)
      }
    })
    // The terminal command takes its server address from the real config.
    config.port = server.addr.port
    await Deno.writeTextFile(configPath, JSON.stringify(config))
    let terminal = [
      ...Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`),
      ...command.map(quote),
      'inspect',
      quote(TARGET),
    ].join(' ')
    let history = JSON.stringify({
      entries: [{ path: '/?q=.task%20.count', state: null }, {
        path: '/' + TARGET + '?v=Debug',
        state: null,
      }],
      at: 1,
    })
    await Deno.writeTextFile(env.TASKS_TUI_STATE, history)
    let capture = () => tmux('capture-pane', '-p', '-t', 'bench')
    await timed('tui/startup', async () => {
      await tmux(
        'new-session',
        '-d',
        '-s',
        'bench',
        '-x',
        '160',
        '-y',
        '40',
        terminal + ' 2>' + quote(dir + '/terminal.log') + ' || { cat ' +
          quote(dir + '/terminal.log') + '; sleep 2; }',
      )
      tmuxStarted = true
      await painted(capture, 'Person benchmark target')
      await tmux('send-keys', '-t', 'bench', 'q')
      // Quit is the application's own shutdown; do not kill its Deno child.
      await painted(async () => {
        try {
          return await tmux('list-sessions')
        } catch {
          return 'closed'
        }
      }, 'closed')
      tmuxStarted = false
    })
    await Deno.writeTextFile(env.TASKS_TUI_STATE, history)
    await tmux(
      'new-session',
      '-d',
      '-s',
      'bench',
      '-x',
      '160',
      '-y',
      '40',
      terminal + ' 2>' + quote(dir + '/terminal.log') + ' || { cat ' +
        quote(dir + '/terminal.log') + '; sleep 2; }',
    )
    tmuxStarted = true
    await painted(capture, 'Person benchmark target')
    await timed('tui/query-navigation', async () => {
      await tmux('send-keys', '-t', 'bench', 'h')
      await painted(capture, TASKS.toLocaleString('en-US'))
      await tmux('send-keys', '-t', 'bench', 'C-f')
      await painted(capture, 'Person benchmark target')
    })
    return results
  } finally {
    if (tmuxStarted) {
      await tmux('send-keys', '-t', 'bench', 'Escape').catch(() => {})
      await tmux('send-keys', '-t', 'bench', 'q').catch(() => {})
      await painted(async () => {
        try {
          return await tmux('list-sessions')
        } catch {
          return 'closed'
        }
      }, 'closed').catch(() => {})
      // Only this run's private tmux socket, never the shared server.
      await tmux('kill-server').catch(() => {})
    }
    try {
      console.error(
        'terminal log:',
        await Deno.readTextFile(dir + '/terminal.log'),
      )
    } catch { /* no terminal yet */ }
    await server?.shutdown()
    await host?.close()
    await Deno.remove(dir, { recursive: true })
  }
}

if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
