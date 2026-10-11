/** @jsxImportSource preact */
// The inbox pages a browsing host draws. The views facet loads these only
// when that host asks for its inspector registrations.
import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { PersonInbox } from './Person.tsx'
import { ProjectInbox } from './Project.tsx'

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
