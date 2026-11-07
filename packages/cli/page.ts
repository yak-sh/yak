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
 * A release makes some bodies ahead: what a fresh install serves, made from
 * the release's own checkout as it publishes (bin/publish.ts) and shipped in
 * `./made/`, each under the hash of a key naming what it was made of. `ahead`
 * finds one, so a host composed the same way answers with it instead of making
 * it on the person's machine. A checkout ships none, and makes every body.
 *
 * @module
 */

import { fault } from '@yaks/api/refuse'
import * as disk from '@yaks/file/io'
import { importing } from '@yaks/fp/imports'
import { settling } from './held.ts'

/** A body a page loads. */
export type Body = string | Uint8Array<ArrayBuffer>

/** How long a body may take to make before it is given up on. A bundle from a
 * checkout takes a few seconds, one from JSR far longer (./remote-page.ts),
 * which is why a release makes a fresh install's ahead; a hung one never
 * finishes (T-38240). */
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

/** Where a release keeps the bodies it made ahead. */
export let MADE: URL = new URL('./made/', import.meta.url)

let made = async (key: string, at: URL) => new URL(`${await sha(key)}.json`, at)

/** The body made ahead for `key`, or undefined where none was. */
export let ahead = async (
  key: string,
  at: URL = MADE,
): Promise<string | undefined> => {
  try {
    let { default: { body } } = await import((await made(key, at)).href, {
      with: { type: 'json' },
    })
    return body
  } catch (e) {
    if ((e as { code?: string }).code == 'ERR_MODULE_NOT_FOUND') return
    throw e
  }
}

/** Keep `body` in `dir` (a release's `./made/`) where `ahead(key)` finds it. */
export let keep = async (
  dir: URL,
  key: string,
  body: string,
): Promise<void> => {
  await disk.mkdir(dir, { recursive: true })
  await disk.writeTextFile(await made(key, dir), JSON.stringify({ body }))
}

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
    let made: Promise<void> | undefined
    // Answered at once when given up on, and let finish what it spawned
    // before the process ends (./held.ts). Only a make it stopped: one still
    // going is its own host's, not a closing process's to wait on.
    let quit = (why: string) => {
      stop.abort()
      if (made) settling.add(made)
      reject(new Error(why))
    }
    if (closing?.aborted) return quit('the host is closing')
    let timer = setTimeout(
      () => quit(`not made within ${limit / 1000}s`),
      limit,
    )
    let close = () => quit('the host is closing')
    closing?.addEventListener('abort', close, { once: true })
    made = make(stop.signal).then(resolve, reject).finally(() => {
      clearTimeout(timer)
      closing?.removeEventListener('abort', close)
      settling.delete(made!)
    })
  })

/** The handler that answers `where` with the body `make` makes. `early` is
 * handed its making, to start ahead of the first request (@yaks/host
 * `Host.early`), which then finds it made; `closing` is the host's own signal,
 * which ends a make still going. Its `tag()` is the etag of the body made,
 * undefined until one is. */
export let kept = (
  where: string,
  type: string,
  make: (signal: AbortSignal) => Promise<Body>,
  { early, limit = LIMIT, closing }: {
    early?: (make: () => Promise<unknown>) => void
    limit?: number
    closing?: AbortSignal
  } = {},
): Kept => {
  let made: Promise<Made> | undefined
  let tag: string | undefined
  let attempt = () => {
    let now = within(limit, make, closing).then(async (value) => {
      let body = typeof value == 'string' ? value : new Uint8Array(value)
      tag = `"${await sha(body)}"`
      return { body, tag }
    })
    made = now
    now.catch((e) => {
      if (made == now) made = undefined
      if (!closing?.aborted) fault(e, `GET ${where}`)
    })
    return now
  }
  early?.(() => made ?? attempt())
  let handle = async (request: Request) => {
    try {
      return await tagged(request, await (made ?? attempt()), type)
    } catch (e) {
      return new Response(String((e as Error).message ?? e), { status: 500 })
    }
  }
  return Object.assign(handle, { tag: () => tag })
}

/** What {@link kept} answers with: the handler, and the tag of what it made. */
export type Kept = ((request: Request) => Promise<Response>) & {
  tag: () => string | undefined
}

/** An entry written where it is bundled rather than read from a file: its
 * `code`, whose imports resolve as they would in a module at `at`. */
export type Written = { code: string; at: URL }

/** What a build made: its output, and what it read where it says. */
export type Built = {
  outputFiles?: { text: string }[]
  metafile?: { inputs: { [path: string]: unknown } }
}

/** The operations one build owns, independent of its compiler's service. */
export type Build = {
  rebuild: () => Promise<Built>
  cancel: () => Promise<void>
  dispose: () => Promise<void>
}

/** Finish or cancel one build, always releasing its context. */
export let compiled = async (
  build: Build,
  signal?: AbortSignal,
  done: (built: Built) => void = () => {},
): Promise<string> => {
  let cancel = () => {
    void build.cancel()
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    if (signal?.aborted) throw new Error('browser bundle was stopped')
    let result = await build.rebuild()
    if (signal?.aborted) throw new Error('browser bundle was stopped')
    done(result)
    return result.outputFiles![0].text
  } finally {
    signal?.removeEventListener('abort', cancel)
    await build.dispose()
  }
}

// Deno fetches every import it can read in a module's source with the module
// graph, a dynamic one that never runs included, so the bundlers are imported
// by a computed address: a host serving only bodies made ahead downloads no
// esbuild.
let bundlers = {
  local: new URL('./local-page.ts', import.meta.url),
  remote: new URL('./remote-page.ts', import.meta.url),
}

/** One browser module: from a checkout, resolved through the npm workspace
 * (./local-page.ts); from JSR, through Deno's resolver (./remote-page.ts).
 * Every build owns its cancellation and cleanup, so concurrent builds stay
 * independent. */
export let bundle = async (
  entry: URL | Written,
  signal?: AbortSignal,
): Promise<string> => {
  if (signal?.aborted) throw new Error('browser bundle was stopped')
  let at = entry instanceof URL ? entry : entry.at
  let from = at.protocol == 'file:' ? bundlers.local : bundlers.remote
  let bundler: { bundle: typeof bundle } = await importing(from.href)
  return bundler.bundle(entry, signal)
}
