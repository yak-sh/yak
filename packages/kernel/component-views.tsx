/** @jsxImportSource preact */
// Comment and commit faces contributed to the shared renderer registry.
import { parse } from '@yaks/query'
import type { ComponentRenderer } from '@yaks/preact'
import type { Bundle } from '@yaks/graph'
import { commentHost } from './comment-host.ts'
import { Note } from './Comments.tsx'

export let views: { renderers: ComponentRenderer<Bundle>[] } = {
  renderers: [
    {
      view: 'Thread.Body',
      match: parse('.comment'),
      Render: ({ e }) => {
        let host = commentHost()
        let repo = host.useRepo(e)
        return host.markdown(
          String((e.doc as Record<string, unknown> | undefined)?.body ?? ''),
          repo,
        )
      },
    },
    {
      view: 'Thread.Note',
      match: parse('.comment'),
      Render: ({ e }) => <Note c={e} />,
    },
    {
      view: 'Thread.Note',
      match: parse('.commit'),
      Render: ({ e }) => <Note c={e} reply={false} />,
    },
  ],
}
