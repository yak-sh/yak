// The Operator's store as its page reads and writes it: @yaks/api's `/apply`,
// `/query` and `/ws`, each request as the person the kernel vouched for. Many
// people share a space's store, so each reads only what is theirs or nobody's
// (operator-access.ts `sight`), on the socket too, a reply's text as it is
// written included (@yaks/api's transient frames go to a subscription's
// members alone), and writes only what is theirs to write (`mayWrite`).
//
// The object the store stands in (build.ts) hands this its `/api/*` requests
// from people who write in the space, and only theirs, and the sockets it
// accepted; its other sockets (a build's page, a lent
// browser, a page on the Operator's frames from before) are not this door's.
// A socket outlives the seat it was opened with, so it stands by its person's
// seat as the directory has it now, on every frame in and every delivery out:
// once they no longer write in the space it hears nothing more, and closes.
import { api, type Handler, subscriptions } from '@yaks/api'
import { beside, computed } from '@yaks/api/reached'
import { type Hibernation, sockets } from '@yaks/durable-object'
import { type Clock, system } from '@yaks/fp'
import { type Level, writes } from '@yaks/member'
import { UPDATE_WAITING, waitingBundle } from '@yaks/platform/update-waiting'
import { cardsSpace, updateRows } from '@yaks/platform/update-rows'
import { draftRows, draftsSpace } from '@yaks/platform/operator-drafts'
import { line } from '@yaks/query'
import type { Bundle, Graph } from '@yaks/graph'
import { mayWrite, sight } from './operator-access.ts'
import { spaceOf } from './operator-root.ts'
import type { OperatorStore } from './operator-store.ts'
import { paged } from './build-door.ts'
import { updatesOf, waitingUntil } from './operator-updates.ts'

/** Who a request is from, as the kernel said: a person who writes in a
 * space (build.ts `#operate`). */
export type Asker = { person: string; space: string }

/** What the door asks of the object it stands in. */
export type Seating = {
  /** `person`'s seat in the space as the directory has it now, an
   * administrator's (`administrative`, as the kernel vouched at the
   * handshake) read as theirs: the level it gives, or null for none. */
  seat: (person: string, administrative: boolean) => Promise<Level | null>
  report?: (error: Error) => void
  clock?: Clock
  hold?: (work: Promise<void>) => void
}

let inputs = [
  '$delete',
  'notification',
  'decision',
  'filed',
  'subscription',
  'opened',
  'archived',
  'decided',
  'completed',
  'cancelled',
  'blocked',
  'failed',
  'resolved',
  'regressed',
  'broken',
  'task',
  'requires',
  'edge',
  'notified',
  'doc',
  'occurrence',
  'operator_request',
  'operator_approval',
]

// `rows`, the first saying when the answer next moves without a write
// (`at`, Infinity for never).
let expiring = (rows: Bundle[], at: number): Bundle[] =>
  rows.length && Number.isFinite(at)
    ? [{ ...rows[0], $expires: { at } }, ...rows.slice(1)]
    : rows

/** Whether the person's live read answers `line`: their Updates count, or
 * their Updates cards in the space. */
let personal = (asked: string) =>
  asked == UPDATE_WAITING || cardsSpace(asked) != undefined

/** @yaks/api over `store`, its sockets among the object's (`ctx`). */
export let operatorApi = (
  store: OperatorStore,
  ctx: Hibernation,
  { seat, report, clock = system, hold }: Seating,
) => {
  let subs = subscriptions(store.g)
  let waiting = computed(store.g, {
    affects: (bundles) => bundles.some((b) => inputs.some((key) => key in b)),
    hold,
    clock,
    read: async (line, read) => {
      let person = read?.person, space = await spaceOf(store)
      if (!person || !space) return []
      let asked = cardsSpace(line)
      if (asked != undefined) {
        if (asked != space) return []
        let { updates, expires } = await updatesOf(
          store,
          person,
          space,
          50,
          false,
          clock.now(),
        )
        return expiring(updateRows(person, space, updates), expires)
      }
      let { count, expires } = await waitingUntil(
        store,
        person,
        space,
        clock.now(),
      )
      return expiring(
        [waitingBundle(person, { space, slug: '', count })],
        expires,
      )
    },
    renew: (answer) =>
      Array.isArray(answer)
        ? (answer[0]?.$expires as { at: number } | undefined)?.at
        : undefined,
    tags: { request: 'Operator Updates' },
  })
  // The person's drafts, as their page graph holds them
  // (@yaks/platform/operator-drafts): read again only when a draft moves.
  let drafts = computed(store.g, {
    affects: (bundles) => bundles.some((b) => 'draft' in b || '$delete' in b),
    hold,
    clock,
    read: async (asked, read) => {
      let person = read?.person, space = await spaceOf(store)
      if (!person || !space || draftsSpace(asked) != space) return []
      return draftRows(space, await store.g.read(line`.draft.by=${person}&*`))
    },
    tags: { request: 'Operator drafts' },
  })
  // Whether each person holds a seat, as the directory last said for their
  // socket: what it is read with.
  let members = new Map<string, boolean>()
  let live = sockets(
    beside(
      beside(subs, waiting, personal),
      drafts,
      (asked) => draftsSpace(asked) != undefined,
    ),
    {
      acceptWebSocket: (ws) => ctx.acceptWebSocket(ws),
      getWebSockets: () =>
        ctx.getWebSockets().filter((ws) => paged(ws.deserializeAttachment())),
      storage: ctx.storage,
    },
    report,
    {
      // A socket keeps who opened it, and is read with their sight as their
      // seat stands.
      read: (read) => {
        let person = String(read?.person)
        let member = members.get(person) ?? false
        return { person, ...sight(store, { person, member }) }
      },
      authorize: async (read) => {
        if (!read?.person) return false
        let level = await seat(read.person, !!read.administrative)
        members.set(read.person, level != null)
        return writes(level)
      },
    },
  )
  // The store as `who` writes it: what is theirs, or nothing in the batch.
  let writing = (who: Asker): Graph => ({
    ...store.g,
    apply: async (bundles, opts) => {
      await mayWrite(store, who, bundles)
      return store.g.apply(bundles, opts)
    },
  })
  let as = (who: Asker): Handler =>
    api({
      graph: writing(who),
      subs,
      authenticate: () => ({ by: who.person }),
      read: () => sight(store, { person: who.person, member: true }),
    })
  return {
    /** `/api/apply`, `/api/query` or `/api/ws`, asked by `who`. */
    answer: (
      request: Request,
      who: Asker,
      administrative = false,
    ): Response | Promise<Response> => {
      let url = new URL(request.url)
      url.pathname = url.pathname.slice('/api'.length)
      return url.pathname == '/ws' || url.pathname == '/waiting/ws'
        ? live.accept(request, { person: who.person, administrative })
        : as(who)(new Request(url, request))
    },
    /** A frame from one of its sockets: the object's `webSocketMessage`. */
    message: live.message,
    /** One of its sockets closed: the object's `webSocketClose`. */
    close: live.close,
    /** Its sockets' subscriptions opened again, as the object wakes. */
    wake: live.wake,
  }
}
