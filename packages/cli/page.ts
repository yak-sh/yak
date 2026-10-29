/**
 * A page a plugin serves, exported as `@yaks/cli/page`: what a plugin's
 * routes answer with besides the graph's doors, in the process that serves
 * them. `kept` answers an address with a body made once and kept for the life
 * of the process (a stylesheet, a document); `bundle` makes one such body, a
 * page's script and everything it imports as one browser module. @yaks/web's
 * app and @yaks/inspect's page are each one.
 *
 * Making a body is bounded: one that has not settled within the limit is
 * aborted, cancelling the work it owns, and counts as a failure. A failure
 * is never kept: it is reported once, where it happened, and the next request
 * makes the body again. So a build that hangs heals on its own, without
 * anybody restarting the host. A make still going when its host closes is
 * aborted too, so nothing it spawned outlives the host.
 *
 * @module
 */

import { fault } from '@yaks/api/refuse'
import { released } from './release.ts'

/** A body a page loads. */
export type Body = string | Uint8Array<ArrayBuffer>

/** How long a body may take to make before it is given up on. A bundle takes
 * a few seconds; a hung one never finishes (T-38240). */
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
type Made = { body: Body; tag: string }
let tagged = (request: Request, { body, tag }: Made, type: string) => {
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
  let made: Promise<Made> | undefined
  let attempt = () => {
    let now = within(limit, make, closing).then(async (value) => {
      let body = typeof value == 'string' ? value : new Uint8Array(value)
      return { body, tag: `"${await sha(body)}"` }
    })
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

/** An entry written where it is bundled rather than read from a file: its
 * `code`, whose imports resolve as they would in a module at `at`. */
export type Written = { code: string; at: URL }

/** The operations one build owns, independent of its compiler's service. */
export type Build = {
  rebuild: () => Promise<{ outputFiles?: { text: string }[] }>
  cancel: () => Promise<void>
  dispose: () => Promise<void>
}

/** Finish or cancel one build, always releasing its context. */
export let compiled = async (build: Build, signal?: AbortSignal) => {
  let cancel = () => {
    void build.cancel()
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    if (signal?.aborted) throw new Error('browser bundle was stopped')
    let result = await build.rebuild()
    if (signal?.aborted) throw new Error('browser bundle was stopped')
    return result.outputFiles![0].text
  } finally {
    signal?.removeEventListener('abort', cancel)
    await build.dispose()
  }
}

// Pass the discovered config to both halves of the loader: its native loader
// otherwise starts `deno info --no-config`, losing the workspace's lock pins.
let configAt = async (at: URL): Promise<string | undefined> => {
  let dir = new URL('./', at)
  for (;;) {
    for (let name of ['deno.json', 'deno.jsonc']) {
      let path = new URL(name, dir)
      try {
        if ((await Deno.stat(path)).isFile) return path.pathname
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      }
    }
    let parent = new URL('../', dir)
    if (parent.href == dir.href) return
    dir = parent
  }
}

/** One browser module, compiled by esbuild's JavaScript service bridge and
 * Deno's workspace resolver, replacing the `deno bundle` bridge that can
 * deadlock (T-38240). Each context owns its cancellation and cleanup, so
 * concurrent builds cannot stop one another's compiler. */
export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
): Promise<string> => {
  if (signal?.aborted) throw new Error('browser bundle was stopped')
  let [{ context }, { denoPlugins, urlToEsbuildResolution }] = await Promise
    .all([
      import('esbuild'),
      import('@luca/esbuild-deno-loader'),
    ])
  let at = entry instanceof URL ? entry : entry.at
  let dir = at.protocol == 'file:'
    ? undefined
    : await Deno.makeTempDir({ prefix: 'yaks-page-' })
  let from = entry instanceof URL ? entry : new URL('./.yak-page.ts', at)
  let virtual = urlToEsbuildResolution(from)
  try {
    if (dir) {
      await Deno.writeTextFile(`${dir}/deno.json`, JSON.stringify(released))
    }
    let configPath = dir ? `${dir}/deno.json` : await configAt(at)
    if (signal?.aborted) throw new Error('browser bundle was stopped')
    let build = await context({
      absWorkingDir: dir ?? new URL('./', at).pathname,
      entryPoints: [from.href],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'esnext',
      minify: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        ...entry instanceof URL ? [] : [{
          name: 'written',
          setup(build: import('esbuild').PluginBuild) {
            build.onResolve(
              { filter: /.*/ },
              (args) =>
                args.kind == 'entry-point' && args.path == from.href
                  ? virtual
                  : undefined,
            )
            build.onLoad(
              { filter: /.*/, namespace: virtual.namespace },
              (args) =>
                args.path == virtual.path
                  ? { contents: entry.code, loader: 'ts' }
                  : undefined,
            )
          },
        }],
        // The loader carries esbuild 0.20 types; its plugin API is unchanged.
        ...denoPlugins(
          { configPath },
        ) as import('esbuild').Plugin[],
      ],
    })
    return await compiled(build, signal)
  } finally {
    if (dir) await Deno.remove(dir, { recursive: true })
  }
}
