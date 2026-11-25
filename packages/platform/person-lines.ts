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
import { sideLine } from './side-rows.ts'
import { accountLine } from './account-rows.ts'
import { UPDATE_WAITING } from './update-waiting.ts'
import { offersSpace } from './update-rows.ts'
import { reachedLine } from './operator-settings.ts'
import { listedSpace } from './space-apps.ts'
import { peopleLine } from './people-rows.ts'
import { paymentLine } from './payment-rows.ts'
import { spaceLine } from './space-pages.ts'
import { draftedApp } from './app-canvas.ts'
import { GRANTS } from './agents.ts'
import { movedSpace } from './connections-page.ts'

/** Whether the directory answers `line` as a read of the person. */
export let personLine = (line: string): boolean =>
  line == UPDATE_WAITING || sideLine(line) || accountLine(line) ||
  offersSpace(line) != undefined || reachedLine(line) ||
  listedSpace(line) != undefined || peopleLine(line) || paymentLine(line) ||
  !!spaceLine(line) || draftedApp(line) != undefined || line == GRANTS ||
  movedSpace(line) != undefined
