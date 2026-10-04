// Portable readings of bugs and errors, through the host's hyperscript and
// shared entity renderer. Related errors arrive as bundles from the host.
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
let bugTile = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx), bug = comp(e, 'bug'), id = s.id?.(e) ?? e.entity.eid
  return h(
    'a',
    { class: 'Tile', href: s.link?.(e.entity.eid) ?? `/${id}` },
    h('span', { class: 'Tile_Id' }, id),
    ' ',
    h('span', { class: 'Tile_Title' }, str(comp(e, 'doc').title)),
    ' ',
    h(
      'span',
      { class: 'Tile_Note' },
      `${bug.people ?? 0} people · last ${
        s.when?.(str(bug.last)) ?? str(bug.last)
      }`,
    ),
    ' ',
    h('span', { class: 'Tile_Count' }, `${bug.hits ?? 0} hits`),
  )
}
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
      error.commit
        ? ` · commit ${str(error.commit).slice(0, 12)}`
        : error.version != null
        ? ` · version ${error.version}`
        : '',
      error.environment ? ` · ${error.environment}` : '',
    ),
    Array.isArray(x.frames) && x.frames.length
      ? frames(h, x.frames as Frame[], s)
      : x.stack
      ? h('pre', null, str(x.stack))
      : null,
  )
}
let bugPage = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = shown(ctx), bug = comp(e, 'bug'), id = s.id?.(e) ?? e.entity.eid
  return h(
    'article',
    { class: 'Body' },
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
      h('h2', { class: 'Section_Title' }, 'Errors · newest first'),
      (s.errors ?? []).map((b) => s.show?.(b, 'Full')),
    ),
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
