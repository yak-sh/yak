// Portable readings of bugs and errors, through the host's hyperscript and
// shared entity renderer. Errors and contextual traces arrive from the host.
import { parse } from '@yaks/query'
import { define, type H, type RenderContext } from '@yaks/render'
import type { Shown } from '@yaks/render/views'
import type { Bundle } from '@yaks/graph'
import { comp, type Frame, str, title } from './model.ts'

/** Worst first is historical occurrence count, not the retained sample size. */
export let openBugs = '.bug.status=open * .order=-bug.hits'
export let occurrences = (eid: string): string =>
  `.error.bug=${eid} * .order=-error.at`

type Context<Node> = RenderContext<Node> & Partial<Shown<Node>> & {
  errors?: Bundle[]
  traces?: Bundle[]
  traceLabel?: string
  tracesReady?: boolean
  tracesError?: string
  find?: (query: string) => string
}
let shown = <Node>(ctx: RenderContext<Node>) => ctx as Context<Node>
let frameText = (f: Frame) =>
  `${f.function ? f.function + ' · ' : ''}${f.file}${
    f.line ? ':' + f.line : ''
  }${f.column ? ':' + f.column : ''}`
let frames = <Node>(h: H<Node>, fs: Frame[], ctx: Context<Node>) =>
  h(
    'ol',
    null,
    fs.map((f) => {
      let eid = f.symbol || f.module
      return h(
        'li',
        null,
        f.app ? 'in app · ' : '',
        eid
          ? [
            ctx.show?.(
              ctx.get?.(eid) ?? { entity: { eid } },
              'Tracker.Frame.Inline',
            ),
            ' · ',
            h('code', null, frameText(f)),
          ]
          : h('code', null, frameText(f)),
      )
    }),
  )
let queryLink = <Node>(
  h: H<Node>,
  s: Context<Node>,
  query: string,
  label: string,
): Node =>
  h('a', { href: s.find?.(query) ?? `/?q=${encodeURIComponent(query)}` }, label)
let navigation = <Node>(h: H<Node>, s: Context<Node>): Node =>
  h(
    'nav',
    { 'aria-label': 'Tracker views' },
    queryLink(h, s, openBugs, 'Bugs'),
    ' · ',
    queryLink(h, s, '.trace', 'Traces'),
  )
let bugTile = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx), bug = comp(e, 'bug'), id = s.id?.(e) ?? e.entity.eid
  return h(
    'div',
    null,
    h(
      'a',
      { class: 'Tile', href: s.link?.(e.entity.eid) ?? `/${id}` },
      h('span', { class: 'Tile_Id' }, id),
      ' ',
      h('span', { class: 'Tile_Title' }, str(comp(e, 'doc').title)),
      ' ',
      h(
        'span',
        { class: 'Tile_Note' },
        `${bug.people ?? 0} people · first ${
          s.when?.(str(bug.first)) ?? str(bug.first)
        } · last ${s.when?.(str(bug.last)) ?? str(bug.last)}`,
      ),
      ' ',
      h('span', { class: 'Tile_Count' }, `${bug.hits ?? 0} hits`),
    ),
    queryLink(h, s, '.trace', 'Traces'),
  )
}
/** Request identity is an exact association. Other context is a bounded time
 * neighbour, not evidence that a trace contains or caused this error. */
export let relatedTraces = (
  e: Bundle,
): { query: string; label: string } | undefined => {
  let during = comp(e, 'during'), at = Date.parse(str(comp(e, 'error').at))
  let quote = (v: unknown) => JSON.stringify(str(v))
  if (during.request) {
    return {
      query: `.trace .during.request=${
        quote(during.request)
      } * .order=-trace.at`,
      label: 'Traces of the same request',
    }
  }
  let key = during.entity ? 'entity' : during.process ? 'process' : undefined
  if (!key || !Number.isFinite(at)) return
  let scopes = ['space', 'app'].filter((k) => during[k])
    .map((k) => `.during.${k}=${quote(during[k])}`).join(' ')
  return {
    query: `.trace .during.${key}=${quote(during[key])} ${scopes} .trace.at>=${
      quote(new Date(at - 300_000).toISOString())
    } .trace.at<=${
      quote(new Date(at + 300_000).toISOString())
    } * .order=-trace.at`,
    label: `Traces within 5 minutes in the same ${
      key == 'entity' ? 'store / context' : 'process'
    } (not a causal link)`,
  }
}
let reference = <Node>(h: H<Node>, s: Context<Node>, eid: string): Node =>
  s.show?.(s.get?.(eid) ?? { entity: { eid } }, 'Tracker.Context.Inline') ??
    h('a', { href: s.link?.(eid) }, s.name?.(eid) ?? eid)
