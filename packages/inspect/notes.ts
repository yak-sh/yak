/**
 * Notes: what a person says about a part, left under the heading they saw it
 * under, and picked up as work. Every heading on a page offers a `note`
 * press, which opens one line under it; what is sent is a comment on the
 * page's entity (`comment{target}`) that is also an open task (`task{}`), so
 * it shows under that heading again, and is on every list of open work until
 * someone takes it: `yak task list`, or `yak task list .comment.target=<eid>`
 * for what was said about one part.
 *
 * A comment says nothing of where on its target it was left, so the heading
 * rides in the note's title, after the thing it is about:
 * `task · Properties: status should be an enum`. A note whose title names no
 * heading on the page shows under the page's own.
 *
 * `Part` is a titled section of a page with its note press and its notes.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { Button, Field, Notes, Say, Section } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { comp, count, line, named, str } from './read.ts'
import { rows } from './rows.ts'
import { edited, key, me, put, refusal, write } from './state.ts'

/** How many notes a page reads. */
export let NOTES = 100

/** The notes left on the entity `eid`, as a query. */
export let notesOf = (eid: string): string =>
  `.comment&.comment.target=${eid}&.limit=${NOTES}&*`

/**
 * A note's title: the thing it is about, the heading it was left under, and
 * the first line of what it says.
 *
 * ```ts
 * import { titled } from './notes.ts'
 * titled('task', 'Properties', 'status should be an enum\nit is text')
 * // 'task · Properties: status should be an enum'
 * titled('T-9', '', 'wrong owner') // 'T-9: wrong owner'
 * ```
 */
export let titled = (subject: string, heading: string, text: string): string =>
  `${heading ? `${subject} · ${heading}` : subject}: ${line(text, 80)}`

/**
 * A note on the entity `eid`, left under `heading`, as the change that
 * leaves it: a comment on it that is an open task.
 *
 * ```ts
 * import { note } from './notes.ts'
 * note('c1', 'task', 'Properties', 'status should be an enum')
 * // [{
 * //   entity: { eid: '$note' },
 * //   doc: { title: 'task · Properties: status should be an enum', body: 'status should be an enum' },
 * //   comment: { target: 'c1' },
 * //   task: {},
 * // }]
 * ```
 */
export let note = (
  eid: string,
  subject: string,
  heading: string,
  text: string,
): Bundle[] => [{
  entity: { eid: '$note' },
  doc: { title: titled(subject, heading, text), body: text },
  comment: { target: eid },
  task: {},
}]

/**
 * The notes under each heading of a page: by the heading a note's title
 * names, or under the page's own (`''`) when it names none of them.
 *
 * ```ts
 * import { under } from './notes.ts'
 * let n = (title: string) => ({ entity: { eid: title }, doc: { title } })
 * let by = under([n('task · Properties: a'), n('task: b'), n('task · Gone: c')], 'task', ['Properties'])
 * by.get('Properties')!.length // 1
 * by.get('')!.length // 2
 * ```
 */
export let under = (
  notes: Bundle[],
  subject: string,
  headings: string[],
): Map<string, Bundle[]> =>
  Map.groupBy(
    notes,
    (b) =>
      headings.find((h) =>
        h && str(b, 'doc', 'title').startsWith(`${subject} · ${h}: `)
      ) ?? '',
  )

/** What a page calls the thing its notes are about: a component, a property
 * or a package by its name, anything else by its id. */
export let about = (io: Io, e: Bundle): string =>
  e._comp || e._prop || e._package
    ? str(e, 'doc', 'title') || io.id(e)
    : io.id(e)

/** The entities `eids` names, asked for so each is called by its name: a
 * hook, answered while the component asking is mounted. */
export let useNamed = (io: Io, eids: (string | undefined)[]): void => {
  let ids = [...new Set(eids.filter((e): e is string => !!e))].slice(0, 60)
  io.ask(ids.length ? { named: `.entity.eid=${ids.join(',')}` } : {})
}

/** The component sets `rows` are made of, asked for so each row's kind (and
 * its id) is known when it came carrying one component: a hook. */
export let useSets = (io: Io, rows: Bundle[]): void => {
  let sets = [
    ...new Set(rows.map((b) => comp(b, 'entity').archetype).filter(named)),
  ].slice(0, 60)
  io.ask(
    sets.length
      ? {
        sets: `.archetype&.entity.eid=${
          sets.join(',')
        }&.fields=archetype.tables`,
      }
      : {},
  )
}

