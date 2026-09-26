// The browser's code: main.tsx and everything it imports, bundled into one
// file by Deno's own bundler. Built once per process, like every other module
// a host loaded: a changed view reaches the browser when the server restarts,
// not before.
//
// From a checkout main.tsx is a file, and the bundler runs where this
// package's config is found, so the workspace resolves every import the way it
// does here. From JSR it is a URL, and the bundler runs in a directory of its
// own under the config a release resolves by (@yaks/cli/release): on the day
// this one published the rest of it is exactly as new, and a bundler waiting a
// day for it would find none.

import { released } from '@yaks/cli/release'

// A bundler ends when it finishes, or when kept.ts aborts it: past its limit,
// or as its host closes. Only a host killed outright leaves one behind, with
// its directory, which is named for that host's pid. The next bundle on the
// machine ends it and removes the directory. That sweep reads /proc, which is
// how a pid is known to be that bundler and not a stranger reusing it, so
// elsewhere it does nothing.
let PREFIX = 'yaks-web-'

let exists = (path: string) => Deno.stat(path).then(() => true, () => false)

// The processes whose command line names `dir`: the bundler writing into it.
let writing = async (dir: string) => {
  let pids: number[] = []
  for await (let e of Deno.readDir('/proc')) {
    if (!/^\d+$/.test(e.name)) continue
    let line = await Deno.readTextFile(`/proc/${e.name}/cmdline`).catch(() =>
      ''
    )
    if (line.split('\0').some((arg) => arg.startsWith(`${dir}/`))) {
      pids.push(Number(e.name))
    }
  }
  return pids
}

/** End the bundlers, and remove the directories, of hosts that are gone. */
export let sweep = async (base: string) => {
  if (!await exists('/proc/self')) return
  for await (let e of Deno.readDir(base)) {
    let host = e.isDirectory && e.name.startsWith(PREFIX) &&
      e.name.slice(PREFIX.length).split('-')[0]
    if (!host || !/^\d+$/.test(host) || await exists(`/proc/${host}`)) continue
    let dir = `${base}/${e.name}`
    for (let pid of await writing(dir)) {
      try {
        Deno.kill(pid, 'SIGKILL')
      } catch { /* it ended on its own */ }
    }
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

// TODO(T-38240): the tries stand in for a fix in Deno. Its 2.9.1 bundler
// sometimes never finishes: `deno bundle` stops reading its esbuild service,
// whose stdout pipe fills (61 KB unread, esbuild blocked writing, deno idle in
// epoll). About one bundle in eight hung with eight at once on this box. A try
// that hangs is killed and the bundle tried again.

/** How long one try may take: a bundle takes a few seconds, eight at once. */
let TRY = 20_000

/** How many tries a bundle gets. */
let TRIES = 3

/** The longest a bundle takes, every try together. */
export let LIMIT = TRY * TRIES

/** One file of browser JavaScript from `entry` (main.tsx), by `deno bundle`.
 * Aborting `signal` kills the bundler. */
export let bundle = async (
  signal?: AbortSignal,
  entry: URL = new URL('./main.tsx', import.meta.url),
): Promise<string> => {
  for (let tried = 1;; tried++) {
    let late = AbortSignal.timeout(TRY)
    try {
      return await once(signal ? AbortSignal.any([signal, late]) : late, entry)
    } catch (e) {
      if (!late.aborted || signal?.aborted) throw e
      if (tried == TRIES) {
        throw new Error(
          `deno bundle did not finish in ${TRIES} tries of ${TRY / 1000}s`,
        )
      }
    }
  }
}

// One try: the bundler, killed if `stop` aborts.
let once = async (stop: AbortSignal, entry: URL): Promise<string> => {
  let dir = await Deno.makeTempDir({ prefix: `${PREFIX}${Deno.pid}-` })
  await sweep(dir.slice(0, dir.lastIndexOf('/')))
  try {
    let to = `${dir}/app.js`
    let local = entry.protocol == 'file:'
    if (!local) {
      await Deno.writeTextFile(`${dir}/deno.json`, JSON.stringify(released))
    }
    let run = await new Deno.Command(Deno.execPath(), {
      args: [
        'bundle',
        '--quiet',
        '--platform',
        'browser',
        '--minify',
        '-o',
        to,
        local ? entry.pathname : entry.href,
      ],
      cwd: local ? new URL('./', entry).pathname : dir,
      stdout: 'piped',
      stderr: 'piped',
      signal: stop,
    }).output()
    if (stop.aborted) throw new Error('deno bundle was stopped')
    if (!run.success) {
      throw new Error(
        `deno bundle failed: ${new TextDecoder().decode(run.stderr).trim()}`,
      )
    }
    return await Deno.readTextFile(to)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}
