/**
 * A page a plugin serves, exported as `@yaks/cli/page`: what a plugin's
 * routes answer with besides the graph's doors, in the process that serves
 * them. `kept` answers an address with a body made once and kept for the life
 * of the process (a stylesheet, a document); `bundle` makes one such body, a
 * page's script and everything it imports as one browser module. @yaks/web's
 * app and @yaks/inspect's page are each one.
 *
 * Making a body is bounded: one that has not settled within the limit is
 * aborted, which kills whatever it spawned, and counts as a failure. A failure
 * is never kept: it is reported once, where it happened, and the next request
 * makes the body again. So a build that hangs heals on its own, without
 * anybody restarting the host. A make still going when its host closes is
 * aborted too, so nothing it spawned outlives the host.
 *
 * @module
 */

import { fault } from '@yaks/api'
import { released } from './release.ts'

/** A body a page loads. */
export type Body = string | Uint8Array<ArrayBuffer>

/** How long a body may take to make before it is given up on. A bundle takes
 * about a second; a hung one never finishes (T-38240). */
export let LIMIT = 60_000

let sha = async (body: Body) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof body == 'string' ? new TextEncoder().encode(body) : body,
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)

// A body the browser may keep, revalidated on each load by its hash.
let tagged = async (request: Request, body: Body, type: string) => {
  let tag = `"${await sha(body)}"`
  let headers = { 'content-type': type, 'cache-control': 'no-cache', etag: tag }
  return request.headers.get('if-none-match') == tag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers })
}

/** `make(signal)`, given up on (and `signal` aborted) after `limit` ms, or
 * once `closing` aborts. */
export let within = <T>(
  limit: number,
  make: (signal: AbortSignal) => Promise<T>,
  closing?: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let stop = new AbortController()
    let quit = (why: string) => {
      stop.abort()
      reject(new Error(why))
    }
    if (closing?.aborted) return quit('the host is closing')
    let timer = setTimeout(
      () => quit(`not made within ${limit / 1000}s`),
      limit,
    )
    let close = () => quit('the host is closing')
    closing?.addEventListener('abort', close, { once: true })
    make(stop.signal).then(resolve, reject).finally(() => {
      clearTimeout(timer)
      closing?.removeEventListener('abort', close)
    })
  })

/** The handler that answers `where` with the body `make` makes. `early` starts
 * making it now, so the first request finds it made; `closing` is the host's
 * own signal, which ends a make still going. */
export let kept = (
  where: string,
  type: string,
  make: (signal: AbortSignal) => Promise<Body>,
  { early = false, limit = LIMIT, closing }: {
    early?: boolean
    limit?: number
    closing?: AbortSignal
  } = {},
): (request: Request) => Promise<Response> => {
  let made: Promise<Body> | undefined
  let attempt = () => {
    let now = within(limit, make, closing)
    made = now
    now.catch((e) => {
      if (made == now) made = undefined
      if (!closing?.aborted) fault(e, `GET ${where}`)
    })
    return now
  }
  if (early) attempt()
  return async (request: Request) => {
    try {
      return await tagged(request, await (made ?? attempt()), type)
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 500 })
    }
  }
}

// A bundler ends when it finishes, or when `kept` aborts it: past its limit,
// or as its host closes. Only a host killed outright leaves one behind, with
// its directory, which is named for that host's pid. The next bundle on the
// machine ends it and removes the directory. That sweep reads /proc, which is
// how a pid is known to be that bundler and not a stranger reusing it, so
// elsewhere it does nothing.
let PREFIX = 'yaks-page-'

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
export let sweep = async (base: string): Promise<void> => {
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
export let BUNDLE_LIMIT = TRY * TRIES

/** An entry written where it is bundled rather than read from a file: its
 * `code`, whose imports resolve as they would in a module at `at`. A page
 * composed of what a config's plugins contribute starts from one. */
export type Written = { code: string; at: URL }

/** One file of browser JavaScript: `entry` and everything it imports, by
 * `deno bundle`. Aborting `signal` kills the bundler.
 *
 * From a checkout the entry is a file, and the bundler runs where its
 * package's config is found, so the workspace resolves every import the way
 * it does there. From JSR it is a URL, and the bundler runs in a directory of
 * its own under the config a release resolves by (./release.ts): on the day
 * this one published the rest of it is exactly as new, and a bundler waiting
 * a day for it would find none. An entry `Written` here is put beside the
 * bundle and read the same way, from where it says it is. */
export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
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
let once = async (
  stop: AbortSignal,
  entry: URL | Written,
): Promise<string> => {
  let dir = await Deno.makeTempDir({ prefix: `${PREFIX}${Deno.pid}-` })
  await sweep(dir.slice(0, dir.lastIndexOf('/')))
  try {
    let to = `${dir}/app.js`
    let at = entry instanceof URL ? entry : entry.at
    let local = at.protocol == 'file:'
    if (!local) {
      await Deno.writeTextFile(`${dir}/deno.json`, JSON.stringify(released))
    }
    let from = entry instanceof URL
      ? local ? entry.pathname : entry.href
      : `${dir}/entry.ts`
    if (!(entry instanceof URL)) await Deno.writeTextFile(from, entry.code)
    let run = await new Deno.Command(Deno.execPath(), {
      args: [
        'bundle',
        '--quiet',
        '--platform',
        'browser',
        '--minify',
        '-o',
        to,
        from,
      ],
      cwd: local ? new URL('./', at).pathname : dir,
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
