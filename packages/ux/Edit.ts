/**
 * `Edit`: a property's value, changed where it stands. It is controlled by a
 * bundle and emits a bundle of the same shape, the way `<input value
 * onChange>` does: handed `{entity: {eid}, doc: {title: 'Draft'}}`, it emits
 * `{entity: {eid}, doc: {title: 'Ship it'}}`. Presses and typing are how it
 * gets there, never its interface. Its own state is the `Edit` component in
 * the page's graph (./live.ts), so whoever owns it can read it and open it.
 *
 * Its face and its control are selected by the property's type through a
 * registry (`views`): a type's face at rest (a reference as what it is
 * called, a time in words), and pressed, a control that is either typed over
 * in place (`Edit.Text`) or floats beside the face (a closed set's choices, a
 * reference's search of the graph). `Edit.Control` is the control alone,
 * anchored where its caller says.
 *
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import { define, type Registry, resolve } from '@yaks/render'
import type { ComponentRenderer } from '@yaks/preact'
import { parse } from '@yaks/query'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'
import { Prop as Frame, Surround } from '@yaks/ui'
import { type Bundle, type Host, useHost } from './host.ts'
import { emit, type OnChange } from './emit.ts'
import { type Editing, useEdit } from './live.ts'
import { Text } from './Text.ts'
import { canEdit, formatProp, isBody, wellOf } from './read.ts'
import { valueOf } from './state.ts'
import { pickLine, useHits } from './hits.ts'
import { label } from './suggest.ts'

// Take the keyboard on mount: <Find elRef={focus} />. The `autofocus`
// attribute cannot: the document's autofocus-processed flag fires once per
// page, so only the first editor a page ever opened would take focus. One
// module-level function, so preact sees a stable ref and calls it on mount,
// not on every render.
let focus = (n: HTMLElement | null) => n?.focus()

/** What a control is drawn with: the value it changes, where it emits, its
 * state, the element it anchors on, and the face it may keep painting
 * (popout) or take the place of (inline). */
export type ControlProps = {
  e: Bundle
  comp: string
  prop: string
  onChange?: OnChange
  edit: Editing
  anchor: { current: HTMLElement | null }
  face?: ComponentChildren
  side?: 'above' | 'below'
}
type Control = (p: ControlProps) => JSX.Element

/** One editor registration: a control, and the face it gives a value at
 * rest, from its text as `formatProp` says it. */
export type Editor = ComponentRenderer<Bundle> & {
  show?: (face: string | null) => JSX.Element | null
}

// The two layout idioms, composed at registration; a third is a new wrapper
// here, never ad hoc in an editor body:
//   inline(E): the control takes the face's place at the value's own metrics,
//              so nothing moves entering it
//   popout(E): the face keeps painting; the control floats beside it, so
//              nothing in the flow can jump
let inline = (E: Control): Control => (p) => h(E, p)
let popout = (E: Control): Control => (p) => {
  let { Float } = useHost()
  let control = h(E, p)
  return h(
    Fragment,
    null,
    p.face,
    Float
      ? h(Float, { anchor: p.anchor, side: p.side ?? 'above' }, control)
      : control,
  )
}

// A choice made: emitted, and the control closed.
let choose = (host: Host, p: ControlProps, v: unknown) => {
  emit(host, p.onChange, p.e, p.comp, p.prop, v)
  p.edit.end()
}

let { Val, Hand, Pop, Tab, Row, Find, Query } = Frame

// ---- the controls ----

// Every typed value (text, a number, a time, JSON) is typed over in place,
// read as its type says; a body on many lines.
let TextEdit = (p: ControlProps) =>
  h(Text, {
    e: p.e,
    comp: p.comp,
    prop: p.prop,
    onChange: p.onChange,
    at: p.edit.at,
    multi: isBody(useHost().vocab, p.comp, p.prop),
  })

