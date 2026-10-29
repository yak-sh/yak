/** Terminal input waits through the real branch CLI, PTY, HTTP and SQLite.
 * Comments are the terminal's writable text surface: G puts the cursor on the
 * composer, the page's last item, and i types into it; typing paints and saves
 * a durable draft, Enter submits it. H goes back, as h walks left. Inspector title,
 * body and component edits are deliberately browser-only (inspectIo.edits),
 * so this fixture does not pretend to exercise those unavailable controls.
 */
import { processCpu, type Samples, stopwatch } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { settled } from './settled.ts'
import { starter } from '../packages/cli/init.ts'

export let TERMINAL_INTERACTIONS = [
  'tui/comment-keystroke-paint',
  'tui/comment-draft-save',
  'tui/comment-submit',
  'tui/query-to-answer',
]
let root = new URL('../', import.meta.url).pathname
let PERSON = '1d55ab2c-76da-4b66-9c37-e871a427f200'
let TARGET = '1d55ab2c-76da-4b66-9c37-e871a427f201'
let quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"
let decoder = new TextDecoder()

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(args[0] ?? 1)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-terminal-' })
  let socket = `${dir}/tmux.sock`
  let configPath = `${dir}/yak.json`
  let env = {
    TASKS_HOME: `${dir}/tasks`,
    HARNESS_HOME: `${dir}/harness`,
    HARNESS_WORKTREE_DIR: `${dir}/worktrees`,
    PROCESS_DIR: `${dir}/process`,
    TASKS_TUI_STATE: `${dir}/tui.json`,
    YAK_RUNTIME_CACHE: `${dir}/runtime`,
    TASKS_SESSION: '',
    CLAUDE_CODE_SESSION_ID: '',
  }
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let started = false
  let terminal = 0
  let tmux = async (...args: string[]) => {
    let out = await new Deno.Command('tmux', {
      args: ['-f', '/dev/null', '-S', socket, ...args],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!out.success) {
      throw new Error(`tmux ${args.join(' ')}: ${decoder.decode(out.stderr)}`)
    }
    return decoder.decode(out.stdout)
  }
  let capture = () => tmux('capture-pane', '-p', '-t', 'bench')
  let until = async (description: string, ready: () => Promise<boolean>) => {
    let end = performance.now() + 60_000
    while (performance.now() < end) {
      if (await ready()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(
      `${description} never completed:\n${await capture()}\ndrafts: ${
        JSON.stringify(await host!.graph.read('.draft ?draft'))
      }`,
    )
  }
  let paint = (text: string) =>
    until(`paint ${text}`, async () => (await capture()).includes(text))
  let keys = (...args: string[]) => tmux('send-keys', '-t', 'bench', ...args)
  let type = (text: string) => keys('-l', text)
  let has = async (query: string, text: string) =>
    JSON.stringify(await host!.graph.read(query)).includes(text)
  let results: Record<string, Samples> = {}
  let serial = 0
  let timed = async (
    name: string,
    setup: () => (() => Promise<void>) | Promise<() => Promise<void>>,
  ) => {
    let samples = []
    for (let i = 0; i < n; i++) {
      let run = await setup()
      let took = stopwatch(() => processCpu(terminal))
      await run()
      samples.push({
        ...took(),
        source: 'end-to-end',
        counts: { tasks: 2000 },
        details: {
          fixture:
            'isolated starter SQLite + own HTTP + PTY; completion observed, no fixed sleeps',
        },
      })
    }
    results[name] = samples
    console.error(name, JSON.stringify(samples))
  }
  let comment = `.comment.target=${TARGET} ?doc`
  let draft = `.draft.place=${TARGET}.comment ?draft`
  let posted = (text: string) =>
    until(`saved comment ${text}`, () => has(comment, text))
  let saved = (text: string) =>
    until(`saved draft ${text}`, () => has(draft, text))
  try {
    await Deno.mkdir(`${dir}/empty-transcripts`)
    let config = starter(PERSON)
    config.db = `${dir}/yak.db`
    config.duties = false
    config.plugins!.push('@yaks/inspect')
    config.plugins = config.plugins?.map((p) =>
      p == '@yaks/session'
        ? {
          use: '@yaks/session',
          with: { transcripts: `${dir}/empty-transcripts` },
        }
        : p
    )
    await Deno.writeTextFile(configPath, JSON.stringify(config))
    host = await compose(read(configPath), ['graph', 'web'])
    await settled(host)
    await host.graph.apply([
      {
        entity: { eid: PERSON },
        person: {},
        doc: { title: 'Terminal benchmark person' },
      },
      ...Array.from(
        { length: 2000 },
        (_, i) => ({
          entity: { eid: i ? crypto.randomUUID() : TARGET },
          task: {},
          doc: {
            title: i ? `Terminal task ${i}` : 'Terminal editing target',
            body: 'An isolated task for terminal comments.',
          },
        }),
      ),
    ])
    if (!host.handler) throw new Error('missing HTTP handler')
    server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      host.handler,
    )
    config.port = server.addr.port
    await Deno.writeTextFile(configPath, JSON.stringify(config))
    await Deno.writeTextFile(
      env.TASKS_TUI_STATE,
      JSON.stringify({
        entries: [{ path: `/${TARGET}?v=Comments`, state: null }],
        at: 0,
      }),
    )
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
      'browse',
    ]
    let launch = [
      ...Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`),
      ...command.map(quote),
    ].join(' ')
    await tmux(
      'new-session',
      '-d',
      '-s',
      'bench',
      '-x',
      '160',
      '-y',
      '60',
      `${launch} 2>${quote(dir + '/terminal.log')}`,
    )
    started = true
    terminal = Number(await tmux('display-message', '-p', '#{pid}'))
    if (!Number.isSafeInteger(terminal) || terminal < 1) {
      throw new Error('missing terminal server pid')
    }
    await paint('comment…')
    // Each sample reopens the actual palette and types into its freshly
    // mounted input. Neither a target title nor the query heading is an answer.
    await timed('tui/query-to-answer', async () => {
      let state = JSON.parse(await Deno.readTextFile(env.TASKS_TUI_STATE))
      if (state.entries[state.at].path == '/?.task%20.count') {
        await keys('H')
        await paint('comment…')
      }
      await keys('/')
      await paint('Type words or a query')
      return async () => {
        await type('.task ')
        await paint('.task ')
        await type('.count')
        await paint('.task .count')
        await paint('2,000') // aggregate preview, not an entity tile
        await keys('Enter')
        await until('addressed populated query answer', async () => {
          // History is written by the other process; a read can meet its
          // truncate/write boundary, which is not a completed navigation.
          let text = await Deno.readTextFile(env.TASKS_TUI_STATE)
          let state
          try {
            state = JSON.parse(text)
          } catch {
            return false
          }
          return state.entries[state.at].path == '/?.task%20.count' &&
            /^│[^│]*│2,000\s*$/m.test(await capture())
        })
      }
    })
    await keys('H')
    await paint('comment…')
    await keys('G')
    await keys('i')
    // Keystroke timing ends on usable input paint. Submission resets between
    // samples outside that timing; it is measured independently below.
    await timed('tui/comment-keystroke-paint', () => {
      let text = `terminal-paint-${++serial}`
      return async () => {
        await type(text)
        await paint(text)
        // Reset is not part of the keystroke figure.
      }
    })
    await keys('Enter')
    await posted('terminal-paint-')
    await timed('tui/comment-draft-save', () => {
      let text = `terminal-draft-${++serial}`
      return async () => {
        await type(text)
        await saved(text)
        await paint(text)
      }
    })
    await keys('Enter')
    await posted('terminal-draft-')
    await timed('tui/comment-submit', async () => {
      let text = `terminal-submit-${++serial}`
      await type(text)
      await saved(text)
      return async () => {
        await keys('Enter')
        await posted(text)
        await paint(text)
      }
    })
    return results
  } finally {
    if (started) {
      // Ctrl-C quits from any focus in one byte. Escape then q does not: the
      // terminal holds a bare Escape for 25 ms to tell it from Alt
      // (packages/tui/run.ts), so the pair reads as Alt-q in the composer.
      await keys('C-c').catch(() => {})
      await until('terminal shutdown', async () => {
        try {
          await tmux('list-sessions')
          return false
        } catch {
          return true
        }
      }).catch((e) => console.error(e.message))
      await tmux('kill-server').catch(() => {})
    }
    try {
      console.error(
        'terminal log:',
        await Deno.readTextFile(`${dir}/terminal.log`),
      )
    } catch { /* not launched */ }
    await server?.shutdown()
    await host?.close()
    await Deno.remove(dir, { recursive: true })
  }
}
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
