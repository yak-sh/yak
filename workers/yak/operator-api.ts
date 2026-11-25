// The Operator's store as its page reads and writes it: @yaks/api's `/apply`,
// `/query` and `/ws`, each request as the person the kernel vouched for. Many
// people share a space's store, so each reads only what is theirs or nobody's
// (operator-access.ts `sight`), on the socket too, a reply's text as it is
// written included (@yaks/api's transient frames go to a subscription's
// members alone), and writes only what is theirs to write (`mayWrite`).
//
// The object the store stands in (build.ts) hands this its `/api/*` requests
// from people who write in the space, and only theirs, and the sockets it
// accepted; its other sockets (a build's page, a lent browser) are not this
// door's. A person's chat page watches its conversation here too
// (@yaks/platform/operator-talk), answered by the Operator's frames
// (operator-host.ts `operatorFrames`).
// A socket outlives the seat it was opened with, so it stands by its person's
// seat as the directory has it now, on every frame in and every delivery out:
// once they no longer write in the space it hears nothing more, and closes.
import { api, type Handler, subscriptions } from '@yaks/api'
import { beside, computed, type Reached } from '@yaks/api/reached'
import { type Hibernation, socketRenewals, sockets } from '@yaks/durable-object'
import { type Clock, system } from '@yaks/fp'
import { type Level, writes } from '@yaks/member'
import { UPDATE_WAITING, waitingBundle } from '@yaks/platform/update-waiting'
import { cardsSpace, updateRows } from '@yaks/platform/update-rows'
import { draftRows, draftsSpace } from '@yaks/platform/operator-drafts'
import { settingsRow, settingsSpace } from '@yaks/platform/operator-settings'
import { talkAsked } from '@yaks/platform/operator-talk'
import {
  type Matches,
  matchesAsked,
  matchesRow,
} from '@yaks/platform/operator-matches'
import { trialDoc } from '@yaks/trial/vocab'
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
  /** The object's alarm, shared with its other work. */
  arm?: (at: number) => Promise<void>
  /** the person's conversations, as their chat pages watch them
   * (operator-host.ts `operatorFrames`); none are answered without */
  talks?: Reached
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
  { seat, report, clock = system, hold, arm, talks }: Seating,
) => {
  let subs = subscriptions(store.g)
  let renewals = arm && socketRenewals(arm, { now: clock.now, keep: hold })
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
    renewAt: renewals?.at,
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
  // The Operator's name and voice, off its persona, as its settings page
  // draws them (@yaks/platform/operator-settings): read again when a write
  // may have moved the persona, by the page or by the Operator itself.
  let settings = computed(store.g, {
    affects: (bundles) =>
      bundles.some((b) => 'doc' in b || 'speech' in b || 'persona' in b),
    hold,
    clock,
    read: async (asked, read) => {
      let space = await spaceOf(store)
      if (!read?.person || !space || settingsSpace(asked) != space) return []
      let { settingsIn } = await import('./operator-persona.ts')
      return [settingsRow(space, await settingsIn(store.g.storage, space))]
    },
    tags: { request: 'Operator settings' },
  })
  // The rounds a person picks in, or one round as they tap through it, as
  // the Matches page draws them (@yaks/platform/operator-matches): read again
  // when a trial's rows move, a pick in the chat or the page among them.
  let trials = ['$delete', ...Object.keys(trialDoc.$defs ?? {})]
  let matches = computed(store.g, {
    affects: (bundles) => bundles.some((b) => trials.some((key) => key in b)),
    hold,
    clock,
    read: async (asked, read) => {
      let person = read?.person, space = await spaceOf(store)
      let page = matchesAsked(asked)
      if (!person || !space || page?.space != space) return []
      let { matching } = await import('./operator-trials.ts')
      let got = await matching(
        store,
        person,
        page.round ? { round: page.round } : {},
      )
      return [matchesRow(space, page.round, got as Matches)]
    },
    tags: { request: 'Operator matches' },
  })
  // Whether each person holds a seat, as the directory last said for their
  // socket: what it is read with.
  let members = new Map<string, boolean>()
  let theirs = beside(
    beside(
      beside(
        beside(subs, waiting, personal),
        drafts,
        (asked) => draftsSpace(asked) != undefined,
      ),
      settings,
      (asked) => settingsSpace(asked) != undefined,
    ),
    matches,
    (asked) => matchesAsked(asked) != undefined,
  )
  let live = sockets(
    // Its chat pages' conversations, each socket carrying where its tab is
    // (build.ts).
    talks
      ? beside(theirs, talks, (asked) => talkAsked(asked) != undefined)
      : theirs,
    {
      acceptWebSocket: (ws) => ctx.acceptWebSocket(ws),
      getWebSockets: () =>
        ctx.getWebSockets().filter((ws) => paged(ws.deserializeAttachment())),
      storage: ctx.storage,
    },
    report,
    {
      renewals,
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
    renew: live.renew,
  }
}
