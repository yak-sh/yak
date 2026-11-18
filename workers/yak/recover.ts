// A whole app store, or a space's Operator, put back to a moment (T-34507). Cloudflare keeps a SQLite
// Durable Object recoverable for thirty days: `getBookmarkForTime` names a
// point in that history, `onNextSessionRestoreBookmark` says which point the
// object wakes at next, and restarting it is what makes that happen now. The
// doors onto them are the object's own `/restore` (bookmarks.ts, answered by
// graph.ts for an app's store and build.ts for a space's Operator) and
// `/restart`; what is here is the order, the window, and the record.
//
// The order is the whole of it. Where the store stands right now is read and
// written down before anything moves, in the directory — a different object,
// which this recovery does not touch — so the restore can itself be undone by
// asking for a moment just before it. Without that the way back is a bookmark
// nobody kept, and "put it back" becomes a thing you get exactly one of.
//
// Nothing here deletes: a restore is a store going backwards, so the data
// written since the moment asked for is what it costs, and the trail is how
// that is bought back.
import type { Bundle } from '@yaks/graph'
import type { Door } from '@yaks/durable-object/door'
import { KERNEL } from './meta.ts'
import { refuse, rejected } from './tool.ts'

/**
 * How far back a store can be put. Cloudflare's own window on a Durable
 * Object's SQLite — a fact about the runtime, which is why it is stated here
 * and not shared with erase.ts `GRACE`, the thirty days our trash keeps. The
 * two agree today and are not the same promise.
 */
export let WINDOW = 30 * 24 * 60 * 60_000

/** The oldest moment a store can still be put back to. */
export let oldest = (now = Date.now()) => new Date(now - WINDOW)

/** One restore, as the directory keeps it (directory.ts `restoreOf`). */
export type Restore = {
  /** When it was asked for — the moment to ask for to undo it. */
  at: string
  /** The moment it put the store back to. */
  to: string
  /** Who asked. */
  by: string
  /** Where the store stood before it moved. */
  from: string
}

/**
 * The moment a caller asked for, or the refusal that names the window.
 *
 * Asking for a moment outside the thirty days is the commonest way this is
 * asked wrong — someone reaches for "last month" — so the refusal says what the
 * window is rather than that the answer was no. A time in the future is the
 * same mistake with the sign flipped, and it would otherwise quietly restore
 * to now, which is a no-op that reads as a success.
 */
export let moment = (said: string, now = Date.now()): Date => {
  let at = new Date(said)
  if (isNaN(at.getTime())) {
    throw refuse(
      'arguments',
      `at: ${said} is not a time — write it as 2026-09-06T14:20:00Z`,
    )
  }
  if (at.getTime() > now) {
    throw refuse(
      'arguments',
      `at: ${at.toISOString()} is in the future — a store can be put back, ` +
        'not forward',
    )
  }
  if (at.getTime() < now - WINDOW) {
    throw refuse(
      'arguments',
      `at: ${at.toISOString()} is outside the 30-day window — the oldest ` +
        `moment this store can be put back to is ${
          oldest(now).toISOString()
        }, and there is no copy of it before that`,
    )
  }
  return at
}

// What the store's own door answered, or its refusal in the words it gave.
// The kernel flag rides on every one of these: `/restore` is not a route a
// client is answered at (graph.ts), and door.ts strips the flag off anything
// it is handed, so this is the only way it can ever be set.
/** What a restore asks an object through: its door, or the Operator's
 * (build-door.ts `operatorRecovery`). */
export type Restorable = Pick<Door, 'consume'>

let asked = (store: Restorable, path: string, init?: RequestInit) => {
  return store.consume(
    path,
    async (r) => {
      let body = await r.text()
      if (!r.ok) {
        let said = (() => {
          try {
            return (JSON.parse(body) as { message?: string }).message
          } catch {
            return ''
          }
        })()
        throw rejected(r.status, said || body)
      }
      return JSON.parse(body) as { from: string; to: string; undo?: string }
    },
    init,
    KERNEL,
  )
}

/** Where a store stands right now: the bookmark that is its way back. Asking
 * is also the one question that proves the back end offers recovery at all. */
export let mark = (store: Restorable) => asked(store, '/restore')

/**
 * One restore, in the order that leaves a way out of it: read where the store
 * stands and the bookmark for the moment asked for, write that down, and only
 * then tell the object to wake up there.
 *
 * `write` is handed the record rather than making it, so the order this
 * function exists to hold is a thing a test can watch (recover_test.ts) and the
 * directory is somebody else's business (tools.ts stamps it).
 */
export let putBack = async (
  store: Restorable,
  write: (r: Restore) => Promise<void>,
  at: Date,
  by: string,
  now = new Date(),
): Promise<Restore & { undo: string }> => {
  let { from, to } = await asked(
    store,
    `/restore?at=${encodeURIComponent(at.toISOString())}`,
  )
  let record: Restore = {
    at: now.toISOString(),
    to: at.toISOString(),
    by,
    from,
  }
  await write(record)
  let { undo = '' } = await asked(store, '/restore', {
    method: 'POST',
    body: JSON.stringify({ bookmark: to }),
    headers: { 'content-type': 'application/json' },
  })
  await restarted(store)
  return { ...record, undo }
}

/**
 * The object restarted, so it wakes at the bookmark it was told now rather
 * than whenever it is next evicted. The restart resets it under the request
 * asking for it, so that request failing with the runtime's reset is the
 * answer; any other failure is one.
 */
let restarted = async (store: Restorable) => {
  try {
    await asked(store, '/restart', { method: 'POST' })
  } catch (e) {
    if (!reset(e)) throw e
  }
}

/** The runtime's error for an object reset under a request. */
let reset = (e: unknown) =>
  e instanceof Error &&
  (e as Error & { durableObjectReset?: boolean }).durableObjectReset === true

/** The record as the directory holds it: one entity per restore, about the
 * app or the space whose Operator it put back, so a second restore never
 * overwrites the first one's way back. */
export let recorded = (
  of: { app: string } | { space: string },
  r: Restore,
): Bundle[] => [{
  entity: { eid: '$restore' },
  restored: { ...of, at: r.at, to: r.to, by: r.by, from_bookmark: r.from },
}]
