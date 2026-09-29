/**
 * `Inspect.Full`: an entity's inspector page, whatever it is. The way here
 * (the trail), the entity's own tile, and a row of lenses; under them, the
 * body the lens draws. The first lens, `Inspect.Sections`, is its parts one
 * section at a time, and what those sections are is the kind's: a component
 * shows its properties and where it is used, an entity its fields, links and
 * history (./views.ts registers a `Inspect.Sections` per kind). Any other
 * view the registry draws the entity as is a lens too: `Inspect.JSON`
 * always, `Inspect.Markdown` where a host gives one.
 *
 * A section is a view of its own, with its own asks, folded or open by a
 * `section` row in the page's own graph; a folded section asks nothing.
 * `section()` builds one from its title, its asks and its body.
 *
 * @module
 */

import { type ComponentChildren, type FunctionComponent, h } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import { Crumbs, Section, Tabs } from '@yaks/ui'
import type { Query } from '@yaks/query'
import type { Asks, Bundle, Io, Props, View } from './host.ts'
import { comp, count } from './read.ts'

/** The page's own graph's row for the trail. */
export let TRAIL = 'inspect:trail'
/** How many steps the trail keeps. */
export let STEPS = 8

/**
 * The trail after visiting `eid`: back to it where it was already a step,
 * else one step on, the oldest dropped past {@link STEPS}.
 *
 * ```ts
 * import { stepped } from './page.ts'
 * stepped(['a', 'b', 'c'], 'b') // ['a', 'b']
 * stepped(['a'], 'b') // ['a', 'b']
 * ```
 */
export let stepped = (steps: string[], eid: string): string[] => {
  let at = steps.indexOf(eid)
  return at >= 0 ? steps.slice(0, at + 1) : [...steps, eid].slice(-STEPS)
}

let steps = (io: Io): string[] =>
  (comp(io.state(TRAIL), 'trail').steps as string[] | undefined) ?? []

/** The lens every page opens on. */
export let SECTIONS = 'Inspect.Sections'
let LENSES = [SECTIONS, 'Inspect.Markdown', 'Inspect.JSON']
let named: Record<string, string> = {
  [SECTIONS]: 'parts',
  'Inspect.Markdown': 'markdown',
  'Inspect.JSON': 'json',
}

let lensOf = (io: Io, eid: string): string =>
  String(comp(io.state(eid), 'lens').view ?? SECTIONS)

// The way here: the map, then each page drilled through, this one last.
let Trail = ({ e, io }: { e: Bundle; io: Io }) =>
  h(
    Crumbs,
    {},
    h(Crumbs.Item, { href: io.find('') }, 'inspect'),
    ...steps(io).map((eid) =>
      eid == e.entity.eid
        ? h(Crumbs.Item, { mod: 'here' }, io.name(eid))
        : h(Crumbs.Item, { href: io.link(eid) }, io.name(eid))
    ),
  )

/** An entity's page: the trail, its tile, its lenses, and what the lens
 * draws. */
export let Full = ({ e, io }: Props) => {
  let eid = e.entity.eid
  useLayoutEffect(() => {
    let now = stepped(steps(io), eid)
    if (now.join() != steps(io).join()) {
      io.set([{ entity: { eid: TRAIL }, trail: { steps: now } }])
    }
  }, [eid])
  let lens = lensOf(io, eid)
  let lenses = LENSES.filter((v) => io.can(e, v))
  return h(
    'div',
    { class: 'Inspect', 'data-inspect': eid },
    h(Trail, { e, io }),
    io.show(e, 'Inspect.Tile'),
    lenses.length > 1
      ? h(
        Tabs,
        {},
        lenses.map((v) =>
          h(Tabs.Tab, {
            key: v,
            type: 'button',
            mod: v == lens && 'on',
            onClick: () => io.set([{ entity: { eid }, lens: { view: v } }]),
          }, named[v] ?? v)
        ),
      )
      : null,
    io.show(e, lenses.includes(lens) ? lens : SECTIONS),
  )
}