let context = <Node>(e: Bundle, h: H<Node>, s: Context<Node>): Node | null => {
  let during = comp(e, 'during'), error = comp(e, 'error')
  let refs = [
    ['Store / context', during.entity],
    ['App', during.app],
    ['Space', during.space],
    ['Process', during.process],
    ['Request', during.request],
  ].filter(([, eid]) => eid)
  if (!refs.length && !error.commit && error.version == null) return null
  return h(
    'dl',
    { class: 'Pairs' },
    refs.map(([label, eid]) => [
      h('dt', { class: 'Pairs_Key' }, str(label)),
      h('dd', { class: 'Pairs_Value' }, reference(h, s, str(eid))),
    ]),
    error.commit
      ? [
        h('dt', { class: 'Pairs_Key' }, 'Commit'),
        h(
          'dd',
          { class: 'Pairs_Value' },
          h('code', { title: str(error.commit) }, str(error.commit)),
        ),
      ]
      : null,
    error.version != null
      ? [
        h('dt', { class: 'Pairs_Key' }, 'Version'),
        h('dd', { class: 'Pairs_Value' }, str(error.version)),
      ]
      : null,
  )
}
let traces = <Node>(h: H<Node>, s: Context<Node>): Node | null =>
  s.traceLabel
    ? h(
      'section',
      { class: 'Section' },
      h('h3', { class: 'Section_Title' }, s.traceLabel),
      s.tracesError
        ? h(
          'p',
          { class: 'Section_Sub' },
          `Traces unavailable: ${s.tracesError}`,
        )
        : s.tracesReady === false
        ? h('p', { class: 'Section_Sub' }, 'Loading traces…')
        : s.traces?.length
        ? s.traces.map((b) => s.show?.(b, 'List.Tile'))
        : h(
          'p',
          { class: 'Section_Sub' },
          'No recorded traces matched this occurrence.',
        ),
    )
    : null