/** The notes left on `eid`, and their authors named: a hook. */
export let useNotes = (io: Io, eid: string): Bundle[] => {
  let got = io.ask({ notes: notesOf(eid) })
  let notes = rows(got.notes)
  useNamed(io, notes.map((b) => str(b, 'created', 'by')))
  return notes
}

// Whether a note's task is seen to: it wears its `completed` or `cancelled`
// mark.
let done = (b: Bundle) => !!b.completed || !!b.cancelled

let said = (io: Io, b: Bundle) => {
  let c = comp(b, 'created')
  return h(
    Notes.Item,
    { key: b.entity.eid, mod: done(b) && 'done' },
    h(Notes.Text, {}, str(b, 'doc', 'body') || str(b, 'doc', 'title')),
    h(Notes.Who, {}, typeof c.by == 'string' ? io.name(c.by) : ''),
    h(
      Notes.When,
      {},
      h(
        'a',
        { href: io.link(b.entity.eid) },
        c.at ? io.when(String(c.at)) : io.id(b),
      ),
    ),
  )
}

/** What a heading's note line is drawn with. */
type Said = {
  io: Io
  eid: string
  subject: string
  heading: string
  notes?: Bundle[]
}

// The line a note is typed on: what is typed stays in the element until it
// is sent, and Escape closes it.
let Line = ({ io, eid, subject, heading }: Said) => {
  let field = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => field.current?.focus?.(), [])
  let close = () => io.set(put({ note: null }))
  let send = (ev: Event & { currentTarget: HTMLFormElement }) => {
    ev.preventDefault()
    let text = String(field.current?.value ?? '').trim()
    if (!text) return
    close()
    write(io, key(eid, heading), note(eid, subject, heading, text))
  }
  return h(
    Say,
    { onSubmit: send },
    h(Field, {
      elRef: field,
      name: 'note',
      'aria-label': `note on ${heading || subject}`,
      placeholder: 'a note: what is wrong here, or could be better…',
      onKeyDown: (ev: KeyboardEvent) => ev.key == 'Escape' && close(),
    }),
    h(Button, { type: 'submit' }, 'note'),
  )
}

/** The notes under a heading, and its note line while it is open. */
export let Said = (p: Said): JSX.Element | null => {
  let open = me(p.io).note == key(p.eid, p.heading)
  let notes = p.notes ?? []
  return notes.length || open
    ? h(
      Notes,
      {},
      notes.map((b) => said(p.io, b)),
      open ? h(Line, p) : null,
    )
    : null
}

/** The press that opens a heading's note line, and closes it: the head's on
 * any page where the controls take input, a part's while its page is
 * edited. */
export let NoteButton = (
  { io, eid, heading, subject }: Omit<Said, 'notes'>,
): JSX.Element | null => {
  let at = key(eid, heading)
  let open = me(io).note == at
  return io.edits && (!heading || open || edited(io, eid))
    ? h(Button, {
      type: 'button',
      mod: 'quiet',
      'aria-label': `note on ${heading || subject}`,
      'aria-pressed': open,
      onClick: () => io.set(put({ note: open ? null : at })),
    }, 'note')
    : null
}

/** What a part of a page is drawn with. */
export type PartProps = Omit<Said, 'notes'> & {
  /** its notes, by heading (`under`) */
  notes?: Map<string, Bundle[]>
  /** what its title says, when it is more than its heading */
  title?: ComponentChildren
  /** how many things it holds */
  count?: number
  /** said small beside its title */
  note?: ComponentChildren
  /** what else its title line offers */
  act?: ComponentChildren
  /** what it is about, under its title */
  sub?: ComponentChildren
  children?: ComponentChildren
}

/** A titled part of a page: its heading and what it holds, with its note
 * press and the notes left under it. */
export let Part = (p: PartProps): JSX.Element => {
  let said = refusal(p.io, key(p.eid, p.heading))
  return h(
    Section,
    { 'data-section': p.heading },
    h(
      Section.Title,
      {},
      p.title ?? p.heading,
      p.count != null ? h(Section.Count, {}, count(p.count)) : null,
      p.note ? h(Section.Note, {}, p.note) : null,
      said ? h(Section.Note, { mod: 'refused' }, said) : null,
      p.act,
      h(NoteButton, p),
    ),
    p.sub ? h(Section.Sub, {}, p.sub) : null,
    h(Said, { ...p, notes: p.notes?.get(p.heading) }),
    p.children,
  )
}
