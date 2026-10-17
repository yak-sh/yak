import { cookieValue } from './lib/token.ts'
// Anonymous pages retain the hop-free warm path (publicDirectory). Signed
// access uses signedDirectory: every body is pinned to one committed revision
// and checked against the independent durable serving authority. Directory
// mutations revoke that revision before committing, not through cache purge.
// Cold/fenced copies still wait for the directory; no TTL grants standing.
import type { Fetcher } from './door.ts'
import type { Env } from './env.ts'
import { background } from './defects.ts'
export type DirectoryCopyTimer = {
  now(): number
  after(ms: number, callback: () => void): () => void
}

export type ServingCopyDoor = {
  read?(key: string): Promise<{ revision: number; body: string } | null>
  valid?(revision: number): Promise<boolean>
  publish?(revision: number, key: string, body: string): Promise<boolean>
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

/** A directory write refused at commit for holding a fence older than one
 * already committed. Nothing of it was written. */
export class Unfenced extends Error {
  constructor(what = 'Directory write') {
    super(`${what} lost its serving fence`)
  }
}

// The copy grants fences in order, but their answers resume the directory in
// any order, so a write can come back holding a revision older than one a
// concurrent write already committed under. Its commit refuses it, and it
// takes a fresh fence; only a write that keeps losing the race fails.
export let fenced = async <T>(
  copy: ServingCopyDoor,
  write: (revision: number) => T | Promise<T>,
  tries = 4,
): Promise<T> => {
  let revision = await copy.begin()
  try {
    let out = await write(revision)
    // A failed write leaves the copy fenced; never resurrect it on rollback.
    await copy.finish(revision)
    return out
  } catch (e) {
    if (!(e instanceof Unfenced) || tries <= 1) throw e
    return fenced(copy, write, tries - 1)
  }
}

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
        let settled = false
        let cancel = time.after(Math.max(0, began + 25 - time.now()), () => {
          void copy.get(key).then((body) => {
            if (body == null || settled) return
            settled = true
            door.stale = true
            used()
            resolve(new Response(body))
          }, () => {})
        })
        void direct.then((answer) => {
          cancel()
          if (!settled) {
            settled = true
            resolve(answer)
          }
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
          if (!settled) {
            settled = true
            reject(e)
          }
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

/** A request-scoped, revision-pinned view of the independently revocable
 * directory. Bodies are data, not authority: every answer checks the current
 * fence, including warm directory answers. Never share this door across requests. */
export let signedDirectory = (
  via: Fetcher,
  copy: ServingCopyDoor | undefined,
  time = timer,
): Fetcher & { signed?: boolean } => {
  if (!copy) return via
  let began = time.now()
  let pinned: number | undefined
  let unavailable = () =>
    new Response('Serving authority unavailable', { status: 503 })
  let accept = async (revision: number, body: string) => {
    if (pinned !== undefined && pinned !== revision) return unavailable()
    if (!await copy.valid?.(revision)) return unavailable()
    if (pinned !== undefined && pinned !== revision) return unavailable()
    pinned = revision
    return new Response(body, { headers: { [EPOCH]: String(revision) } })
  }
  return {
    signed: true,
    fetch: (req) => {
      if (req.method !== 'GET') {
        return via.fetch(req).then((answer) => {
          if (answer.ok) {
            pinned = undefined
            began = time.now()
          }
          return answer
        })
      }
      let key = new URL(req.url).searchParams.get('q') ?? ''
      return new Promise<Response>((resolve) => {
        let settled = false
        let done = (answer: Response) => {
          if (settled) {
            void answer.body?.cancel()
            return
          }
          settled = true
          cancel()
          resolve(answer)
        }
        let fallback = async () => {
          try {
            let answer = await copy.read?.(key)
            // A miss cannot turn a healthy but slow first read into a 503.
            if (answer) done(await accept(answer.revision, answer.body))
          } catch { /* Wait for the directory on a cold or fenced miss. */ }
        }
        let cancel = time.after(Math.max(0, began + 25 - time.now()), () => {
          void fallback()
        })
        let headers = new Headers(req.headers)
        headers.set(EPOCH, '1')
        void (async () => {
          // Nothing has escaped before the first accepted answer. A concurrent
          // directory write may overtake that first read; reread it a bounded
          // number of times, never resetting an established request revision.
          for (let attempt = 0; attempt < 3; attempt++) {
            let answer: Response
            try {
              answer = await via.fetch(new Request(req, { headers }))
            } catch {
              await fallback()
              return
            }
            if (!answer.ok) {
              done(answer)
              return
            }
            let epoch = answer.headers.get(EPOCH)
            if (epoch == null || !/^\d+$/.test(epoch)) {
              done(unavailable())
              return
            }
            let revision = Number(epoch)
            let body = await answer.text()
            await copy.publish?.(revision, key, body)
            let accepted = await accept(revision, body)
            if (accepted.ok || pinned !== undefined || attempt == 2) {
              done(accepted)
              return
            }
          }
        })().catch(() => done(unavailable()))
      })
    },
  }
}
