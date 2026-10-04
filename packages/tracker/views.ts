// The tracker owns what a bug and an occurrence mean. The canvas supplies
// its subscribed, paged query view; the domain owns the query and the faces.
import { type ComponentChildren, h } from 'preact'
import { parse } from '@yaks/query'
import { define } from '@yaks/render'
import type { ComponentRenderer } from '@yaks/preact'
import type { Bundle } from '@yaks/graph'
import { Body, Head, Section, Tile } from '@yaks/ui'
import { useHost } from '@yaks/ux'
import { comp, type Frame, str, title } from './model.ts'

/** Worst first is historical occurrence count, not the retained sample size. */
export let openBugs = '.bug.status=open * .order=-bug.hits'
export let occurrences = (eid: string): string =>
  `.error.bug=${eid} * .order=-error.at`

type Props = {
  e: Bundle
  queryView?: (eid: string, query: string) => ComponentChildren
}
let frameText = (f: Frame) =>
  `${f.function ? f.function + ' · ' : ''}${f.file}${
    f.line ? ':' + f.line : ''
  }${f.column ? ':' + f.column : ''}`

export let Frames = ({ frames }: { frames: Frame[] }) => (
  h(
    'ol',
    null,
    frames.map((f) =>
      h(
        'li',
        null,
        f.app ? 'in app · ' : '',
        f.symbol || f.module
          ? h('a', { href: `/${f.symbol || f.module}` }, frameText(f))
          : h('code', null, frameText(f)),
      )
    ),
  )
)
export let Bug = ({ e, queryView }: Props) => {
  let host = useHost(), bug = comp(e, 'bug')
  return h(
    Body,
    null,
    h(
      Head,
      null,
      h(
        Head.Title,
        null,
        str(comp(e, 'doc').title),
        ' ',
        h(Head.Id, null, host.id(e)),
      ),
      h(
        Head.Facts,
        null,
        h(
          'span',
          null,
          str(
            bug.status ||
              (e.archived ? 'archived' : e.resolved ? 'resolved' : 'open'),
          ),
        ),
        h('span', null, `${bug.hits ?? 0} hits`),
        h('span', null, `${bug.people ?? 0} people`),
        h('span', null, `first ${host.when(str(bug.first))}`),
        h('span', null, `last ${host.when(str(bug.last))}`),
      ),
      h(Head.Sub, null, str(bug.fault)),
    ),
    bug.culprit
      ? h(
        'p',
        null,
        'Culprit: ',
        h('a', { href: `/${bug.culprit}` }, host.name(str(bug.culprit))),
      )
      : bug.spot
      ? h('p', null, h('code', null, str(bug.spot)))
      : null,
    h(
      Section,
      null,
      h(Section.Title, null, 'Errors · newest first'),
      queryView?.(e.entity.eid, occurrences(e.entity.eid)),
    ),
  )
}
export let BugTile = ({ e }: Props) => {
  let host = useHost(), bug = comp(e, 'bug')
  return h(
    Tile,
    { href: `/${host.id(e)}` },
    h(Tile.Id, null, host.id(e)),
    h(Tile.Title, null, str(comp(e, 'doc').title)),
    h(
      Tile.Note,
      null,
      `${bug.people ?? 0} people · last ${host.when(str(bug.last))}`,
    ),
    h(Tile.Count, null, `${bug.hits ?? 0} hits`),
  )
}
export let Occurrence = ({ e }: Props) => {
  let host = useHost(), error = comp(e, 'error'), x = comp(e, 'exception')
  return h(
    Section,
    null,
    h(
      Section.Title,
      null,
      title(e),
      ' ',
      h(
        'time',
        { dateTime: str(error.at), title: str(error.at) },
        host.when(str(error.at)),
      ),
    ),
    h(
      Section.Sub,
      null,
      str(error.level),
      error.commit
        ? ` · commit ${str(error.commit).slice(0, 12)}`
        : error.version != null
        ? ` · version ${error.version}`
        : '',
      error.environment ? ` · ${error.environment}` : '',
    ),
    Array.isArray(x.frames) && x.frames.length
      ? h(Frames, { frames: x.frames as Frame[] })
      : x.stack
      ? h('pre', null, str(x.stack))
      : null,
  )
}
export let views = define<ComponentRenderer>([
  { view: 'Full', match: parse('.bug'), Render: Bug },
  { view: 'Tile', match: parse('.bug'), Render: BugTile },
  { view: 'List.Tile', match: parse('.bug'), Render: BugTile },
  { view: 'Full', match: parse('.error'), Render: Occurrence },
  { view: 'List.Tile', match: parse('.error'), Render: Occurrence },
])
