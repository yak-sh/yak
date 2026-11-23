// `yak start`: run the factory on a developer's own machine (D-470).
//
// It signs in to yaks.app if this machine has not, finds the agent CLIs on
// the PATH (claude, codex), adds yaks.app's MCP server to each so the
// developer's own sessions reach their space, and registers the machine in
// the space, lending those CLIs (@yaks/spawn `machine_register`). Then it
// installs a user service that keeps the runner going: a LaunchAgent on
// macOS, a systemd user unit on Linux. The service runs `yak start
// --foreground`, the runner itself (@yaks/spawn/runner): it dials out to
// yaks.app, takes each session asked of this machine, runs it with the
// developer's own CLI in a checkout of its own, and hands it back.
//
// It reads no CLI's sign-in: each CLI keeps its own.

import * as system from '@yaks/process/system'
import * as disk from '@yaks/file/io'
import { command } from '@yaks/process/command'
import type { Bundle, Comp } from '@yaks/graph'
import { remote } from './remote.ts'
import { doorUrl } from './rpc.ts'
import { stateDir, tokenFor } from './store.ts'
import type { Command, Ctx } from './run.ts'

/** The CLIs a machine can lend, as @yaks/spawn's adapters name them. */
export let CLIS = ['claude', 'codex']

/** What the service is called: the systemd unit, and the LaunchAgent's
 * label. */
export let UNIT = 'yak-runner'
export let LABEL = 'app.yaks.runner'

/** A service that keeps a command going: what it runs, where, and with which
 * environment. */
export type Service = {
  argv: string[]
  cwd: string
  env: Record<string, string>
  /** where a LaunchAgent writes what the runner says */
  log?: string
}

let xml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/**
 * The LaunchAgent property list that keeps `s` going on macOS: started at
 * login and again whenever it stops.
 *
 * ```ts
 * import { launchAgent } from './start.ts'
 * import { assertStringIncludes } from '@std/assert'
 *
 * let plist = launchAgent({ argv: ['yak', 'start', '--foreground'], cwd: '/r', env: {} })
 * assertStringIncludes(plist, '<string>--foreground</string>')
 * assertStringIncludes(plist, '<key>KeepAlive</key>')
 * ```
 */
export let launchAgent = (s: Service): string => {
  let strings = (list: string[]) =>
    list.map((a) => `    <string>${xml(a)}</string>`).join('\n')
  let env = Object.entries(s.env).map(([k, v]) =>
    `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`
  ).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings(s.argv)}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(s.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
${
    s.log
      ? `  <key>StandardOutPath</key>
  <string>${xml(s.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(s.log)}</string>
`
      : ''
  }</dict>
</plist>
`
}

// One word of a systemd command line or setting: quoted, with what systemd
// would expand (`%` specifiers, `$` variables) written literally.
let word = (s: string) =>
  `"${
    s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')
      .replaceAll('$', '$$$$')
  }"`

/**
 * The systemd user unit that keeps `s` going on Linux: started with the
 * person's user manager and again whenever it stops.
 *
 * ```ts
 * import { systemdUnit } from './start.ts'
 * import { assertStringIncludes } from '@std/assert'
 *
 * let unit = systemdUnit({ argv: ['yak', 'start', '--foreground'], cwd: '/r', env: { PATH: '/bin' } })
 * assertStringIncludes(unit, 'ExecStart="yak" "start" "--foreground"')
 * assertStringIncludes(unit, 'Environment="PATH=/bin"')
 * assertStringIncludes(unit, 'WantedBy=default.target')
 * ```
 */
export let systemdUnit = (s: Service): string =>
  `[Unit]
Description=yak runner: the sessions yaks.app asks of this machine
After=network-online.target

[Service]
ExecStart=${s.argv.map(word).join(' ')}
WorkingDirectory=${word(s.cwd)}
${
    Object.entries(s.env).map(([k, v]) => `Environment=${word(`${k}=${v}`)}`)
      .join('\n')
  }
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`

// A program on the PATH, by its whole path.
let onPath = async (name: string): Promise<string | undefined> => {
  for (let dir of (system.env.get('PATH') ?? '').split(':').filter(Boolean)) {
    try {
      let info = await disk.stat(`${dir}/${name}`)
      if (info.isFile) return `${dir}/${name}`
    } catch (e) {
      if (!disk.isNotFound(e)) throw e
    }
  }
}

let ran = async (program: string, args: string[]) => {
  let out = await command(program, { args, stdin: 'null' }).output()
  return {
    ok: out.success,
    said: new TextDecoder().decode(out.stderr).trim(),
  }
}

// Add yaks.app's MCP server to a CLI, under the name `yaks`, where it has
// none of that name. Its sign-in to the server is the CLI's own: it asks once,
// the first time a session uses it.
let attach = async (cli: string, url: string, note: (l: string) => void) => {
  if ((await ran(cli, ['mcp', 'get', 'yaks'])).ok) return
  let added = cli == 'claude'
    ? await ran(cli, [
      'mcp',
      'add',
      '--scope',
      'user',
      '--transport',
      'http',
      'yaks',
      url,
    ])
    : await ran(cli, ['mcp', 'add', 'yaks', '--url', url])
  note(
    added.ok
      ? `added yaks.app's MCP server to ${cli} as yaks`
      : `could not add yaks.app's MCP server to ${cli}: ${added.said}`,
  )
}

