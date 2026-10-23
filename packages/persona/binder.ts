/**
 * A persona's binder, and a skill's: what it says itself, then what it gives
 * an agent besides. A persona's head names the project it works for; under
 * its own text come the documents it carries, said in full in the order an
 * agent reads them (`contains`), the ones it names in its Reads list
 * (`reads`), and last, behind a press, the memories in its scope that it
 * carries neither way. A row dragged onto another list moves there: onto
 * Carries or Reads it is linked by that relation and unlinked from the other,
 * onto Not carried it is unlinked from both. Anything that carries an entity
 * (@yaks/ux `carry`), a row of the desk or of any list, can be dropped the
 * same way. A document on both lists is said once, in full, and the binder
 * says so.
 *
 * A skill's binder is its description and its instructions, as an agent
 * loads them.
 *
 * Each row is drawn by its own renderer, asked for as `Context.List.Tile`.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { Markdown } from '@yaks/markdown'
import * as ui from '@yaks/ui'
import {
  carried,
  carries,
  carry,
  Disclosure,
  disclosureAt,
  isOpen,
} from '@yaks/ux'
import {
  type Answer,
  type Asks,
  type Bundle,
  edited,
  type Io,
  mention,
  type Props,
} from '@yaks/inspect'
import { EDGE, link, relations, unlink } from '@yaks/edge'
import { PERSONA } from './comp.ts'
import { CARRIES, READS, served } from './worn.ts'

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

/** The bundles that move `to` onto one of a persona's lists: linked by
 * `tag` and unlinked from every other of `tags` it is on now; with no `tag`,
 * unlinked from them all. */
/// let edge = (rel: string, to: string) => ({ entity: { eid: rel + to }, edge: { from: 'p', to }, [rel]: {} })
/// moved('p', 'm', 'reads', ['contains', 'reads'], [edge('contains', 'm')]).map((b) => Object.keys(b).slice(1))
///   -> [['edge', 'contains'], ['edge', 'reads']]
/// moved('p', 'm', 'contains', ['contains', 'reads'], [edge('contains', 'm')]) -> []
/// moved('p', 'm', undefined, ['contains', 'reads'], [edge('reads', 'm')]).length -> 1
export let moved = (
  from: string,
  to: string,
  tag: string | undefined,
  tags: string[],
  out: Bundle[],
): Bundle[] => {
  let has = (t: string) => out.some((b) => b[t] && far(b) == to)
  return [
    ...tags.filter((t) => t != tag && has(t)).map((t) => unlink(from, t, to)),
    ...tag && !has(tag) ? [link(from, tag, to)] : [],
  ]
}

let drag = (io: Io, eid: string) =>
  io.edits
    ? {
      draggable: true,
      onDragStart: (ev: DragEvent) => carry(ev, eid),
    }
    : {}