// A query: the host's query field (@yaks/filter), the same completion as
// every place a query is typed. It opens on the stored query, whatever was
// typed there before. Enter or leaving emits it, Escape puts it back; empty
// is a value here ('' = every task), so only no change emits nothing.
let QueryEdit = (p: ControlProps) => {
  let host = useHost()
  let fields = host.fields!
  let id = `query:${p.e.entity.eid}:${p.comp}.${p.prop}`
  let was = String(valueOf(p.e, p.comp, p.prop) ?? '')
  useLayoutEffect(() => fields.set(id, was), [id])
  return h(
    Query,
    null,
    h(fields.Filter, {
      id,
      initial: was,
      focus: true,
      onKey: (ev: KeyboardEvent) => {
        let el = ev.currentTarget as HTMLInputElement
        if (ev.key == 'Enter') el.blur()
        else if (ev.key == 'Escape') {
          fields.set(id, was)
          el.value = was // the blur below reads it before the repaint
          el.blur()
        }
      },
      onBlur: (ev: FocusEvent) => {
        let text = (ev.currentTarget as HTMLInputElement).value.trim()
        text != was ? choose(host, p, text) : p.edit.end()
      },
    }),
  )
}

// A closed set's choices, and the one it holds: an enum's members, or a
// flag's two values (a flag stored as 1 holds 'true').
let choices = (host: Host, comp: string, prop: string): string[] =>
  host.vocab.prop(comp, prop)?.values ?? ['true', 'false']
let chosen = (host: Host, p: ControlProps): string | undefined => {
  let v = valueOf(p.e, p.comp, p.prop)
  return v == null
    ? undefined
    : host.vocab.prop(p.comp, p.prop)?.scalar == 'bool'
    ? String(!!v)
    : String(v)
}

// A closed set: the values are the control, a row of tabs beside the value,
// the one held marked; one press. A choice wears what the host dresses it in
// (a status's dot), so the set answers the pip that opened it.
let EnumEdit = (p: ControlProps) => {
  let host = useHost()
  let now = chosen(host, p)
  return h(
    Pop,
    null,
    choices(host, p.comp, p.prop).map((v) =>
      h(
        Tab,
        {
          key: v,
          type: 'button',
          mod: v == now && 'on',
          onClick: () => v == now ? p.edit.end() : choose(host, p, v),
        },
        host.wears?.(p.comp, p.prop, v),
        v,
      )
    ),
  )
}

// A search field over a picker's rows: what is typed is the `Edit`'s own
// `query`, so a remount keeps it.
let Search = (
  { p, place, enter }: {
    p: ControlProps
    place: string
    enter: (typed: string) => void
  },
) =>
  h(Find, {
    elRef: focus,
    placeholder: place,
    value: p.edit.row?.query ?? '',
    onInput: (ev: InputEvent) =>
      p.edit.search((ev.currentTarget as HTMLInputElement).value),
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key == 'Escape') p.edit.end()
      if (ev.key == 'Enter') enter((p.edit.row?.query ?? '').trim())
    },
  })

// A well's text: free text with the values seen so far, in the same popout
// list a reference wears. What is typed is a candidate too: Enter emits it,
// and one never seen shows as the top row, so a new value can be made. The
// 'none' row clears.
let WellEdit = (p: ControlProps) => {
  let host = useHost()
  let all = host.values?.(wellOf(host.vocab, p.comp, p.prop)) ?? []
  let typed = (p.edit.row?.query ?? '').trim()
  let hits = all
    .filter((x) => !typed || x.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 8)
  let pick = (v: unknown) => () => choose(host, p, v)
  return h(
    Pop,
    { mod: 'list' },
    h(Search, {
      p,
      place: String(valueOf(p.e, p.comp, p.prop) ?? 'search…'),
      enter: (t) => t ? choose(host, p, t) : p.edit.end(),
    }),
    h(Row, { mod: 'none', onClick: pick(null) }, 'none'),
    typed && !all.includes(typed)
      ? h(Row, { onClick: pick(typed) }, `“${typed}”`)
      : null,
    hits.map((x) => h(Row, { key: x, onClick: pick(x) }, x)),
  )
}

