/**
 * The lines the directory answers as reads of the signed-in person, live on
 * its `/person/ws` (graph.ts): the sidebar's (./side-rows.ts), their account
 * and friends (./account-rows.ts), the Updates waiting on them
 * (./update-waiting.ts), what it holds for them in a space
 * (./update-rows.ts `updateOffers`), how they are told things away from the
 * page (./operator-settings.ts), the apps a space's Apps page lists
 * (./space-apps.ts), who is in a space they own (./people-rows.ts), a
 * space's payments (./payment-rows.ts), of a space they own, its
 * Settings, Domains and Trash pages' (./space-pages.ts), where an app's
 * drafts stand (./app-canvas.ts `appDrafted`), the grants they hold
 * (./agents.ts `GRANTS`), and when a space's Connections page moved
 * (./connections-page.ts `connectionsMoved`).
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { appsSpace, sideLine } from './side-rows.ts'
import { accountLine, FRIENDS } from './account-rows.ts'
import { UPDATE_WAITING } from './update-waiting.ts'
import { offersSpace } from './update-rows.ts'
import { reachedLine } from './operator-settings.ts'
import { listedSpace } from './space-apps.ts'
import { peopleLine } from './people-rows.ts'
import { paymentLine, paymentPart } from './payment-rows.ts'
import { spaceLine } from './space-pages.ts'
import { draftedApp } from './app-canvas.ts'
import { GRANTS } from './agents.ts'
import { movedSpace } from './connections-page.ts'

/** A directory socket following the lifetime of a signed-in page. */
export let PAGE_PRESENCE = 'x-yak-page-presence'

/** Whether the directory answers `line` as a read of the person. */
export let personLine = (line: string): boolean =>
  line == UPDATE_WAITING || sideLine(line) || accountLine(line) ||
  offersSpace(line) != undefined || reachedLine(line) ||
  listedSpace(line) != undefined || peopleLine(line) || paymentLine(line) ||
  !!spaceLine(line) || draftedApp(line) != undefined || line == GRANTS ||
  movedSpace(line) != undefined

/** The space whose release files or version a personal watch draws. */
export let releaseSpace = (line: string): string | undefined =>
  appsSpace(line) ?? listedSpace(line) ?? offersSpace(line) ??
    spaceLine(line)?.space ?? movedSpace(line)

// Whether `b` moves where the app `app`'s drafts stand
// (@yaks/platform/app-canvas `appDrafted`): its row, one of its drafts, a
// write into one, or a row gone.
let draftMoved = (b: Bundle, app: string) => {
  let draft = b.app_draft as { app?: string; previewed?: string } | undefined
  return '$delete' in b || b.entity.eid == app ||
    (b.written as { app?: string } | undefined)?.app == app ||
    (draft?.app ? draft.app == app : !!draft?.previewed)
}

let DIRECTORY_VIEWS = [
  '$delete',
  'member',
  'space',
  'trashed',
  'app_transfer',
  'app_transfer_answer',
  'domain_transfer',
  'domain_transfer_answer',
  'relationship',
  'edge',
  'decided',
  'proposed',
  // What the side draws (./side.ts): names, logos and icons.
  'doc',
  'operator',
  'space_logo',
  'app_icon',
  'email',
  // The person's account, browsers and friends (account-rows).
  'presence',
  'grant',
  // A browser signed in, and signed out: a write names only what
  // changed, so its end is `cancelled` alone.
  'browser_session',
  'cancelled',
  // A chat account they linked (account-rows `chatLink`).
  'connection',
  // An agent connected or disconnected (agents).
  'oauth_grant',
  // A friend's message, and its reading (update-rows).
  'knock',
  'opened',
  // How they are told things away from the page, and the number
  // they agreed to texts at (operator-settings).
  'operator_alerts',
  'push_subscription',
  'sms_consent',
  // Who is in a space they own: an invitation, and another
  // space's Operator let in and taken back out (people-rows).
  'invite',
  'operator_reach',
  'tombstone',
  // A space's plan, seller, credit and month (payment-rows).
  'plan',
  'seller',
  'comped',
  'comp',
  'fee',
  'budget',
  'starter',
  // A space's domains and phone numbers (space-pages).
  'hostname',
  'domain_order',
  'phone_line',
  // Their invite: its code, and each friend who signs up with
  // it and builds (account-rows `invitePage`).
  'referral_code',
  'referral',
  'rewarded',
]

// These fields move a release or its draft without changing which apps a
// person can reach. Only the app's draft and the listings of its own space
// draw the release. A rename, move or access change still reaches the other
// directory views that depend on the app.
let RELEASE = new Set([
  'version',
  'source',
  'declaration',
  'script',
  'worker',
  'lenses',
  'fence',
  'draft',
  'followed',
])
let releaseOnly = (b: Bundle) =>
  b.app && typeof b.app == 'object'
    ? Object.keys(b.app).length > 0 &&
      Object.keys(b.app).every((key) => RELEASE.has(key))
    : !('app' in b) && !!b.last_deploy

// Which personal lines draw a directory change, with the spaces of the
// release-only patches read once for the commit.
export let personChanges = (bundles: Bundle[]) => {
  let apps = bundles.filter((b) => 'app' in b || 'last_deploy' in b)
  let releases = apps.filter(releaseOnly).map((b) => b.entity.eid)
  let reachability = apps.length != releases.length
  let other = reachability ||
    bundles.some((b) => DIRECTORY_VIEWS.some((key) => key in b))
  let connections = reachability ||
    bundles.some((b) =>
      ['$delete', 'connection', 'uses', 'mcp_server'].some((key) => key in b)
    )
  // Model reservations and settlements move the paying space's month.
  // Its payment views read the meter and credit. Other directory views do
  // not need to reread their seats on every model call.
  let spending = new Set(
    bundles.filter((b) => 'meter' in b || 'credit' in b)
      .map((b) => b.entity.eid),
  )
  let presence = bundles.some((b) => 'whereabouts' in b)
  return {
    releases: other && connections ? [] : releases,
    affects: (line: string, spaces: ReadonlySet<string | null>) => {
      let draft = draftedApp(line)
      if (draft != undefined) return bundles.some((b) => draftMoved(b, draft))
      let space = releaseSpace(line)
      if (space && spaces.has(space)) return true
      if (movedSpace(line) != undefined) return connections
      let payment = paymentPart(line)
      return other || line == FRIENDS && presence ||
        !!payment && spending.has(payment.space)
    },
  }
}
