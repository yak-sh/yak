import { renderToString } from 'preact-render-to-string'
import { define } from '../../utils.ts'
import { View } from '../../components/View.tsx'

// A rendered view of one entity, as a bare HTML fragment — the Tabs island
// fetches this to swap a card's content without a page load.
export let handler = define.handlers({
  GET(ctx) {
    let view = ctx.url.searchParams.get('view') ?? undefined
    return new Response(
      renderToString(<View eid={ctx.params.eid} view={view} />),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  },
})