// A reference: the host's server search (./hits.ts) over entities carrying
// the target component ('' = anything with a doc), narrowed by what is typed,
// so the picker offers the whole graph, not the slice the page holds. A
// 'none' row clears it.
let EidEdit = (p: ControlProps) => {
  let host = useHost()
  let ref = host.vocab.prop(p.comp, p.prop)?.ref
  let q = p.edit.row?.query ?? ''
  let hits = useHits(
    pickLine(q, !ref || ref == 'entity' ? '' : ref),
    8,
    host.find,
  )
  let pick = (v: unknown) => () => choose(host, p, v)
  return h(
    Pop,
    { mod: 'list' },
    h(Search, {
      p,
      place: 'search…',
      enter: () => hits[0] && choose(host, p, hits[0].entity.eid),
    }),
    h(Row, { mod: 'none', onClick: pick(null) }, 'none'),
    hits.map((b) =>
      h(Row, { key: b.entity.eid, onClick: pick(b.entity.eid) }, label(host, b))
    ),
  )
}

// ---- the faces ----

// Most types show as their own text; empty shows nothing, so `Edit` can
// paint the ghost. A fragment, because a face is an element.
let plain = (v: unknown) =>
  v == null || v === '' ? null : h(Fragment, null, String(v))

// A stamp in full, the way this machine's locale writes one.
let pretty = (iso: string) => new Date(iso).toLocaleString()

/** A timestamp's face: the host's words for it, the full stamp on hover. */
export let TimeVal = ({ v }: { v: string }): JSX.Element =>
  h('span', { 'data-tip': pretty(v) }, useHost().when(v))

/** A url's face: a link out. Following it is the face's own click. */
export let UrlVal = (v: unknown): JSX.Element | null =>
  v
    ? h('a', { href: String(v), target: '_blank', rel: 'noopener' }, String(v))
    : null

let TextControl = inline(TextEdit)
let QueryLine = inline(QueryEdit)
let EnumControl = popout(EnumEdit)
let WellControl = popout(WellEdit)
let EidControl = popout(EidEdit)

// A string with a well is picked from its suggestions; any other is typed.
let StringControl: Control = (p) =>
  wellOf(useHost().vocab, p.comp, p.prop)
    ? h(WellControl, p)
    : h(TextControl, p)

// A query is typed in the host's query field, or as text without one.
let QueryControl: Control = (p) =>
  useHost().fields ? h(QueryLine, p) : h(TextControl, p)

/** The editors, as registrations: `Edit`, a property's control by its type
 * (`.prop.type=enum`), drawn with its `ControlProps`. */
export let editorViews = (): Editor[] => {
  let native = (
    match: string,
    C: Control,
    show = (value: string | null) => plain(value),
  ): Editor => ({
    view: 'Edit',
    match: parse(match),
    show,
    Render: (ctx) => h(C, ctx as unknown as ControlProps),
  })
  return [
    native('.prop.type=string', StringControl),
    native(
      '.prop.type=time',
      TextControl,
      (v): JSX.Element | null => v ? h(TimeVal, { v }) : null,
    ),
    native('.prop.type=url', TextControl, UrlVal),
    native('.prop.type=number,priority', TextControl),
    native('.prop.type=query', QueryControl),
    native('.prop.type=json,jsonb', TextControl),
    native('.prop.type=enum', EnumControl),
    native('.prop.type=boolean', EnumControl),
    native('.prop.type=ref', EidControl),
  ]
}

/** The editors as a registry: the `./views` facet. */
export let views: Registry<Editor> = define(editorViews())

// The registration a property selects: its control, and its face.
let entryOf = (host: Host, e: Bundle, comp: string, prop: string) =>
  host.vocab.prop(comp, prop)
    ? resolve(views, e, 'Edit', host.vocab, { comp, prop }) as
      | Editor
      | undefined
    : undefined

/** What an `Edit.Control` is drawn with. */
export type ControlOwnProps = {
  e: Bundle
  comp: string
  prop: string
  onChange?: OnChange
  at?: string
  anchor: { current: HTMLElement | null }
  side?: 'above' | 'below'
}

/** A property's control alone, anchored where its caller says, drawn while
 * its `Edit` state is open. The status pip opens one: a derived enum its
 * caller turns into marks, with the same picker as every other enum. */
