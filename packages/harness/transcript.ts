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
  content?: Renderer['render'],
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
      content ? content(b, h, ctx) : prose
        ? h(
          'div',
          { class: dim ? 'Dim' : undefined },
          renderMarkdown(markdown(String((b.content as Comp)?.body ?? '')), h),
        )
        : h(
          'span',
          { class: dim ? 'Dim' : undefined },
          body.render(b, h, { ...ctx, full: true }),
        ),
    ),
})

// Previews affect presentation only. Inspection and model context use the
// original content. Bound characters as well as lines for minified tool output.
const resultPreview: Renderer['render'] = (b, h) => {
  const text = String((b.content as Comp | undefined)?.body ?? '')
  const lines = text.split('\n', 6)
  const head = lines.slice(0, 5).join('\n')
  const preview = Array.from(head.slice(0, 4000)).slice(0, 2000).join('')
  const clipped = preview.length < text.length
  return h(
    'div',
    { class: 'Dim' },
    h(
      'div',
      {
        wrap: '1',
        'max-height': '5',
        ...(!clipped
          ? {
            'overflow-text':
              '… output preview; full text retained in transcript storage',
          }
          : {}),
      },
      ...preview.split('\n').flatMap((line, i) =>
        i ? [h('br', null), line] : [line]
      ),
    ),
    clipped
      ? h(
        'div',
        null,
        '… output preview; full text retained in transcript storage',
      )
      : null,
  )
}

const shellCommand: Renderer['render'] = (b, h, ctx) => {
  try {
    const args: unknown = JSON.parse(String((b.call as Comp)?.args ?? ''))
    if (
      args && typeof args == 'object' && 'command' in args &&
      typeof args.command == 'string'
    ) {
      return h(
        'div',
        { wrap: '1' },
        h('span', { class: 'Muted' }, '$ '),
        ...args.command.split('\n').flatMap((line, i) =>
          i ? [h('br', null), line] : [line]
        ),
      )
    }
  } catch {
    /* Streaming or malformed arguments still get the ordinary view. */
  }
  return body.render(b, h, { ...ctx, full: true })
}

// More predicates beat the generic entry/content rows. Equal facet scores use
// registration order: failures outrank tool results, which outrank prose.
// Older content-only receipts have no author facet; their durable delivery IDs
// keep them out of the user-message fallback. Other machine facets win ties.
export let transcriptViews = define([
  {
    view: 'Transcript',
    match: parse('.entry&.attachment&.content'),
    render: (b, h, ctx) => {
      let eid = String((b.attachment as Comp).artifact ?? '')
      let alt = String((b.content as Comp).body ?? 'Image artifact')
      let load = ctx.image as ((eid: string) => Promise<Uint8Array>) | undefined
      if (!load || !ctx.inlineImages) return h('div', { wrap: '1' }, alt)
      return h('terminal-image', {
        ref: (node: unknown) => {
          if (node) {
            ;(node as { image?: unknown }).image = {
              key: eid,
              alt,
              rows: 8,
              load: () => load(eid),
            }
          }
        },
      })
    },
  },
  {
    view: 'Transcript',
    match: parse('.entry&.prompt'),
    render: (b, h) => {
      let prompt = b.prompt as Comp
      // Display provenance, not instruction text. A fixed row also prevents
      // long source names from changing the virtual list's measured height.
      let source = String(prompt.source ?? '').replaceAll('\\', '/')
        .split('/').filter(Boolean).at(-1) ?? ''
      let summary = [prompt.scope, source].filter(Boolean).join(' · ')
        .replace(/\s+/g, ' ')
      return h(
        'div',
        { height: '1' },
        h(
          'span',
          { class: 'Dim' },
          String((b.entry as Comp)?.seq ?? '').padStart(3),
        ),
        ' ',
        h('span', { class: 'Muted' }, 'prompt'.padEnd(9)),
        ' ',
        h('span', { class: 'Muted' }, summary),
      )
    },
  },
  row('.entry&.content&.entity.eid~=delivery:', 'notice', 'Muted', true),
  row('.entry&.error.code=interrupted', 'interrupted', 'Muted'),
  row('.entry&.error', 'error', 'Bad'),
  row('.entry&.exception', 'exception', 'Bad'),
  row('.entry&.notice&.content', 'notice', 'Muted', true),
  row('.entry&.result', 'result', 'Muted', true, false, false, resultPreview),
  row(
    '.entry&.call&.call.to=tool:shell',
    'call',
    'Key',
    false,
    false,
    false,
    shellCommand,
  ),
  row('.entry&.call', 'call', 'Key'),
  row('.entry&.ask&.attempt.state=inflight', 'asking', 'Key'),
  row('.entry&.ask&.attempt.state=interrupted', 'interrupted', 'Muted'),
  row('.entry&.ask', 'ask', 'Muted'),
  row('.entry&.stop', 'stop', 'Warn'),
  row('.entry&.content.source!', 'output', 'Accent', false, true),
  row('.entry&.content', 'input', 'Good', false, true, true),
  row('.entry', 'entry', 'Muted'),
])
