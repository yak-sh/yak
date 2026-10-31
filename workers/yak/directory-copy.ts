import { cookieValue } from './lib/token.ts'
// The directory answers every read itself, and a copy of its answers stands in
// when it stalls: publicDirectory for anonymous pages, signedDirectory for
// signed access, where a copied body stands only while the independent serving
// copy holds its revision current. Directory mutations fence that revision
// before committing, not through cache purge. Cold/fenced copies still wait
// for the directory; no TTL grants standing.
import type { Fetcher } from './door.ts'
import type { Env } from './env.ts'
import { background, defect } from './defects.ts'
import { elapsed } from './lib/hops.ts'
import { evicted, jittered, lost, opaque, retried } from '@yaks/durable-object'
import { type Clock, system } from '@yaks/fp'

export type ServingCopyDoor = {
  read?(key: string): Promise<{ revision: number; body: string } | null>
  valid?(revision: number): Promise<boolean>
  publish?(revision: number, key: string, body: string): Promise<boolean>
  /** Many answers in one trip, each said as `publish` says it. */
  publishes?(answers: Filled[]): Promise<boolean[]>
  begin(): Promise<number>
  /** The newest fence raised, committed or not. */
  revision?(): Promise<number>
  finish(revision: number): Promise<boolean>
  /** A failed mutation ends its fence at the directory's committed revision. */
  settle?(revision: number, committed: number): Promise<boolean>
  put(revision: number, key: string, body: string): Promise<boolean>
  get(key: string): Promise<string | null>
}
/** One answer for the copy: its revision, its key and its body. */
export type Filled = [revision: number, key: string, body: string]
export type ServingCopies = {
  idFromName(name: string): unknown
  get(id: unknown): ServingCopyDoor
}
export let copyOf = (env: Pick<Env, 'SERVING_COPY'>) => {
  let copy = env.SERVING_COPY?.get(env.SERVING_COPY.idFromName('public'))
  return copy && timedCopy(copy)
}

// Each call into the copy is a round trip to its object, summed on the
// request's tally as `copy_wait` (timing.ts).
let timedCopy = (copy: ServingCopyDoor): ServingCopyDoor => {
  let timed = <T>(call: () => Promise<T>) => elapsed('copy_wait', call)
  let { read, valid, publish, publishes, revision, settle } = copy
  return {
    ...read && { read: (key) => timed(() => copy.read!(key)) },
    ...valid && { valid: (at) => timed(() => copy.valid!(at)) },
    ...publish && {
      publish: (at, key, body) => timed(() => copy.publish!(at, key, body)),
    },
    ...publishes && {
      publishes: (answers) => timed(() => copy.publishes!(answers)),
    },
    ...revision && { revision: () => timed(() => copy.revision!()) },
    ...settle && {
      settle: (at, committed) => timed(() => copy.settle!(at, committed)),
    },
    begin: () => timed(() => copy.begin()),
    finish: (at) => timed(() => copy.finish(at)),
    put: (at, key, body) => timed(() => copy.put(at, key, body)),
    get: (key) => timed(() => copy.get(key)),
  }
}

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
// read whose answer the copy refuses at a revision it still fences asks the
// directory to mend (MEND), so a fence is up for as long as a write holds it
// and never longer.
//
// A write holds its fence from the `begin` that raises it until it commits
// (`released`, the directory's commit hook) or fails, and not while its effects
// run after the commit: a wake's job runs in the effects of the write that
// fired it, for as long as the job takes, and a fence orphaned meanwhile is
// still lowered. A `begin` on its way holds whatever revision it will be
// answered, so no fence is lowered while one is.
let raising = 0
let held = new Set<number>()

/** The directory committed a write under this fence: it holds it no longer. */
export let released = (revision: number) => void held.delete(revision)

/** Lower an orphaned fence, if there is one. Never throws: a copy that cannot
 * answer is mended by the next read that finds the fence. */
export let mend = async (copy: ServingCopyDoor, committed: () => number) => {
  try {
    if (raising) return
    let revision = await copy.revision?.()
    if (revision == null || raising || held.has(revision)) return
    await copy.settle?.(revision, committed())
  } catch (e) {
    if (!moving(e)) defect(e, { request: 'serving fence mend' })
  }
}

