/** Terminal transcript trees selected by query specificity, not a kind switch. */
import type { Comp } from '@yaks/graph'
import { parse } from '@yaks/query'
import { define, type Renderer } from '@yaks/render'
import { views } from '@yaks/session'
import { parse as markdown, render as renderMarkdown } from '@yaks/markdown'

let body = views.renderers.find((r) => r.view == 'Body')!
let row = (
  query: string,
  label: string,
  color: string,
  dim = false,
  prose = false,
  boxed = false,
): Renderer => ({
  view: 'Transcript',
  match: parse(query),
  render: (b, h, ctx) =>
    h(
      'div',
      { wrap: '1', ...(boxed ? { border: 'Composer_Border' } : {}) },
      h(
        'span',
        { class: 'Dim' },
        String((b.entry as Comp)?.seq ?? '').padStart(3),
      ),
      ' ',
      h('span', { class: color }, label.padEnd(9)),
      ' ',
      prose
        ? renderMarkdown(markdown(String((b.content as Comp)?.body ?? '')), h)
        : h(
          'span',
          { class: dim ? 'Dim' : undefined },
          body.render(b, h, { ...ctx, full: true }),
        ),
    ),
})

// More predicates beat the generic entry/content rows. Equal facet scores use
// registration order: failures outrank tool results, which outrank prose.
// Older content-only receipts have no author facet; their durable delivery IDs
// keep them out of the user-message fallback. Other machine facets win ties.
export let transcriptViews = define([
  row('.entry&.prompt&.content', 'prompt', 'Muted'),
  row('.entry&.content&.entity.eid~=delivery:', 'notice', 'Muted', true),
  row('.entry&.using', 'input', 'Muted', false, true),
  row('.entry&.error', 'error', 'Bad'),
  row('.entry&.exception', 'exception', 'Bad'),
  row('.entry&.notice&.content', 'notice', 'Muted', true),
  row('.entry&.result', 'result', 'Muted', true),
  row('.entry&.call', 'call', 'Key'),
  row('.entry&.ask', 'ask', 'Muted'),
  row('.entry&.stop', 'stop', 'Warn'),
  row('.entry&.content.source!', 'output', 'Accent', false, true),
  row('.entry&.content', 'input', 'Good', false, true, true),
  row('.entry', 'entry', 'Muted'),
])
