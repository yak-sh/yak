/**
 * The Shared with you page (Your account), drawn from the apps of other
 * people's spaces the person may open (./account-rows.ts `sharedApp`), each
 * by the same tile as their own (./app-tile.ts) and at the address it lives
 * at. The server draws it for the first paint, and the browser draws it again
 * as the rows move (./shared-browser.ts): an app someone lets them into, or
 * takes them out of, shows at once.
 *
 * @module
 */
import { type ComponentChildren as Kids, h } from 'preact'
import { Card } from '@yaks/ui/Card'
import { Rows } from '@yaks/ui/Rows'
import type { Shared } from './account-rows.ts'
import { appTile } from './app-tile.ts'
import { empty } from './page-parts.ts'

/** What the Shared with you page says about itself beside the rows: whose
 * it is and the zone its spaces answer under. */
export type SharedView = { person: string; apex: string }

/** The Shared with you page: the `apps` others let the person into. */
export let sharedView = (view: SharedView, apps: Shared[]): Kids =>
  apps.length
    ? h(
      Card,
      null,
      h(
        Rows,
        { as: 'ul' },
        apps.map((a) => {
          let host = `${a.space}.${view.apex}`
          return appTile(
            { eid: a.eid, slug: a.slug, title: a.title },
            { at: `https://${host}`, host, editor: true },
          )
        }),
      ),
    )
    : empty(
      'Nothing shared with you yet',
      h(
        'p',
        null,
        'An app someone invites you to, in a space of theirs, appears here.',
      ),
    )