let Control = (p: ControlOwnProps): ComponentChildren => {
  let host = useHost()
  let edit = useEdit(p.e.entity.eid, p.comp, p.prop, p.at)
  let entry = entryOf(host, p.e, p.comp, p.prop)
  if (!edit.row?.open || !entry) return null
  return h(
    entry.Render,
    { ...p, edit } as unknown as ControlProps & { e: Bundle },
  )
}

/** What an `Edit` is drawn with. */
export type EditProps = {
  /** what controls it: the value is `e[comp][prop]` */
  e: Bundle
  comp: string
  prop: string
  /** where what it emits goes (default: the host's `write`) */
  onChange?: OnChange
  /** its state's eid, when its caller names it (default: derived from the
   * owner above and the value, host.ts `Ux`) */
  at?: string
  /** a press opens its control, where a client may write the value */
  editable?: boolean
  /** the ghost label when empty */
  name?: string
  /** paint a custom face (a badge, a chip, a link) from the formatted text
   * and the value; the registry still selects the control */
  show?: (face: string | null, value: unknown) => JSX.Element | null
  /** a face that is a link gets a separate handle to press, so following
   * the link stays the link's */
  handle?: boolean
}

/**
 * `<Edit e comp prop editable/>`: the registry supplies the type's face and,
 * editable, the control a press opens; the control's wrapper owns the layout,
 * `Edit` only hands it the anchor and the face. A flag is its own toggle.
 */
let EditValue = (
  { e, comp, prop, onChange, at, editable, name, show: paint, handle }:
    EditProps,
): JSX.Element => {
  let host = useHost()
  let { vocab, name: called } = host
  let edit = useEdit(e.entity.eid, comp, prop, at)
  // What the popout control anchors on: the value or its handle.
  let anchor = useRef<HTMLElement>(null)
  let value = valueOf(e, comp, prop)
  let bool = vocab.prop(comp, prop)?.scalar == 'bool'
  let faceValue = formatProp(vocab, comp, prop, value, called)
  let entry = entryOf(host, e, comp, prop)
  let editor = editable && canEdit(vocab, comp, prop) ? entry : undefined
  // The face, through the registry; plain is the net under a property no
  // entry claims (one outside the vocabulary).
  let face = paint
    ? paint(faceValue, value)
    : entry?.show
    ? entry.show(faceValue)
    : plain(faceValue)
  let press = !editor
    ? undefined
    : bool
    ? () => emit(host, onChange, e, comp, prop, value ? 0 : 1)
    : () => edit.row?.open ? edit.end() : edit.begin()
  // A click that lands on a link inside the face belongs to that link, and
  // inside a linked surround the press demotes the way nested links do: an
  // edit press never rides the anchor around it.
  let outer = useContext(Surround).href
  let open = press && ((ev: MouseEvent) => {
    let hit = (ev.target as Element).closest?.('a, [role=link]')
    if (hit && anchor.current?.contains(hit)) return
    if (outer) {
      ev.preventDefault()
      ev.stopPropagation()
    }
    press()
  })
  let shown = h(
    Fragment,
    null,
    face || !handle
      ? h(Val, {
        elRef: handle ? undefined : anchor,
        mod: !face && 'nil',
        onClick: handle ? undefined : open,
      }, face || (paint && editor ? `+ ${name ?? prop}` : '—'))
      : null,
    handle && editor
      ? h(Hand, {
        elRef: anchor,
        mod: !face && 'empty',
        type: 'button',
        'aria-label': `change ${name ?? prop}`,
        onClick: press,
      }, face ? '▾' : `+ ${name ?? prop}`)
      : null,
  )
  let control = edit.row?.open && editor
    ? h(
      editor.Render,
      {
        e,
        comp,
        prop,
        onChange,
        edit,
        anchor,
        face: shown,
      } as unknown as ControlProps & { e: Bundle },
    )
    : null
  return h(Frame, { mod: editor && 'live' }, control ?? shown)
}

/** A value changed where it stands (`Edit`), typed over in place
 * (`Edit.Text`), or its control alone (`Edit.Control`). */
export let Edit: typeof EditValue & {
  Text: typeof Text
  Control: typeof Control
} = Object.assign(EditValue, { Text, Control })
