/**
 * A persona's binder, and a skill's: what it says itself, then what it gives
 * an agent besides. A persona's head is its title and the project it works
 * for, each changed where it stands, and its own text reads as markdown and is
 * typed over on a double-click, as everywhere in browse. Under it come the
 * documents it links to, a list for each relation: Contains (`contains`
 * edges: each document said in full to an agent wearing it, in this order; a
 * tool it contains is offered to that agent, not said) and Reads (`reads`
 * edges: each listed by id and title under the text's `## Reads`, for an
 * agent to ask for). Last, behind a press, the memories in its scope it has
 * neither edge to.
 *
 * Contains and Reads are each an ordered list edited in place (@yaks/inspect
 * `Held`): a row dragged between two others is put there, which is the order
 * an agent is given it in, and a row opens where it stands on its document's
 * title and body, to type over. A row dragged onto the other list moves its
 * edge there, where it is dropped; onto the memories with neither edge, it
 * loses both. Anything that drags an entity (@yaks/ux `drag`), a row of the
 * desk or of any list, can be dropped the same way. A document both lists
 * lead to is said once, in full, and the binder says so.
 *
 * A skill's binder is its name, its description and its instructions, as an
 * agent loads them, each changed where it stands.
 *
 * Each row is drawn by its own renderer, asked for as `Context.List.Tile`.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import {
  Disclosure,
  disclosureAt,
  drag,
  dragged,
  drags,
  Edit,
  isOpen,
} from '@yaks/ux'
import {
  type Answer,
  type Asks,
  type Bundle,
  Held,
  type Io,
  mention,
  type Props,
  Words,
} from '@yaks/inspect'
import { EDGE, relations, unlink } from '@yaks/edge'
import { PERSONA } from './comp.ts'
import { NAMED } from './voice.ts'
import { CONTAINS, READS, served } from './worn.ts'

/** How many links from a persona its binder reads. */
export let EDGES = 500

/** How many of the memories in its scope, newest first, it lists. */
export let LOOSE = 50