let occurrence = <Node>(
  e: Bundle,
  h: H<Node>,
  ctx: RenderContext<Node>,
): Node => {
  let s = shown(ctx), error = comp(e, 'error'), x = comp(e, 'exception')
  return h(
    'section',
    { class: 'Section' },
    h(
      'h2',
      { class: 'Section_Title' },
      title(e),
      ' ',
      h(
        'time',
        { datetime: str(error.at), title: str(error.at) },
        s.when?.(str(error.at)) ?? str(error.at),
      ),
    ),
    h(
      'p',
      { class: 'Section_Sub' },
      str(error.level),
      error.environment ? ` · ${error.environment}` : '',
    ),
    context(e, h, s),
    traces(h, s),
    Array.isArray(x.frames) && x.frames.length || x.stack
      ? h(
        'details',
        null,
        h('summary', null, 'Stack and frames'),
        Array.isArray(x.frames) && x.frames.length
          ? frames(h, x.frames as Frame[], s)
          : null,
        x.stack ? h('pre', null, str(x.stack)) : null,
      )
      : null,
    Array.isArray(comp(e, 'breadcrumbs').items)
      ? h(
        'details',
        null,
        h('summary', null, 'Breadcrumbs'),
        h('pre', null, JSON.stringify(comp(e, 'breadcrumbs').items, null, 2)),
      )
      : null,
  )
}
let bugPage = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx), bug = comp(e, 'bug'), id = s.id?.(e) ?? e.entity.eid
  let errors = [...s.errors ?? []].sort((a, b) =>
    str(comp(b, 'error').at).localeCompare(str(comp(a, 'error').at))
  )
  let affected = ['entity', 'app', 'space', 'process'].flatMap((key) => {
    let ids = [
      ...new Set(
        errors.map((b) => str(comp(b, 'during')[key])).filter(Boolean),
      ),
    ]
    return ids.length ? [[key, ids] as const] : []
  })
  let commits = [
    ...new Set(errors.map((b) => str(comp(b, 'error').commit)).filter(Boolean)),
  ]
  return h(
    'article',
    { class: 'Body' },
    navigation(h, s),
    h(
      'header',
      { class: 'Head' },
      h(
        'h1',
        { class: 'Head_Title' },
        str(comp(e, 'doc').title),
        ' ',
        h('span', { class: 'Head_Id' }, id),
      ),
      h(
        'p',
        { class: 'Head_Facts' },
        str(
          bug.status ||
            (e.archived ? 'archived' : e.resolved ? 'resolved' : 'open'),
        ),
        ' · ',
        `${bug.hits ?? 0} hits · ${bug.people ?? 0} people`,
        ' · first ',
        s.when?.(str(bug.first)) ?? str(bug.first),
        ' · last ',
        s.when?.(str(bug.last)) ?? str(bug.last),
      ),
      h('p', { class: 'Head_Sub' }, str(bug.fault)),
    ),
    bug.culprit
      ? h(
        'p',
        null,
        'Culprit: ',
        s.show?.(
          s.get?.(str(bug.culprit)) ?? { entity: { eid: str(bug.culprit) } },
          'Tracker.Culprit.Inline',
        ),
      )
      : bug.spot
      ? h('p', null, h('code', null, str(bug.spot)))
      : null,
    h(
      'section',
      { class: 'Section' },
      h('h2', { class: 'Section_Title' }, 'Affected in retained occurrences'),
      affected.length || commits.length
        ? h(
          'dl',
          { class: 'Pairs' },
          affected.map(([key, ids]) => [
            h(
              'dt',
              { class: 'Pairs_Key' },
              key == 'entity' ? 'Store / context' : key,
            ),
            h(
              'dd',
              { class: 'Pairs_Value' },
              ids.map((eid, i) => [i ? ' · ' : '', reference(h, s, eid)]),
            ),
          ]),
          commits.length
            ? [
              h('dt', { class: 'Pairs_Key' }, 'Commits'),
              h(
                'dd',
                { class: 'Pairs_Value' },
                commits.map((
                  commit,
                  i,
                ) => [i ? ' · ' : '', h('code', null, commit)]),
              ),
            ]
            : null,
        )
        : h(
          'p',
          { class: 'Section_Sub' },
          'No affected store, app, process or commit was recorded.',
        ),
    ),
    h(
      'section',
      { class: 'Section' },
      h('h2', { class: 'Section_Title' }, 'Newest occurrence'),
      errors.length
        ? s.show?.(errors[0], 'Full')
        : h('p', null, 'No retained occurrences.'),
    ),
    errors.length > 1
      ? h(
        'section',
        { class: 'Section' },
        h(
          'h2',
          { class: 'Section_Title' },
          'Earlier occurrences · newest first',
        ),
        errors.slice(1).map((b) => s.show?.(b, 'Full')),
      )
      : null,
  )
}
export let views = define([
  { view: 'Full', match: parse('.bug'), render: bugPage },
  { view: 'Page', match: parse('.bug'), render: bugPage },
  { view: 'Tile', match: parse('.bug'), render: bugTile },
  { view: 'List.Tile', match: parse('.bug'), render: bugTile },
  { view: 'Full', match: parse('.error'), render: occurrence },
  { view: 'Page', match: parse('.error'), render: occurrence },
  { view: 'Tile', match: parse('.error'), render: occurrence },
  { view: 'List.Tile', match: parse('.error'), render: occurrence },
])
export { inspectViews } from './inspect.ts'