// What a command answers: the body of the first row that has one.
let bodyOf = (rows: Bundle[]) =>
  String((rows.find((b) => b.content)?.content as Comp | undefined)?.body ?? '')

// Install and start the service, replacing one already there.
let install = async (s: Service, note: (l: string) => void) => {
  let home = disk.homedir()
  if (system.os == 'darwin') {
    let dir = `${home}/Library/LaunchAgents`
    let path = `${dir}/${LABEL}.plist`
    await disk.mkdir(dir, { recursive: true })
    await disk.mkdir(`${home}/Library/Logs`, { recursive: true })
    await disk.writeTextFile(path, launchAgent(s))
    let domain = `gui/${system.uid()}`
    await ran('launchctl', ['bootout', `${domain}/${LABEL}`])
    let up = await ran('launchctl', ['bootstrap', domain, path])
    if (!up.ok) throw new Error(`launchctl bootstrap ${path}: ${up.said}`)
    note(`installed ${path}; it says what it does in ${s.log}`)
    return
  }
  if (system.os != 'linux') {
    throw new Error(
      `yak start keeps a service on macOS and Linux, not ${system.os}`,
    )
  }
  let dir = `${
    system.env.get('XDG_CONFIG_HOME') ?? `${home}/.config`
  }/systemd/user`
  let path = `${dir}/${UNIT}.service`
  await disk.mkdir(dir, { recursive: true })
  await disk.writeTextFile(path, systemdUnit(s))
  for (let args of [['daemon-reload'], ['enable', UNIT], ['restart', UNIT]]) {
    let done = await ran('systemctl', ['--user', ...args])
    if (!done.ok) {
      throw new Error(`systemctl --user ${args.join(' ')}: ${done.said}`)
    }
  }
  note(`installed ${path}; \`journalctl --user -u ${UNIT}\` says what it does`)
}

// The runner, until this process is told to stop.
let foreground = async (
  host: string,
  machine: string,
  dir: string,
  space: string | undefined,
  as: string | undefined,
): Promise<number> => {
  let stop = new AbortController()
  for (let signal of ['SIGTERM', 'SIGINT'] as const) {
    system.addSignalListener(signal, () => stop.abort())
  }
  let { checkouts, launching, run } = await import('@yaks/spawn/runner')
  let url = doorUrl(host)
  console.error(
    `yak runner: ${machine} takes the sessions its space asks of it`,
  )
  await run({
    machine,
    call: async (tool, args) =>
      bodyOf(
        await remote(tool, { ...args, ...space ? { space } : {} }, {
          url: new URL(url).origin,
          as,
        }),
      ),
    checkout: checkouts(dir, `${stateDir()}/runs`),
    launch: launching,
    mcp: { yaks: url },
    token: () => tokenFor(host, undefined, { as }),
    signal: stop.signal,
    report: (error, what) => console.error(`yak runner: ${what}: ${error}`),
  })
  return 0
}

let start = async (args: Record<string, unknown>, c: Ctx): Promise<number> => {
  let host = c.host
  let machine = String(args.machine ?? '') || system.hostname()
  let dir = String(args.dir ?? '') || system.cwd()
  let space = args.space ? String(args.space) : undefined
  if (args.foreground) return await foreground(host, machine, dir, space, c.as)
  if (!await tokenFor(host, undefined, { as: c.as })) {
    let { main } = await import('./main.ts')
    let code = await main(['auth', host])
    if (code) return code
  }
  let clis: string[] = []
  for (let cli of CLIS) if (await onPath(cli)) clis.push(cli)
  if (!clis.length) {
    c.note(
      'neither claude nor codex is on your PATH: install one, sign in to it, ' +
        'and run yak start again',
    )
    return 1
  }
  for (let cli of clis) await attach(cli, doorUrl(host), c.note)
  await remote('machine_register', {
    machine,
    clis,
    ...space ? { space } : {},
  }, { url: new URL(doorUrl(host)).origin, as: c.as })
  let yak = await onPath('yak')
  let argv = [
    ...yak ? [yak] : [system.execPath(), 'run', '-A', system.mainModule],
    'start',
    '--foreground',
    '--machine',
    machine,
    '--dir',
    dir,
    ...space ? ['--space', space] : [],
    ...c.as ? ['--as', c.as] : [],
  ]
  await install({
    argv,
    cwd: dir,
    env: { PATH: system.env.get('PATH') ?? '/usr/bin:/bin' },
    log: `${disk.homedir()}/Library/Logs/${UNIT}.log`,
  }, c.note)
  let names = clis.map((cli) => `'${cli} on ${machine}'`)
  c.out(
    `${machine} runs the sessions asked of ${names.join(' and ')}, in ` +
      `checkouts of ${dir}: yak session spawn T-1 --provider ${names[0]}`,
  )
  return 0
}

/** `yak start`. */
export let startCommand: Command = {
  name: 'start',
  description:
    'run the factory on this machine: sign in to yaks.app, register this machine in your space, and keep a runner that runs each session asked of it with your own claude or codex',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      machine: {
        type: 'string',
        description: "this machine's name in your space (default its hostname)",
      },
      dir: {
        type: 'string',
        description:
          'the git checkout each session gets a worktree of (default the current directory)',
      },
      space: {
        type: 'string',
        description: 'the space to run sessions for (default your own)',
      },
      foreground: {
        type: 'boolean',
        description:
          'be the runner, in this terminal, rather than install the service that runs it',
      },
    },
  },
  run: start,
}