/** One list of a persona's binder, a place to drop a row on. */
let List = (
  { io, heading, sub, count, onDrop, children }: {
    io: Io
    heading: string
    sub: string
    count?: number
    onDrop: (ev: DragEvent) => void
    children?: ComponentChildren
  },
): JSX.Element =>
  h(
    ui.Section,
    {
      'data-section': heading,
      ...io.edits
        ? {
          onDragOver: (ev: DragEvent) => carries(ev) && ev.preventDefault(),
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

/** Each of some entities, drawn by its own renderer, in the order given. */
let Held = (
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
          { key: to, role: 'listitem', 'data-held': to, ...drag(io, to) },
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

/** A persona's binder. */
export let PersonaBinder = ({ e, io, got }: Props): JSX.Element => {
  let eid = e.entity.eid
  let tags = relations(io.vocab)
  let [carriesTag, readsTag] = [tags[CARRIES], tags[READS]]
  let both = [carriesTag, readsTag].filter(Boolean)
  let out = rows(got.out).filter(far)
  let ids = [...new Set(out.map(far))]
  let ends = io.ask(
    ids.length ? { ends: `.entity.eid=${ids.join(',')}&*` } : {},
  ).ends
  let on = (tag?: string) =>
    tag ? out.filter((b) => b[tag]).toSorted(served) : []
  let held = on(carriesTag)
  let named = on(readsTag)
  let tiered = new Set([...held, ...named].map(far))
  let twice = held.filter((b) => named.some((n) => far(n) == far(b)))
  let loose = rows(got.loose).filter((b) => !tiered.has(b.entity.eid))
  let home = str(e, PERSONA, 'home')
  // What is in scope less what of it is carried: the carried rows that are
  // memories of its own scope, read from the rows that brought them.
  let mine =
    rows(ends).filter((b) =>
      tiered.has(b.entity.eid) && b.memory && str(b, 'memory', 'scope') == home
    ).length
  let scoped = got.scoped?.count
  let left = scoped == null ? undefined : Math.max(0, scoped - mine)

  // A row dropped here moves to this list; what carries nothing to say, or
  // the persona itself, is let fall.
  let drop = (tag?: string) => (ev: DragEvent) => {
    let to = carried(ev)
    let b = to && io.get(to)
    if (!to || to == eid || b && !b.doc && !b.content) return
    ev.preventDefault()
    ev.stopPropagation()
    let batch = moved(eid, to, tag, both, out)
    if (batch.length) void io.apply(batch)
  }

  let at = disclosureAt(`${eid}/not carried`)
  let open = io.state(at) ?? { entity: { eid: at } }
  return h(
    'div',
    { 'data-binder': eid },
    io.show(e, 'Inspect.Head', {
      sub: home ? ['works for ', mention(io, home)] : null,
    }),
    io.show(e, 'Inspect.Body'),
    twice.length
      ? h(
        ui.Section.Sub,
        { 'data-twice': '' },
        'On both lists, said in full once: ',
        ...twice.flatMap((b, i) => [i ? ', ' : '', mention(io, far(b))]),
        '. Drop each on one to settle it.',
      )
      : null,
    carriesTag
      ? h(
        List,
        {
          io,
          heading: 'Carries',
          sub: 'said in full to every agent wearing it, in this order',
          count: held.length,
          onDrop: drop(carriesTag),
        },
        h(Held, {
          io,
          ids: held.map(far),
          ends,
          empty: 'nothing yet: drop one here',
        }),
      )
      : null,
    readsTag
      ? h(
        List,
        {
          io,
          heading: 'Reads',
          sub: 'named in its Reads list, for an agent to ask for',
          count: named.length,
          onDrop: drop(readsTag),
        },
        h(Held, {
          io,
          ids: named.map(far),
          ends,
          empty: 'nothing yet: drop one here',
        }),
      )
      : null,
    got.loose
      ? h(
        List,
        {
          io,
          heading: 'Not carried',
          sub: home
            ? 'memories of the project it works for that it carries neither way'
            : 'memories of no project that it carries neither way',
          count: left,
          onDrop: drop(),
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
          h(Held, {
            io,
            ids: loose.map((b) => b.entity.eid),
            ends: got.loose,
            empty: 'every one is carried',
          }),
        ),
      )
      : null,
    edited(io, eid) ? io.show(e, 'Inspect.Facts', {}) : null,
  )
}

/** A skill's binder: its description, then its instructions, as an agent
 * loads them. */
export let SkillBinder = ({ e, io }: Props): JSX.Element => {
  let eid = e.entity.eid
  let said = str(e, 'content', 'body')
  return h(
    'div',
    { 'data-binder': eid },
    io.show(e, 'Inspect.Head', {}),
    io.show(e, 'Inspect.Body'),
    edited(io, eid) ? io.show(e, 'Inspect.Facts', {}) : h(
      ui.Section,
      { 'data-section': 'Instructions' },
      h(ui.Section.Title, {}, 'Instructions'),
      said
        ? h(ui.Body, {}, h(Markdown, { source: said }))
        : h(ui.Rows.More, {}, 'none are written yet'),
    ),
  )
}
