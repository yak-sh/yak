/**
 * What a persona or a skill gives an agent, typed into where it shows: the
 * body of its Full page (`Full.Body`). A persona says the project it works
 * for, then its own text; a skill its description, then its instructions.
 * Under them come the documents it carries: those it contains (`contains`
 * edges) and those it reads (`reads` edges), in the order an agent is given
 * them. Each shows its title over its body, and a click on either types into
 * it where it stands (@yaks/ux `Edit.Text`): nothing to open first, and
 * nothing on it drags. A tool it contains is offered to an agent, not said,
 * so it is among the page's relationships rather than here.
 *
 * Under each list a press writes a new document into it: one with nothing
 * written yet, linked by that list's relation after the others, its title
 * open for typing.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import { at, Edit, put, useEdit } from '@yaks/ux'
import {
  type Answer,
  type Asks,
  type Bundle,
  type Io,
  mention,
  type Props,
  Words,
} from '@yaks/inspect'
import { mint } from '@yaks/graph/identity'
import { EDGE, link, placed, relations } from '@yaks/edge'
import { PERSONA } from './comp.ts'
import { NAMED } from './voice.ts'
import { CONTAINS, READS, served } from './worn.ts'

/** How many links from a persona or a skill its page reads. */
export let EDGES = 500

type Comp = Record<string, unknown>
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = (b?.[name] as Comp | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []
let far = (b: Bundle): string => str(b, EDGE, 'to')

/** What a persona's or a skill's body asks: the links leaving it. */
export let asks = (e: Bundle): Asks => ({
  out: `.${EDGE}.from=${e.entity.eid}&*&.limit=${EDGES}`,
})

// The owner of every carried document's `Edit` state on one page, so the
// press that writes a new document opens its title before it is drawn.
let owner = (from: string) => `carried/${from}`

/** One carried document: its title over its body, each typed into on a
 * click. */
let Carried = (
  { io, end, from }: { io: Io; end: Bundle; from: string },
): JSX.Element => {
  let eid = end.entity.eid
  let titled = at(owner(from), eid, 'doc', 'title')
  let edit = useEdit(eid, 'doc', 'title', {
    at: titled,
    value: str(end, 'doc', 'title'),
  })
  return h(
    ui.Doc,
    { mod: io.edits ? 'typed' : undefined, 'data-carried': eid },
    h(
      ui.Doc.Title,
      { onClick: io.edits && !edit.open ? edit.begin : undefined },
      h(Edit.Text, {
        e: end,
        comp: 'doc',
        prop: 'title',
        at: titled,
        inline: true,
        readOnly: !io.edits,
      }),
    ),
    h(Words, {
      io,
      e: end,
      comp: 'doc',
      prop: 'body',
      at: at(owner(from), eid, 'doc', 'body'),
      click: true,
    }),
  )
}

/** The bundles that write a new document `eid` into `from`'s list of
 * `links` by `tag`, after the others. */
/// let doc = written('p', 'contains', [], 'd')
/// doc[0] -> { entity: { eid: 'd' }, doc: { title: '', body: '' } }
/// doc[1].edge -> { from: 'p', to: 'd', ord: 1 }
export let written = (
  from: string,
  tag: string,
  links: Bundle[],
  eid: string,
): Bundle[] => [
  { entity: { eid }, doc: { title: '', body: '' } },
  ...placed(links, link(from, tag, eid), links.length),
]

/** One list of what it carries, under its heading: each document typed into
 * where it shows, and the press that writes a new one into it. */
let List = (
  { io, from, tag, heading, sub, links, ends }: {
    io: Io
    from: string
    tag: string
    heading: string
    sub: ComponentChildren
    links: Bundle[]
    ends?: Answer
  },
): JSX.Element => {
  let held = new Map(rows(ends).map((b) => [b.entity.eid, b]))
  let docs = [...new Set(links.map(far))]
    .map((to) => held.get(to))
    .filter((b): b is Bundle => !!b?.doc)
  let write = () => {
    let eid = mint()
    io.set(put(at(owner(from), eid, 'doc', 'title'), { open: true }))
    void io.apply(written(from, tag, links, eid))
  }
  return h(
    ui.Section,
    { 'data-section': heading },
    h(
      ui.Section.Title,
      {},
      heading,
      h(ui.Section.Count, {}, String(docs.length)),
    ),
    h(ui.Section.Sub, {}, sub),
    ...docs.map((end) => h(Carried, { key: end.entity.eid, io, end, from })),
    !docs.length
      ? links.length && !ends?.ready
        ? h(ui.Loading, {})
        : h(ui.Rows.More, {}, 'none yet')
      : null,
    io.edits
      ? h(ui.Button, {
        type: 'button',
        mod: 'add',
        'data-write': tag,
        onClick: write,
      }, '+ new document')
      : null,
  )
}

/** What a persona or a skill carries: a list for each relation it carries
 * documents by, with what each says to an agent. */
let Lists = (
  { e, io, got, subs }: Props & {
    subs: Record<string, ComponentChildren>
  },
): JSX.Element => {
  let from = e.entity.eid
  let tags = relations(io.vocab)
  let out = rows(got.out).filter(far)
  let ids = [...new Set(out.map(far))]
  let ends = io.ask(
    ids.length ? { ends: `.entity.eid=${ids.join(',')}&*` } : {},
  ).ends
  return h(
    'div',
    {},
    ...[CONTAINS, READS].filter((rel) => tags[rel]).map((rel) =>
      h(List, {
        key: rel,
        io,
        from,
        tag: tags[rel],
        heading: rel.charAt(0).toUpperCase() + rel.slice(1),
        sub: subs[rel],
        links: out.filter((b) => b[tags[rel]]).toSorted(served),
        ends,
      })
    ),
  )
}

/** A persona's body: the project it works for, its own text, then what it
 * carries. */
export let PersonaBody = (p: Props): JSX.Element => {
  let { e, io } = p
  let home = str(e, PERSONA, 'home')
  return h(
    'div',
    { 'data-body': e.entity.eid },
    h(
      ui.Body,
      { mod: 'short' },
      'works for ',
      home ? null : 'no project ',
      home || io.edits
        ? h(Edit, {
          e,
          comp: PERSONA,
          prop: 'home',
          editable: io.edits,
          handle: true,
          name: 'project',
          show: (_: string | null, v: unknown) =>
            typeof v == 'string' && v ? mention(io, v) : null,
        })
        : null,
    ),
    h(Words, { io, e, comp: 'doc', prop: 'body', click: true }),
    h(Lists, {
      ...p,
      subs: {
        [CONTAINS]:
          'each said in full to an agent wearing it, in this order; a tool it contains is offered to that agent, not said',
        [READS]:
          `each listed by id and title under “${NAMED}” at the end of its text, for an agent to ask for`,
      },
    }),
  )
}

/** A skill's body: its description and its instructions, as an agent loads
 * them, then what it carries. */
export let SkillBody = (p: Props): JSX.Element => {
  let { e, io } = p
  return h(
    'div',
    { 'data-body': e.entity.eid },
    h(Words, {
      io,
      e,
      comp: 'doc',
      prop: 'body',
      empty: 'no description yet',
      click: true,
    }),
    h(
      ui.Section,
      { 'data-section': 'Instructions' },
      h(ui.Section.Title, {}, 'Instructions'),
      h(Words, {
        io,
        e,
        comp: 'content',
        prop: 'body',
        empty: 'none are written yet',
        click: true,
      }),
    ),
    h(Lists, {
      ...p,
      subs: {
        [CONTAINS]: 'the documents it contains, in order',
        [READS]: 'the documents it reads',
      },
    }),
  )
}
