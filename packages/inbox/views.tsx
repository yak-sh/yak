/**
 * What the inbox offers a browsing app, as a `./views` facet: the `Inbox`
 * view of a person (./Person.tsx) and of a project (./Project.tsx), written
 * against @yaks/inspect's `io` so any host that draws inspector views draws
 * them; the owner's home page and an `Inbox` tab on what it draws, each
 * saying how many threads wait unread there; and the glyph they wear. A
 * config that leaves @yaks/inbox out loads none of it, and no page asks for
 * an inbox summary.
 *
 * @module
 */

import Glyph from 'lucide/dist/esm/icons/inbox.mjs'
import type { View } from '@yaks/inspect'
import { waiting } from './asks.ts'

/** A person's inbox and a project's, loaded by the inspector that draws them. */
export let inspectViews = (): Promise<View[]> =>
  import('./inspect.tsx').then((m) => m.inspectViews)

/** `Inbox` as a tab on each entity it draws, wearing what waits there. */
export let tabs = [{ view: 'Inbox', icon: 'inbox', waiting }]

/** The owner's home page: their inbox. */
export let home = { name: 'Inbox', icon: 'inbox', view: 'Inbox', waiting }

/** The glyph the tab and the home page wear. */
export let icons = { inbox: Glyph }
