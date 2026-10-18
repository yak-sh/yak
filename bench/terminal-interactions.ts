/** Terminal input waits through the real branch CLI, PTY, HTTP and SQLite.
 * Comments are the terminal's writable text surface: i focuses the composer,
 * typing paints and saves a durable draft, Enter submits it. Inspector title,
 * body and component edits are deliberately browser-only (inspectIo.edits),
 * so this fixture does not pretend to exercise those unavailable controls.
 */
import type { Samples } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'

export let TERMINAL_INTERACTIONS = [
  'tui/comment-keystroke-paint',
  'tui/comment-draft-save',
  'tui/comment-submit',
]
let root = new URL('../', import.meta.url).pathname
let PERSON = '1d55ab2c-76da-4b66-9c37-e871a427f200'
let TARGET = '1d55ab2c-76da-4b66-9c37-e871a427f201'
let quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"
let decoder = new TextDecoder()

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(args[0] ?? 3)
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
    CLAUDE_SESSION_ID: '',
  }
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let started = false
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
      let start = performance.now()
      await run()
      samples.push({
        value: performance.now() - start,
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
    await paint('comment…')
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
      await keys('Escape').catch(() => {})
      await keys('q').catch(() => {})
      await until('terminal shutdown', async () => {
        try {
          await tmux('list-sessions')
          return false
        } catch {
          return true
        }
      }).catch(() => {})
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
