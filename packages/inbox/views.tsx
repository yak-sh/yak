/** @jsxImportSource preact */
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
import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { waiting } from './asks.ts'
import { PersonInbox } from './Person.tsx'
import { ProjectInbox } from './Project.tsx'

/** A person's inbox and a project's, as inspector views. */
export let inspectViews: View[] = [
  {
    view: 'Inbox',
    match: parse('.person'),
    Render: ({ e, io, ctx }) => (
      <PersonInbox
        e={e}
        io={io}
        limit={typeof ctx.limit == 'number' ? ctx.limit : undefined}
      />
    ),
  },
  { view: 'Inbox', match: parse('.project'), Render: ProjectInbox },
]

/** `Inbox` as a tab on each entity it draws, wearing what waits there. */
export let tabs = [{ view: 'Inbox', icon: 'inbox', waiting }]

/** The owner's home page: their inbox. */
export let home = { name: 'Inbox', icon: 'inbox', view: 'Inbox', waiting }

/** The glyph the tab and the home page wear. */
export let icons = { inbox: Glyph }
