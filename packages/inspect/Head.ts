/**
 * The top of an entity's page (`Inspect.Head`): what it is called, its id
 * where that says more, and its kind; under them, in the head's `Sub`, what
 * the page that drew it says about it (a belief's subject, a component's
 * description); and last, one quiet line, where it came from: who made it and
 * when, what built it, when it last changed (`Provenance`).
 *
 * A page is read until the reader asks to edit it. Where the host's controls
 * take input the head offers a note on the whole thing and `edit`; editing, it
 * also offers a component to add and the entity's delete, and every part of
 * the page shows its controls (./state.ts `edited`).
 *
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { about, NoteButton, Said, useNamed } from './notes.ts'
import { comp, comps, str, writable } from './read.ts'
import { mention } from './value.ts'
import { edited, me, put, refusal, write } from './state.ts'

/** What a head is drawn with besides its entity: what the page says about
 * it, under its name, and the notes left on it as a whole. */
export type HeadCtx = {
  sub?: ComponentChildren
  notes?: Bundle[]
  /** what a note on it calls it (its id, or a component's name) */
  subject?: string
}

// The components a client may add that the entity lacks.
let addable = (io: Io, e: Bundle): string[] => {
  let has = new Set(comps(e).map(([n]) => n))
  return io.vocab.comps.filter((n) => !has.has(n) && writable(io, n))
}

let Add = ({ e, io }: { e: Bundle; io: Io }) =>
  h(
    'select',
    {
      class: 'Edit Edit-fit',
      'aria-label': 'add a component',
      value: '',
      onChange: (ev: Event & { currentTarget: HTMLSelectElement }) => {
        let name = ev.currentTarget.value
        let eid = e.entity.eid
        if (name) write(io, eid, [{ entity: { eid }, [name]: {} }])
      },
    },
    h('option', { value: '' }, '+ component'),
    addable(io, e).map((n) => h('option', { key: n, value: n }, n)),
  )

// Deleting takes two presses: the first arms it, in the page's own graph.
let Delete = ({ e, io }: { e: Bundle; io: Io }) => {
  let eid = e.entity.eid
  let press = (mod: string | string[], onClick: () => void, said: string) =>
    h(ui.Button, { type: 'button', mod, onClick }, said)
  return me(io).armed == eid
    ? h(
      'span',
      {},
      press('danger', () => {
        io.set(put({ armed: null }))
        write(io, eid, [{ entity: { eid }, $delete: true }])
      }, `delete ${io.id(e)}`),
      press('quiet', () => io.set(put({ armed: null })), 'keep'),
    )
    : press(['quiet', 'danger'], () => io.set(put({ armed: eid })), 'delete')
}

// The press that turns a page's controls on, and off again.
let Edit = ({ io, eid }: { io: Io; eid: string }) => {
  let on = edited(io, eid)
  return h(ui.Button, {
    type: 'button',
    mod: 'quiet',
    'aria-pressed': on,
    onClick: () => io.set(put({ editing: on ? null : eid, armed: null })),
  }, on ? 'done' : 'edit')
}

/** The file a path ends in: `/a/b/c.jsonl` reads `c.jsonl`. */
let file = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/**
 * Where an entity came from, in one quiet line: what built it (a builder's
 * output, @yaks/builders), who made it and when, and through which session;
 * when it last changed, and by whom where that was somebody else; when it was
 * checked; the file a transcript entry was read from. Each entity named, and
 * linked.
 */
export let Provenance = ({ e, io }: { e: Bundle; io: Io }): JSX.Element => {
  let made = comp(e, 'created')
  let changed = comp(e, 'updated')
  let built = comp(e, 'built')
  let build = str(e, 'built', 'build')
  let at = (v: unknown) => typeof v == 'string' && v ? io.when(v) : ''
  let who = (v: unknown) => typeof v == 'string' && v ? v : ''
  // A build is called by the builder that made it: two hops, the second
  // once the first is in.
  let builder = str(io.get(build), 'build', 'builder')
  let by = who(made.by)
  let via = who(made.via) != by ? who(made.via) : ''
  let other = who(changed.by) != by ? who(changed.by) : ''
  useNamed(io, [by, via, other, build, builder, str(e, 'built', 'call')])
  let parts: ComponentChildren[] = [
    build
      ? h(
        'span',
        { key: 'built' },
        'built by ',
        h(
          'a',
          { href: io.link(build) },
          builder ? io.name(builder) : 'a build',
        ),
        built.slot ? ` (${built.slot})` : '',
        built.current === false ? ', since gone stale' : '',
      )
      : null,
    made.at || by
      ? h(
        'span',
        { key: 'made' },
        build ? '' : 'made ',
        at(made.at),
        by && !build ? [' by ', mention(io, by)] : '',
        via ? [' via ', mention(io, via)] : '',
      )
      : null,
    changed.at && changed.at != made.at
      ? h(
        'span',
        { key: 'changed' },
        'changed ',
        at(changed.at),
        other ? [' by ', mention(io, other)] : '',
      )
      : null,
    e.verified
      ? h('span', { key: 'checked' }, 'checked ', at(comp(e, 'verified').at))
      : null,
    built.call
      ? h('a', { key: 'call', href: io.link(String(built.call)) }, 'the call')
      : null,
    e.imported
      ? h(
        'span',
        { key: 'from' },
        'read from ',
        file(str(e, 'imported', 'source')),
        comp(e, 'imported').line != null ? `:${comp(e, 'imported').line}` : '',
      )
      : null,
  ]
  return h(ui.Head.Facts, {}, ...parts.filter(Boolean))
}

/** An entity's head. */
export let EntityHead = ({ e, io, ctx }: Props): JSX.Element => {
  let eid = e.entity.eid
  let { sub, notes, subject = about(io, e) } = ctx as HeadCtx
  let name = io.name(eid)
  let id = io.id(e)
  let said = refusal(io, eid)
  let editing = edited(io, eid)
  return h(
    Fragment,
    null,
    h(
      ui.Head,
      {},
      h(
        ui.Head.Title,
        {},
        name,
        name != id ? h(ui.Head.Id, {}, id) : null,
        h(ui.Head.Kind, {}, io.kind(e)),
        h(NoteButton, { io, eid, heading: '', subject }),
        io.edits ? h(Edit, { io, eid }) : null,
        ...editing ? [h(Add, { e, io }), h(Delete, { e, io })] : [],
      ),
      sub ? h(ui.Head.Sub, {}, sub) : null,
      said ? h(ui.Head.Sub, { mod: 'refused' }, said) : null,
      h(Provenance, { e, io }),
    ),
    h(Said, { io, eid, subject, heading: '', notes }),
  )
}

/** The head of any entity's page. */
export let headViews: View[] = [
  { view: 'Inspect.Head', match: true, Render: EntityHead },
]