/** The sections a kind's page shows, in order, each drawn through the
 * registry: `sections(['Inspect.Fields', 'Inspect.History'])`. */
export let sections = (
  views: string[],
): FunctionComponent<Props> =>
({ e, io }) =>
  h('div', { class: 'Inspect_Sections' }, views.map((v) => io.show(e, v)))

/** What a section says about itself. */
export type Part = {
  view: string
  match: Query | true
  title: string
  /** open until folded (the default), or folded until opened */
  open?: boolean
  /** what it asks while it is open */
  asks?: (e: Bundle, io: Io) => Asks
  /** how many things it shows, once it knows */
  count?: (p: Props) => number | undefined
  /** said beside its title */
  note?: (p: Props) => ComponentChildren
  /** its body, drawn while it is open; null draws no section at all */
  Body: FunctionComponent<Props>
  /** whether it has anything to show this bundle at all */
  shows?: (e: Bundle, io: Io) => boolean
}

/** The id of a section's row in the page's own graph. */
export let fold = (eid: string, view: string): string => `${eid} ${view}`

// What a section says under its title about its last write.
let say = (io: Io, eid: string, view: string, said: string | null) =>
  io.set([{ entity: { eid: fold(eid, view) }, section: { said } }])

/** Say under the section `view` of the page for `eid` that a write from it
 * was refused, and why. */
export let refused = (io: Io, eid: string, view: string, err: unknown) =>
  say(io, eid, view, err instanceof Error ? err.message : String(err))

/** Write `change` from the section `view` of the page for `eid`: a refusal
 * is said under the section's title until a write from it lands. */
export let write = (
  io: Io,
  eid: string,
  view: string,
  change: Bundle[],
): Promise<void> =>
  Promise.resolve()
    .then(() => io.apply(change))
    .then(() => say(io, eid, view, null), (err) => refused(io, eid, view, err))

let opened = (io: Io, e: Bundle, s: Part): boolean =>
  (comp(io.state(fold(e.entity.eid, s.view)), 'section').open as
    | boolean
    | undefined) ?? s.open ?? true

/** A section of a page, as a view: its fold, title and count, and its body
 * while it is open. */
export let section = (s: Part): View => ({
  view: s.view,
  match: s.match,
  asks: (e, io) =>
    (s.shows?.(e, io) ?? true) && opened(io, e, s) ? s.asks?.(e, io) ?? {} : {},
  Render: (p) => {
    if (!(s.shows?.(p.e, p.io) ?? true)) return null
    let open = opened(p.io, p.e, s)
    let n = open ? s.count?.(p) : undefined
    let id = fold(p.e.entity.eid, s.view)
    let said = comp(p.io.state(id), 'section').said
    return h(
      Section,
      { 'data-section': s.view },
      h(
        Section.Title,
        {},
        h(Section.Fold, {
          type: 'button',
          mod: open && 'open',
          'aria-label': `${open ? 'fold' : 'unfold'} ${s.title}`,
          onClick: () =>
            p.io.set([{ entity: { eid: id }, section: { open: !open } }]),
        }),
        s.title,
        n != null ? h(Section.Count, {}, count(n)) : null,
        s.note ? h(Section.Note, {}, s.note(p)) : null,
        said ? h(Section.Note, { mod: 'refused' }, String(said)) : null,
      ),
      open ? h(s.Body, p) : null,
    )
  },
})

/** A sent form's named controls, each what it holds, trimmed; the form is
 * cleared for the next. What is typed stays in the element until it is
 * sent, never in a view. */
export let sent = (
  ev: Event & { currentTarget: HTMLFormElement },
): Record<string, string> => {
  ev.preventDefault()
  let form = ev.currentTarget
  let named = [...form.querySelectorAll<HTMLInputElement>('[name]')]
  let out = Object.fromEntries(
    named.map((c) => [c.name, String(c.value ?? '').trim()]),
  )
  for (let c of named) if (c.localName != 'select') c.value = ''
  return out
}