type Comp = Record<string, unknown>
let str = (b: Bundle | undefined, name: string, prop: string): string => {
  let v = (b?.[name] as Comp | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}
let rows = (a?: Answer): Bundle[] => a?.rows ?? []
let far = (b: Bundle): string => str(b, EDGE, 'to')

/** The query for the memories in a persona's scope, through the indexed
 * `memory.scope`. A homeless persona's are the memories scoped to no
 * project. */
/// inScope({ home: 'P-1' }) -> '.memory.scope=P-1'
/// inScope({}) -> '.memory&!memory.scope'
export let inScope = (persona?: { home?: unknown }): string =>
  typeof persona?.home == 'string' && persona.home
    ? `.memory.scope=${persona.home}`
    : '.memory&!memory.scope'

/** What a persona's binder asks: the links leaving it, and the memories in
 * its scope with a document, newest first, and how many there are. */
export let asks = (e: Bundle, io: Io): Asks => {
  let scope = inScope(e[PERSONA] as Comp | undefined)
  return {
    out: `.${EDGE}.from=${e.entity.eid}&*&.limit=${EDGES}`,
    ...io.vocab.comp('memory')
      ? {
        loose: `${scope}&.doc&*&.order=-created.at&.limit=${LOOSE}`,
        scoped: `${scope}&.doc&.count`,
      }
      : {},
  }
}

/** The bundles that take `to` off each of a persona's lists named by
 * `tags` that it is on: what a row leaving them writes. */
/// let edge = (rel: string, to: string) => ({ entity: { eid: rel + to }, edge: { from: 'p', to }, [rel]: {} })
/// leaving('p', 'm', ['reads'], [edge('contains', 'm')]) -> []
/// leaving('p', 'm', ['contains', 'reads'], [edge('reads', 'm')]).map((b) => Object.keys(b).slice(1))
///   -> [['edge', 'reads']]
export let leaving = (
  from: string,
  to: string,
  tags: string[],
  out: Bundle[],
): Bundle[] =>
  tags.filter((t) => out.some((b) => b[t] && far(b) == to))
    .map((t) => unlink(from, t, to))

let picked = (io: Io, eid: string) =>
  io.edits
    ? {
      draggable: true,
      onDragStart: (ev: DragEvent) => drag(ev, eid),
    }
    : {}

/** One list of a persona's binder; one that takes a row anywhere on it
 * says what a drop there does (`onDrop`). */
let List = (
  { io, heading, sub, count, onDrop, children }: {
    io: Io
    heading: string
    sub: ComponentChildren
    count?: number
    onDrop?: (ev: DragEvent) => void
    children?: ComponentChildren
  },
): JSX.Element =>
  h(
    ui.Section,
    {
      'data-section': heading,
      ...io.edits && onDrop
        ? {
          onDragOver: (ev: DragEvent) => drags(ev) && ev.preventDefault(),
          onDrop,
        }
        : {},
    },
    h(
      ui.Section.Title,
      {},
      heading,
      count != null ? h(ui.Section.Count, {}, String(count)) : null,
    ),
    h(ui.Section.Sub, {}, sub),
    children,
  )

/** The memories in its scope it has neither edge to, each drawn by its own
 * renderer, to be dragged onto a list. */
let Loose = (
  { io, ids, ends, empty }: {
    io: Io
    ids: string[]
    ends?: Answer
    empty: string
  },
): JSX.Element => {
  let held = new Map(rows(ends).map((b) => [b.entity.eid, b]))
  return ids.length
    ? h(
      ui.Rows,
      { role: 'list' },
      ids.map((to) => {
        let end = held.get(to)
        return h(
          ui.Rows.Item,
          { key: to, role: 'listitem', 'data-held': to, ...picked(io, to) },
          end
            ? io.show(end, 'Context.List.Tile', {})
            : ends?.ready
            ? [mention(io, to), ' is gone']
            : h(ui.Loading, {}),
        )
      }),
    )
    : h(ui.Rows.More, {}, empty)
}

/** A relation's name as a heading: `contains` reads Contains. */
/// heading('contains') -> 'Contains'
export let heading = (relation: string): string =>
  relation.charAt(0).toUpperCase() + relation.slice(1)

/** A binder's head: its title, typed over where it stands, its id and kind,
 * and under them what the binder says about it. */
let Head = (
  { e, io, sub }: { e: Bundle; io: Io; sub?: ComponentChildren },
): JSX.Element =>
  h(
    ui.Head,
    {},
    h(
      ui.Head.Title,
      {},
      h(Edit.Text, {
        e,
        comp: 'doc',
        prop: 'title',
        inline: true,
        readOnly: !io.edits,
      }),
      h(ui.Head.Id, {}, io.id(e)),
      h(ui.Head.Kind, {}, io.kind(e)),
    ),
    sub ? h(ui.Head.Sub, {}, sub) : null,
  )

/** A persona's binder. */
export let PersonaBinder = ({ e, io, got }: Props): JSX.Element => {
  let eid = e.entity.eid
  let tags = relations(io.vocab)
  let [containsTag, readsTag] = [tags[CONTAINS], tags[READS]]
  let both = [containsTag, readsTag].filter(Boolean)
  let out = rows(got.out).filter(far)
  let ids = [...new Set(out.map(far))]
  let ends = io.ask(
    ids.length ? { ends: `.entity.eid=${ids.join(',')}&*` } : {},
  ).ends
  let on = (tag?: string) =>
    tag ? out.filter((b) => b[tag]).toSorted(served) : []
  let contained = on(containsTag)
  let read = on(readsTag)
  let linked = new Set([...contained, ...read].map(far))
  let twice = contained.filter((b) => read.some((n) => far(n) == far(b)))
  let loose = rows(got.loose).filter((b) => !linked.has(b.entity.eid))
  let home = str(e, PERSONA, 'home')
  // What is in scope less what of it is linked: the linked rows that are
  // memories of its own scope, read from the rows that brought them.
  let mine =
    rows(ends).filter((b) =>
      linked.has(b.entity.eid) && b.memory && str(b, 'memory', 'scope') == home
    ).length
  let scoped = got.scoped?.count
  let left = scoped == null ? undefined : Math.max(0, scoped - mine)

  // What says nothing, or the persona itself, is let fall.
  let fits = (to: string) => {
    let b = io.get(to)
    return to != eid && !(b && !b.doc && !b.content)
  }
  // A row joining one list leaves the other.
  let join = (tag: string) => (to: string) =>
    fits(to) ? leaving(eid, to, both.filter((t) => t != tag), out) : undefined
  // A row dropped on the memories with neither edge loses both.
  let drop = (ev: DragEvent) => {
    let to = dragged(ev)
    if (!to || !fits(to)) return
    ev.preventDefault()
    ev.stopPropagation()
    let batch = leaving(eid, to, both, out)
    if (batch.length) void io.apply(batch)
  }
  let list = (tag: string, links: Bundle[]) =>
    h(Held, {
      io,
      from: eid,
      links,
      ends,
      tile: 'Context.List.Tile',
      empty: 'none yet: drop one here',
      tag,
      join: join(tag),
    })

  let at = disclosureAt(`${eid}/neither`)
  let open = io.state(at) ?? { entity: { eid: at } }
  return h(
    'div',
    { 'data-binder': eid },
    h(Head, {
      e,
      io,
      sub: [
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
      ],
    }),
    h(Words, { io, e, comp: 'doc', prop: 'body' }),
    twice.length
      ? h(
        ui.Section.Sub,
        { 'data-twice': '' },
        'Both a contains and a reads edge lead to ',
        ...twice.flatMap((b, i) => [i ? ', ' : '', mention(io, far(b))]),
        ': said in full once. Drop each on one list to keep one edge.',
      )
      : null,
    containsTag
      ? h(
        List,
        {
          io,
          heading: heading(CONTAINS),
          sub:
            'each said in full to an agent wearing it, in this order; a tool it contains is offered to that agent, not said',
          count: contained.length,
        },
        list(containsTag, contained),
      )
      : null,
    readsTag
      ? h(
        List,
        {
          io,
          heading: heading(READS),
          sub:
            `each listed by id and title under “${NAMED}” at the end of its text, for an agent to ask for`,
          count: read.length,
        },
        list(readsTag, read),
      )
      : null,
    got.loose
      ? h(
        List,
        {
          io,
          heading: 'Memories in its scope with neither edge',
          sub: home
            ? [
              'memory.scope is ',
              mention(io, home),
              ', and no contains or reads edge leads to them from it',
            ]
            : 'no memory.scope, and no contains or reads edge leads to them from it',
          count: left,
          onDrop: drop,
        },
        h(
          Disclosure,
          {
            e: open,
            onChange: (b: Bundle) => io.set([b]),
            summary: [
              isOpen(open) ? '▾ ' : '▸ ',
              left == null
                ? 'the newest'
                : `the newest ${Math.min(LOOSE, left)}`,
            ],
            summaryProps: { mod: 'quiet' },
          },
          h(Loose, {
            io,
            ids: loose.map((b) => b.entity.eid),
            ends: got.loose,
            empty: 'an edge leads to every one',
          }),
        ),
      )
      : null,
  )
}

/** A skill's binder: its name and description, then its instructions, as an
 * agent loads them, each changed where it stands. */
export let SkillBinder = ({ e, io }: Props): JSX.Element =>
  h(
    'div',
    { 'data-binder': e.entity.eid },
    h(Head, { e, io }),
    h(Words, { io, e, comp: 'doc', prop: 'body', empty: 'no description yet' }),
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
      }),
    ),
  )