export let fenced = async <T>(
  copy: ServingCopyDoor,
  write: (revision: number) => T | Promise<T>,
  committed: () => number,
  clock: Clock = system,
  tries = 4,
): Promise<T> => {
  let wait = jittered(clock)
  let failed = true
  try {
    for (;; tries--) {
      raising++
      let revision: number
      try {
        revision = await retried(() => copy.begin(), true, moving, wait)
        held.add(revision)
      } finally {
        raising--
      }
      let out: T
      try {
        out = await write(revision)
      } catch (e) {
        if (!(e instanceof Unfenced) || tries <= 1) throw e
        continue
      } finally {
        released(revision)
      }
      await retried(() => copy.finish(revision), true, moving, wait)
      failed = false
      return out
    }
  } finally {
    if (failed) await mend(copy, committed)
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
/** How long a read waits on the directory before asking the copy as well. A
 * far colo's healthy read takes 100 ms and more, so this sits beyond it: every
 * ask of the copy is trips of its own. Once a read of a request has gone this
 * long, the request's later reads ask at once. */
export let STALL = 250
/** The directory's door for many reads in one trip (Store `#reads`). */
export let READS = '/reads'
// What fits in one trip's address; what doesn't fit goes in another.
let ROOM = 8_000

// A task's worth of work, in which everything a page asks together is asked:
// callers that split on a shared answer resume at different depths of the
// same turn, so a microtask would see only the first of them.
let turn = (then: () => void) => void setTimeout(then, 0)

/** The directory door with reads gathered: the reads asked in one turn travel
 * as one trip, however many callers asked them, and each caller is answered
 * its own lines. A store still on the code before the door answers 404 while
 * a deploy moves it, and the reads then go one at a time. Never share across
 * requests. */
export let gathered = (via: Fetcher): Fetcher => {
  type Asked = {
    req: Request
    q: string
    answer: (r: Response) => void
    fail: (e: unknown) => void
  }
  let waiting: Asked[][] = [[], []]
  let single = ({ req, answer, fail }: Asked) =>
    via.fetch(req).then(answer, fail)
  let send = async (asked: Asked[]) => {
    if (asked.length == 1) return await single(asked[0])
    let url = new URL(READS, asked[0].req.url)
    for (let { q } of asked) url.searchParams.append('q', q)
    try {
      let r = await via.fetch(
        new Request(url, { headers: asked[0].req.headers }),
      )
      if (r.status == 404) {
        await r.body?.cancel()
        return void await Promise.all(asked.map(single))
      }
      if (!r.ok) {
        let body = await r.text()
        for (let { answer } of asked) answer(new Response(body, r))
        return
      }
      let answers = await r.json() as ReadAnswer[]
      asked.forEach(({ answer }, n) => {
        let { status, epoch, body } = answers[n]
        answer(
          new Response(body, {
            status,
            headers: {
              'content-type': 'application/json',
              ...epoch == null ? {} : { [EPOCH]: epoch },
            },
          }),
        )
      })
    } catch (e) {
      for (let { fail } of asked) fail(e)
    }
  }
  let flush = (asked: Asked[]) => {
    let trip: Asked[] = [], room = ROOM
    for (let one of asked) {
      let size = encodeURIComponent(one.q).length + 3
      if (trip.length && size > room) {
        void send(trip)
        trip = [], room = ROOM
      }
      trip.push(one)
      room -= size
    }
    void send(trip)
  }
  return {
    fetch: (req) => {
      let url = new URL(req.url)
      let q = url.searchParams.get('q')
      if (
        req.method != 'GET' || url.pathname != '/query' || q == null ||
        req.headers.has(MEND)
      ) return via.fetch(req)
      let at = waiting[req.headers.has(EPOCH) ? 1 : 0]
      return new Promise<Response>((answer, fail) => {
        if (!at.length) {
          turn(() => flush(at.splice(0)))
        }
        at.push({ req, q, answer, fail })
      })
    },
  }
}

/** One line of a READS answer: what `/query` would have answered it. */
export type ReadAnswer = { status: number; epoch: string | null; body: string }

/** The real directory wins normally. Only a successful copy ends a stall. */
export let publicDirectory = (
  via: Fetcher,
  copy: ServingCopyDoor | undefined,
  time: Clock = system,
  used: () => void = () => {},
): Fetcher & { stale?: boolean; versioned?: boolean } => {
  if (!copy) return via
  let reads = gathered(via)
  let late = false
  let door: Fetcher & { stale?: boolean; versioned?: boolean } = {
    versioned: true,
    fetch: (req) => {
      if (req.method != 'GET') return via.fetch(req)
      let key = new URL(req.url).searchParams.get('q') ?? ''
      let headers = new Headers(req.headers)
      headers.set(EPOCH, '1')
      let direct = reads.fetch(new Request(req, { headers }))
      return new Promise<Response>((resolve, reject) => {
        let settled = false
        let cancel = time.after(late ? 0 : STALL, () => {
          late = true
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

/** A request-scoped view of the directory that a stall cannot hang. The
 * directory's own answer stands, and is copied behind it. A copied body is
 * data, not authority: it answers only when the directory has not within the
 * deadline, and only while the copy holds its revision current, unfenced. Never
 * share this door across requests. */
export let signedDirectory = (
  via: Fetcher,
  copy: ServingCopyDoor | undefined,
  time: Clock = system,
): Fetcher & { signed?: boolean } => {
  if (!copy) return via
  let reads = gathered(via)
  let late = false
  // What the last look saw is what the request is told, and what its report
  // says: a give-up that names no cause cannot be fixed.
  let unavailable = (why: string) =>
    new Response(`Serving authority unavailable: ${why}`, { status: 503 })
  let accept = async (revision: number, body: string) =>
    await current(copy, revision) === true
      ? new Response(body, { headers: { [EPOCH]: String(revision) } })
      : null
  // The copy takes a body of its own revision and no other, and a body of
  // its committed revision lowers a fence whose finish was lost. One it
  // refuses while still fenced at that revision is a fence no write may hold
  // any more, so the directory is asked to mend it.
  let filling: { answer: Filled; said: (kept: boolean) => void }[] = []
  let published = (answer: Filled) =>
    new Promise<boolean>((said, fail) => {
      if (!copy.publishes) {
        return void (copy.publish?.(...answer) ?? Promise.resolve(true))
          .then(said, fail)
      }
      if (!filling.length) {
        turn(() => {
          let held = filling.splice(0)
          void copy.publishes!(held.map((h) => h.answer)).then(
            (kept) => held.forEach((h, n) => h.said(kept[n])),
            // A copy that cannot take them is filled by the next reads.
            () => held.forEach((h) => h.said(true)),
          )
        })
      }
      filling.push({ answer, said })
    })
  let fill = async (
    req: Request,
    revision: number,
    key: string,
    body: string,
  ) => {
    if (await published([revision, key, body])) return
    if (await current(copy, revision) === true) return
    let headers = new Headers(req.headers)
    headers.set(EPOCH, '1')
    headers.set(MEND, '1')
    await (await via.fetch(new Request(req, { headers }))).body?.cancel()
  }
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
        let cancel = time.after(late ? 0 : STALL, () => {
          late = true
          void fallback()
        })
        let headers = new Headers(req.headers)
        headers.set(EPOCH, '1')
        let from = time.now()
        // One read of the directory: an answer that stands, a refusal
        // included, or why nothing can be confirmed yet.
        let look = async (): Promise<Response | string> => {
          let answer: Response, body: string
          // Read whole: a deploy that restarts the directory cuts off the
          // answer it was sending as well as the call it was taking.
          try {
            answer = await reads.fetch(new Request(req, { headers }))
            body = await answer.text()
          } catch (e) {
            await fallback()
            return `the directory did not answer: ${said(e)}`
          }
          // A 5xx is the directory failing to answer for the moment, not
          // saying no: its own failure is reported where it happened.
          if (answer.status >= 500) {
            return `the directory answered ${answer.status}: ${message(body)}`
          }
          if (!answer.ok) return new Response(body, answer)
          let epoch = answer.headers.get(EPOCH)
          if (epoch == null || !/^\d+$/.test(epoch)) {
            return 'the directory answered with no revision'
          }
          // The directory is the authority, and its answer stands as read: a
          // write it has fenced but not yet committed is one this read came
          // before. The copy is filled behind the answer, for a stall to fall
          // back on (`fill`).
          background(fill(req, Number(epoch), key, body).catch(() => {}))
          return new Response(body, { headers: { [EPOCH]: epoch } })
        }
        void (async () => {
          // A directory that cannot answer for a moment has said nothing: a
          // deploy moves it, and the runtime fails a call into it while it
          // moves. That is a wait, never an answer: reread with backoff,
          // bounded by FENCE_WAIT, while the copy may answer meanwhile.
          for (let pause = 10; !settled; pause = Math.min(pause * 2, 250)) {
            let answer = await look()
            if (settled) return
            if (typeof answer != 'string') return done(answer)
            if (time.now() - from >= FENCE_WAIT) {
              return done(unavailable(answer))
            }
            await new Promise<void>((resume) => time.after(pause, resume))
          }
        })().catch((e) => {
          defect(e, { request: 'signed directory read' })
          done(unavailable(said(e)))
        })
      })
    },
  }
}

// A failure's words, and a refusal body's `message` (@yaks/api), cut short:
// they ride in a sentence.
let said = (e: unknown) =>
  (e instanceof Error ? e.message : String(e))
    .slice(0, 300)
let message = (text: string) => {
  try {
    let { message } = JSON.parse(text)
    if (typeof message == 'string') return said(message)
  } catch { /* not a refusal body: its text is the message */ }
  return said(text)
}

/** Whether the copy says a revision is current, or why it has not: a copy
 * that cannot answer, moving with a deploy, has not said so. */
let current = async (
  copy: ServingCopyDoor,
  revision: number,
): Promise<true | string> => {
  try {
    return await copy.valid?.(revision)
      ? true
      : `the serving copy does not hold revision ${revision} current`
  } catch (e) {
    return `the serving copy did not answer: ${said(e)}`
  }
}
