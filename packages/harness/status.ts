/** Sidebar indicators select graph facets by query specificity. */
import type { Bundle, Comp } from '@yaks/graph'
import { parse } from '@yaks/query'
import { define, type Renderer } from '@yaks/render'
import { render } from '@yaks/preact'
import { loadVocab } from '@yaks/vocab'

// These are already evaluated read-model columns, not storage declarations.
// The match host reads the supplied status rather than recomputing a transcript.
export let statusVocab = loadVocab([{
  title: 'sidebar status projection',
  '$defs': {
    task: { type: 'object', properties: { status: { type: 'string' } } },
    session: { type: 'object', properties: { status: { type: 'string' } } },
    claim: { type: 'object', properties: { session: { type: 'string' } } },
  },
}])

let dot = (
  query: string,
  glyph: string,
  color: string,
  label: string,
): Renderer => ({
  view: 'Indicator',
  match: parse(query),
  render: (_b, h) =>
    h('span', { class: color, title: label, 'aria-label': label }, glyph),
})

export let statusViews = define([
  dot(
    '.task.status=wip&.claim&.session.status=failed',
    '●',
    'Bad',
    'Claimed worker crashed',
  ),
  dot(
    '.task.status=wip&.claim&.session.status=settled',
    '◐',
    'Key',
    'Claimed worker settled; task unfinished',
  ),
  dot(
    '.task.status=wip&.claim&.session.status=stopped',
    '◐',
    'Muted',
    'Claimed worker stopped; task unfinished',
  ),
  dot(
    '.task.status=wip&.claim&.session.status=pending,running',
    '●',
    'Key',
    'Active work',
  ),
  dot('.task.status=done', '●', 'Good', 'Completed'),
  dot('.task.status=cancelled', '○', 'Muted', 'Cancelled'),
  dot('.task.status=wip', '◐', 'Muted', 'Claimed; worker state unknown'),
  dot('.task.status=open', '○', 'Accent', 'Open'),
  dot('.task', '○', 'Accent', 'Open'),
  dot('.session.status=failed', '●', 'Bad', 'Crashed'),
  dot('.session.status=settled', '●', 'Good', 'Settled'),
  dot('.session.status=pending,running', '●', 'Key', 'Active'),
  dot('.session.status=stopped', '○', 'Muted', 'Stopped'),
  dot('.session', '○', 'Accent', 'Open'),
])

/** Read-only join: the owning session is a rendering projection, never stored. */
export let statusBundle = (bundle: Bundle, sessions: Bundle[] = []): Bundle => {
  if (!bundle.task) return bundle
  let owner = (bundle.claim as Comp | undefined)?.session
  let session = sessions.find((b) => b.entity.eid == owner)?.session
  return { ...bundle, ...(session ? { session } : {}) }
}
export let indicator = (bundle: Bundle, sessions?: Bundle[]) =>
  render(statusViews, statusBundle(bundle, sessions), 'Indicator', statusVocab)
