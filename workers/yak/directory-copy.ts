import { cookieValue } from './lib/token.ts'
// Only anonymous page/file rendering may use this copy. It is not standing:
// stale members, grants or app modes could reauthorize a private store, and a
// Store can remember an older vouched mode. Never use it for API, workers,
// hostnames, MCP, signed-in access or writes.
//
// Purge cannot revoke a copy in another isolate. The independent serving
// object is consulted ONLY on a missed directory deadline, not on warm reads.
// Every directory mutation fences and clears it before entering SQLite, and
// the directory records that fence in its commit. Revision-matched fills
// cannot resurrect pre-mutation rows. A lost finish leaves it closed; the
// next successful write recovers it. No historical-query recomputation, no
// lease/TTL authorization and no remote await inside transactionSync.
//
// Unlike hop-free stale authorization this costs no coordination on a warm
// request. Its tradeoff is deliberate: an unrelated directory mutation drops
// the copy too. Cold/fenced/private reads still wait for the directory. Wider
// signed-in availability needs independent revocable serving authority, durable
// publication/recovery and monotonic Store policy, not a longer cache TTL.
import type { Fetcher } from './door.ts'
import type { Env } from './env.ts'
import { background } from './defects.ts'
export type DirectoryCopyTimer = {
  now(): number
  after(ms: number, callback: () => void): () => void
}

export type ServingCopyDoor = {
  begin(): Promise<number>
  finish(revision: number): Promise<boolean>
  put(revision: number, key: string, body: string): Promise<boolean>
  get(key: string): Promise<string | null>
}
export type ServingCopies = {
  idFromName(name: string): unknown
  get(id: unknown): ServingCopyDoor
}
export let copyOf = (env: Pick<Env, 'SERVING_COPY'>) =>
  env.SERVING_COPY?.get(env.SERVING_COPY.idFromName('public'))

export let EPOCH = 'x-yak-directory-revision'
let timer: DirectoryCopyTimer = {
  now: Date.now,
  after: (ms, done) => {
    let id = setTimeout(done, ms)
    return () => clearTimeout(id)
  },
}

/** The real directory wins normally. Only a successful copy ends a stall. */
export let publicDirectory = (
  via: Fetcher,
  copy: ServingCopyDoor | undefined,
  time = timer,
  used: () => void = () => {},
): Fetcher & { stale?: boolean } => {
  if (!copy) return via
  let began = time.now()
  let door: Fetcher & { stale?: boolean } = {
    fetch: (req) => {
      if (req.method != 'GET') return via.fetch(req)
      let key = new URL(req.url).searchParams.get('q') ?? ''
      let headers = new Headers(req.headers)
      headers.set(EPOCH, '1')
      let direct = via.fetch(new Request(req, { headers }))
      return new Promise<Response>((resolve, reject) => {
        let cancel = time.after(Math.max(0, began + 25 - time.now()), () => {
          void copy.get(key).then((body) => {
            if (body == null) return
            door.stale = true
            used()
            resolve(new Response(body))
          }, () => {})
        })
        void direct.then((answer) => {
          cancel()
          resolve(answer)
          let epoch = answer.headers.get(EPOCH)
          if (answer.ok && epoch != null && /^\d+$/.test(epoch)) {
            background(
              answer.clone().text().then((body) =>
                copy.put(Number(epoch), key, body)
              ).then(() => {}, () => {}),
            )
          }
        }, (e) => {
          cancel()
          reject(e)
        })
      })
    },
  }
  return door
}

// This only excludes a possible identity; it grants no standing. A browser
// seal has no person. Signature verification still happens at the ordinary
// session door; malformed/unknown cookies conservatively take that door.
export let possiblePerson = (req: Request) => {
  let header = req.headers.get('cookie')
  if (!header) return false
  let token = cookieValue(header)
  if (!token) return false
  try {
    let part = token.split('.')[0]
    let value = JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/')))
    return typeof value != 'object' || value == null || 'person' in value
  } catch {
    return true
  }
}

/** Public-only rendering, never a cookie's standing. */
export let anonymousPage = (req: Request) =>
  (req.method == 'GET' || req.method == 'HEAD') &&
  !possiblePerson(req) &&
  !['authorization', 'upgrade', 'x-yak-caller'].some((h) =>
    req.headers.has(h)
  ) && !/\/(?:api|_web)(?:\/|$)|\/~/.test(new URL(req.url).pathname)
