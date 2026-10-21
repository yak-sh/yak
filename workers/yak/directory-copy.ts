import { cookieValue } from './lib/token.ts'
// Anonymous pages retain the hop-free warm path (publicDirectory). Signed
// access uses signedDirectory: every body is checked against the independent
// durable serving authority at the revision it was read. Directory
// mutations revoke that revision before committing, not through cache purge.
// Cold/fenced copies still wait for the directory; no TTL grants standing.
import type { Fetcher } from './door.ts'
import type { Env } from './env.ts'
import { background, defect } from './defects.ts'
import { evicted, lost, opaque, retried } from '@yaks/durable-object'
export type DirectoryCopyTimer = {
  now(): number
  after(ms: number, callback: () => void): () => void
}

export type ServingCopyDoor = {
  read?(key: string): Promise<{ revision: number; body: string } | null>
  valid?(revision: number): Promise<boolean>
  publish?(revision: number, key: string, body: string): Promise<boolean>
  begin(): Promise<number>
  /** The newest fence raised, committed or not. */
  revision?(): Promise<number>
  finish(revision: number): Promise<boolean>
  /** A failed mutation ends its fence at the directory's committed revision. */
  settle?(revision: number, committed: number): Promise<boolean>
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
//
// A write that dies leaves its fence up with nobody to lower it: the write
// failed at `begin` itself (the copy raised the fence, the answer was lost),
// or its isolate went with a deploy between `begin` and `finish`. `mend`
// lowers a fence no write of this isolate holds, at the revision the
// directory has committed. A write that fails mends as it leaves, and a signed
// read still fenced after its first look asks the directory to mend (MEND), so
// a fence is up for as long as a write holds it and never longer.
let open = 0
export let mend = async (copy: ServingCopyDoor, committed: () => number) => {
  let revision = await copy.revision?.()
  if (revision != null && open == 0) await copy.settle?.(revision, committed())
}

export let fenced = async <T>(
  copy: ServingCopyDoor,
  write: (revision: number) => T | Promise<T>,
  committed: () => number,
  tries = 4,
): Promise<T> => {
  open++
  let failed = true
  try {
    for (;; tries--) {
      let revision = await retried(() => copy.begin(), true, moving)
      try {
        let out = await write(revision)
        await retried(() => copy.finish(revision), true, moving)
        failed = false
        return out
      } catch (e) {
        if (!(e instanceof Unfenced) || tries <= 1) throw e
      }
    }
  } finally {
    open--
    if (failed) {
      await mend(copy, committed).catch((e) => {
        if (!moving(e)) defect(e, { request: 'serving fence mend' })
      })
    }
  }
}

// What the runtime fails a call into the copy with while a deploy moves it.
// `begin` is sent again too: one whose answer was lost leaves a fence the
// next one supersedes, and the write commits under the newer revision. A
// copy still moving after `backoff`'s pauses fails the write, which commits
// nothing without its fence.
let moving = (e: unknown) => evicted(e) || lost(e) || opaque(e)

export let EPOCH = 'x-yak-directory-revision'
/** A signed read still fenced asks the directory to mend an orphaned fence. */
export let MEND = 'x-yak-mend'
/** How long a signed read waits for a directory write to release its fence. */
export let FENCE_WAIT = 15_000
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
): Fetcher & { stale?: boolean; versioned?: boolean } => {
  if (!copy) return via
  let began = time.now()
  let door: Fetcher & { stale?: boolean; versioned?: boolean } = {
    versioned: true,
    fetch: (req) => {
      if (req.method != 'GET') return via.fetch(req)
      let key = new URL(req.url).searchParams.get('q') ?? ''
      let headers = new Headers(req.headers)
      headers.set(EPOCH, '1')
      let direct = via.fetch(new Request(req, { headers }))
      return new Promise<Response>((resolve, reject) => {
        let settled = false
        let cancel = time.after(Math.max(0, began + 25 - time.now()), () => {
          void (copy.read
            ? copy.read(key)
            : copy.get(key).then((body) =>
              body == null ? null : { body, revision: undefined }
            )).then((answer) => {
              if (answer == null || settled) return
              settled = true
              door.stale = true
              used()
              resolve(
                new Response(answer.body, {
                  headers: answer.revision == null
                    ? {}
                    : { [EPOCH]: String(answer.revision) },
                }),
              )
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
  let unavailable = () =>
    new Response('Serving authority unavailable', { status: 503 })
  let accept = async (revision: number, body: string) =>
    await confirms(copy, revision)
      ? new Response(body, { headers: { [EPOCH]: String(revision) } })
      : null
  return {
    signed: true,
    fetch: (req) => {
      if (req.method !== 'GET') return via.fetch(req)
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
            // A miss cannot turn a healthy but slow first read into a 503, and
            // a fenced copy is no answer: the directory read keeps waiting.
            if (!answer) return false
            let accepted = await accept(answer.revision, answer.body)
            if (accepted) done(accepted)
            return !!accepted
          } catch { /* Wait for the directory on a cold or fenced miss. */ }
          return false
        }
        let cancel = time.after(Math.max(0, began + 25 - time.now()), () => {
          void fallback()
        })
        let headers = new Headers(req.headers)
        headers.set(EPOCH, '1')
        let from = time.now()
        // One read of the directory: an answer that stands, a refusal
        // included, or null while nothing can be confirmed yet.
        let look = async (): Promise<Response | null> => {
          let answer: Response
          try {
            answer = await via.fetch(new Request(req, { headers }))
          } catch {
            await fallback()
            return null
          }
          if (answer.status == 503) {
            void answer.body?.cancel()
            return null
          }
          if (!answer.ok) return answer
          let epoch = answer.headers.get(EPOCH)
          if (epoch == null || !/^\d+$/.test(epoch)) {
            void answer.body?.cancel()
            return null
          }
          let revision = Number(epoch)
          let body = await answer.text()
          try {
            await copy.publish?.(revision, key, body)
          } catch { /* The copy is filled again by the next read. */ }
          let accepted = await accept(revision, body)
          if (!accepted) headers.set(MEND, '1')
          return accepted
        }
        void (async () => {
          // Nothing has escaped before the first accepted answer. A directory
          // write holds the fence until it commits, and until then no copied
          // or read body may stand as authority. That is a wait, never an
          // answer: reread with backoff until the fence clears, bounded by
          // FENCE_WAIT. Each body stands on being current when accepted, so a
          // write landing between a request's reads fences the next one for
          // the write's duration and no longer.
          //
          // A directory or copy that cannot answer for a moment is waited out
          // the same way, since it has said nothing: a deploy moves both
          // objects, and the runtime fails a call into one while it moves.
          for (let pause = 10; !settled; pause = Math.min(pause * 2, 250)) {
            let answer = await look()
            if (settled) return
            if (answer || time.now() - from >= FENCE_WAIT) {
              done(answer ?? unavailable())
              return
            }
            await new Promise<void>((resume) => time.after(pause, resume))
          }
        })().catch((e) => {
          defect(e, { request: 'signed directory read' })
          done(unavailable())
        })
      })
    },
  }
}

/** Whether the copy says a revision is current. A copy that cannot answer,
 * moving with a deploy, has not said so. */
export let confirms = async (copy: ServingCopyDoor, revision: number) => {
  try {
    return !!await copy.valid?.(revision)
  } catch {
    return false
  }
}
