// A whole app store put back to a moment (T-34507). Cloudflare keeps a SQLite
// Durable Object recoverable for thirty days: `getBookmarkForTime` names a
// point in that history, `onNextSessionRestoreBookmark` says which point the
// object wakes at next, and restarting it is what makes that happen now. The
// door onto all three is the store's own `/restore` (graph.ts `#recovery`);
// what is here is the ORDER, the window, and the record.
//
// The order is the whole of it. Where the store stands right now is read and
// WRITTEN DOWN before anything moves, in the directory — a different object,
// which this recovery does not touch — so the restore can itself be undone by
// asking for a moment just before it. Without that the way back is a bookmark
// nobody kept, and "put it back" becomes a thing you get exactly one of.
//
// Nothing here deletes: a restore is a store going backwards, so the data
// written since the moment asked for is what it costs, and the trail is how
// that is bought back.
import type { Bundle } from '@yaks/graph'
import type { Door } from './door.ts'
import { KERNEL } from './meta.ts'

/**
 * How far back a store can be put. Cloudflare's own window on a Durable
 * Object's SQLite — a fact about the runtime, which is why it is spelled here
 * and not shared with erase.ts `GRACE`, the thirty days OUR trash keeps. The
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
 * window IS rather than that the answer was no. A time in the future is the
 * same mistake with the sign flipped, and it would otherwise quietly restore
 * to now, which is a no-op that reads as a success.
 */
export let moment = (said: string, now = Date.now()): Date => {
  let at = new Date(said)
  if (isNaN(at.getTime())) {
    throw new Error(
      `at: ${said} is not a time — write it as 2026-09-06T14:20:00Z`,
    )
  }
  if (at.getTime() > now) {
    throw new Error(
      `at: ${at.toISOString()} is in the future — a store can be put back, ` +
        'not forward',
    )
  }
  if (at.getTime() < now - WINDOW) {
    throw new Error(
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
let asked = async (store: Door, path: string, init?: RequestInit) => {
  let r = await store(path, init, KERNEL)
  let body = await r.text()
  if (!r.ok) {
    let said = (() => {
      try {
        return (JSON.parse(body) as { message?: string }).message
      } catch {
        return ''
      }
    })()
    throw new Error(said || body)
  }
  return JSON.parse(body) as { from: string; to: string; undo?: string }
}

/** Where a store stands right now: the bookmark that is its way back. Asking
 * is also the one question that proves the back end offers recovery at all. */
export let mark = (store: Door) => asked(store, '/restore')

/**
 * One restore, in the order that leaves a way out of it: read where the store
 * stands and the bookmark for the moment asked for, WRITE THAT DOWN, and only
 * then tell the object to wake up there.
 *
 * `write` is handed the record rather than making it, so the order this
 * function exists to hold is a thing a test can watch (recover_test.ts) and the
 * directory is somebody else's business (tools.ts stamps it).
 */
export let putBack = async (
  store: Door,
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
  return { ...record, undo }
}

/** The record as the directory holds it: one entity per restore, about the
 * app, so a second restore never overwrites the first one's way back. */
export let recorded = (app: string, r: Restore): Bundle[] => [{
  entity: { eid: '$restore' },
  restored: { app, at: r.at, to: r.to, by: r.by, from_bookmark: r.from },
}]
