/**
 * A property's editors, selected through a registry like any view: the inline
 * and popout layouts, an editor per property type, the faces a value wears at
 * rest, and <Prop>, the value that opens its own editor.
 *
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import {
  type Context,
  define,
  type Patch,
  type Registration,
  type Registry,
  resolve,
} from '@yaks/render'
import { type Events, render } from '@yaks/preact'
import { parse } from '@yaks/query'
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Prop as Frame, Surround } from '@yaks/ui'
import { type Bundle, host } from './host.ts'
import type { Editor } from './types.ts'
import { InlineEdit, type InlineEditProps } from './Edit.ts'
import { Overlay } from './overlay.ts'
import {
  canEdit,
  columnValue,
  eidOf,
  formatProp,
  isBody,
  wellOf,
} from './read.ts'
import { apply, write } from './write.ts'
import { pickLine, useHits } from './hits.ts'
import { label } from './suggest.ts'

// Take the keyboard on mount: <Field elRef={focus} />. The `autofocus`
// attribute cannot: the document's autofocus-processed flag fires once per
// page, so only the first editor a page ever opened would take focus. One
// module-level function, so preact sees a stable ref and calls it on mount,
// not on every render.
let focus = (n: HTMLElement | null) => n?.focus()

/** What an editor is drawn with. */
export type EditorProps = {
  eid: string
  comp: string
  prop: string
  value: unknown
  done: () => void
  onChange?: (value: unknown) => void
}
/** What the layout wrappers add: the element the control anchors on and the
 * face it may keep rendering (popout) or replace (inline). */
export type EditProps = EditorProps & {
  anchor: { current: HTMLElement | null }
  face?: ComponentChildren
  side?: 'above' | 'below'
}
type Control = (p: EditProps) => JSX.Element

// The two layout idioms, composed at registration — a third is a new
// audited wrapper here, never ad-hoc in an editor body:
//   inline(E) — the control takes the face's place at the value's own
//               metrics (the InlineEdit discipline: same font, no swap,
//               zero pixels move entering edit)
//   popout(E) — the face keeps rendering; the control anchors beside it
//               (nothing in the flow can jump, because the control was
//               never in the flow)
/** The control takes the face's place. */
export let inline = (E: (p: EditorProps) => JSX.Element): Control => (p) =>
  h(E, p)
/** The face stays; the control floats beside it. */
export let popout = (E: (p: EditorProps) => JSX.Element): Control => (p) =>
  h(
    Fragment,
    null,
    p.face,
    h(Overlay, { anchor: p.anchor, side: p.side ?? 'above' }, h(E, p)),
  )

// A caller can provide an action for a derived value (the status pip's marks).
// Every stored column otherwise uses the validated write.
let set = (p: EditorProps, v: unknown) => {
  try {
    if (p.onChange) p.onChange(v)
    else write(p.eid, p.comp, p.prop, v)
  } catch (e) {
    host().problem(e instanceof Error ? e.message : String(e), p.eid)
  }
  p.done()
}

let { Val, Hand, Pop, Tab, Row, Find, Query } = Frame

// ---- the stock editors ----

// query: the host's query field (@yaks/filter), the same completion as every
// place a query is typed. It opens on the stored query, whatever was typed
// here before. Enter commits (when the list isn't taking it), Escape
// reverts, blur commits — but empty is a VALUE here ('' = every
// task), so only no-change skips the write.
let QueryEdit = (p: EditorProps) => {
  let fields = host().fields!
  let id = `query:${p.eid}:${p.comp}.${p.prop}`
  let was = String(p.value ?? '')
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
        text != was ? set(p, text) : p.done()
      },
    }),
  )
}

// A closed set's choices, and the one it holds: an enum's members, or a
// flag's two values (a flag stored as 1 holds 'true').
let choices = (comp: string, prop: string): string[] =>
  host().vocab.prop(comp, prop)?.values ?? ['true', 'false']
let chosen = (p: EditorProps): string | undefined =>
  p.value == null
    ? undefined
    : host().vocab.prop(p.comp, p.prop)?.scalar == 'bool'
    ? String(!!p.value)
    : String(p.value)

// enum: the values ARE the control — a row of tabs above the value,
// current one marked. Small closed sets only ever need one press. A choice
// wears what the host dresses it in (a status's dot), so the set answers
// the pip that opened it in the same paint.
let EnumEdit = (p: EditorProps) => {
  let { wears } = host()
  let now = chosen(p)
  return h(
    Pop,
    null,
    choices(p.comp, p.prop).map((v) =>
      h(
        Tab,
        {
          key: v,
          type: 'button',
          mod: v == now && 'on',
          onClick: () => v == now ? p.done() : set(p, v),
        },
        wears?.(p.comp, p.prop, v),
        v,
      )
    ),
  )
}

// A well's text: free text with the graph's suggestions — the same popout
// search list the eid editor wears (one look for every picker; datalist
// was the browser's own UI, styled by nobody). The difference from a
// reference: the QUERY is a candidate — Enter commits what's typed, and
// an unheard-of value shows as the top row, so new values stay mintable.
// The 'none' row clears, as everywhere.
let WellEdit = (p: EditorProps) => {
  let [q, setQ] = useState('')
  let { vocab, values } = host()
  let all = values?.(wellOf(vocab, p.comp, p.prop)) ?? []
  let typed = q.trim()
  let hits = all
    .filter((x) => !typed || x.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 8)
  return h(
    Pop,
    { mod: 'list' },
    h(Find, {
      elRef: focus,
      placeholder: String(p.value ?? 'search…'),
      onInput: (ev: InputEvent) =>
        setQ((ev.currentTarget as HTMLInputElement).value),
      onKeyDown: (ev: KeyboardEvent) => {
        if (ev.key == 'Escape') p.done()
        if (ev.key == 'Enter') typed ? set(p, typed) : p.done()
      },
    }),
    h(Row, { mod: 'none', onClick: () => set(p, null) }, 'none'),
    typed && !all.includes(typed)
      ? h(Row, { onClick: () => set(p, typed) }, `“${typed}”`)
      : null,
    hits.map((x) => h(Row, { key: x, onClick: () => set(p, x) }, x)),
  )
}

// A reference: a server search (./hits.ts) over entities carrying the target
// component ('' = anything with a doc), narrowed by what's typed — so the
// picker offers the whole graph, not just the slice the page holds. A 'none'
// row clears the association.
let EidEdit = (p: EditorProps) => {
  let ref = host().vocab.prop(p.comp, p.prop)?.ref
  let [q, setQ] = useState('')
  let hits = useHits(pickLine(q, !ref || ref == 'entity' ? '' : ref))
  return h(
    Pop,
    { mod: 'list' },
    h(Find, {
      elRef: focus,
      placeholder: 'search…',
      onInput: (ev: InputEvent) =>
        setQ((ev.currentTarget as HTMLInputElement).value),
      onKeyDown: (ev: KeyboardEvent) => {
        if (ev.key == 'Escape') p.done()
        if (ev.key == 'Enter' && hits[0]) set(p, eidOf(hits[0]))
      },
    }),
    h(Row, { mod: 'none', onClick: () => set(p, null) }, 'none'),
    hits.map((e) =>
      h(Row, { key: eidOf(e), onClick: () => set(p, eidOf(e)) }, label(e))
    ),
  )
}

// ---- the stock faces ----

// Most types show as their own text; empty shows nothing, so Prop can
// paint the ghost. A fragment, because a face is an element.
let plain = (v: unknown) =>
  v == null || v === '' ? null : h(Fragment, null, String(v))

// A stamp in full, the way this machine's locale writes one.
let pretty = (iso: string) => new Date(iso).toLocaleString()

/** A timestamp's face: the host's words for it (relative, off its tick), the
 * full stamp on hover. */
export let TimeVal = (v: unknown): JSX.Element | null =>
  v
    ? h('span', { 'data-tip': pretty(String(v)) }, host().when(String(v)))
    : null

/** A url's face: a link OUT. Navigation is the face's own click — a press
 * leaves an anchor's clicks to the anchor, like any link face. */
export let UrlVal = (v: unknown): JSX.Element | null =>
  v
    ? h('a', { href: String(v), target: '_blank', rel: 'noopener' }, String(v))
    : null

// Every typed value (text, a number, a time, JSON) edits as the one inline
// text control, read as its type says; a body gets the multiline door.
let TextEdit = (p: EditorProps) =>
  h(Edit, {
    eid: p.eid,
    comp: p.comp,
    prop: p.prop,
    multi: isBody(host().vocab, p.comp, p.prop),
    open: true,
    onClose: p.done,
  })

let TextControl = inline(TextEdit)
let QueryLine = inline(QueryEdit)
let EnumControl = popout(EnumEdit)
let WellControl = popout(WellEdit)
let EidControl = popout(EidEdit)

// A string with a well is picked from its suggestions; any other is typed.
let StringControl: Control = (p) =>
  wellOf(host().vocab, p.comp, p.prop) ? h(WellControl, p) : h(TextControl, p)

// A query is typed in the host's query field, or as text without one.
let QueryControl: Control = (p) =>
  host().fields ? h(QueryLine, p) : h(TextControl, p)

// Without a caller-owned edit session, mount the same closed field as Prop:
// its fields own their anchors and bodies only open after a click.
// Read-only contexts never mount controls.
let ColumnControl = (
  { ctx, Control }: { ctx: Context & { e: unknown }; Control: Control },
) => {
  let { e, comp, prop } = ctx
  let editable = !ctx.readOnly &&
    (canEdit(host().vocab, String(comp), String(prop)) ||
      typeof ctx.onChange == 'function')
  if (!editable || typeof ctx.done != 'function') {
    return h(Prop, {
      eid: eidOf(e),
      comp: String(comp),
      prop: String(prop),
      editable,
    })
  }
  return h(Control, controlProps(ctx))
}

let controlProps = (
  { e, comp, prop, ...ctx }: Context & { e: unknown },
): EditProps => {
  let eid = eidOf(e)
  return {
    eid,
    comp: String(comp),
    prop: String(prop),
    value: 'value' in ctx
      ? ctx.value
      : columnValue(host().get(eid), String(comp), String(prop)),
    done: ctx.done as (() => void),
    onChange: ctx.onChange as EditorProps['onChange'],
    anchor: ctx.anchor as EditProps['anchor'] ?? { current: null },
    face: ctx.face as ComponentChildren,
    side: ctx.side as EditProps['side'],
  }
}

/** The editors, as registrations: `Inline.Edit`, the in-place text editor a
 * caller's <Edit> draws, and `Edit`, a property's control by its type. */
export let editorViews = <E = Bundle>(): Editor<E>[] => {
  let native = (
    match: string,
    Control: Control,
    show = (value: string | null) => plain(value),
  ): Editor<E> => ({
    view: 'Edit',
    match: parse(match),
    show,
    Render: (ctx) => h(ColumnControl, { ctx, Control }),
  })
  return [
    {
      view: 'Inline.Edit',
      match: parse('.prop'),
      Render: ({ e, comp, prop, ...ctx }) =>
        h(InlineEdit, {
          eid: eidOf(e),
          comp: String(comp),
          prop: String(prop),
          ...ctx,
          readOnly: !!ctx.readOnly ||
            !canEdit(host().vocab, String(comp), String(prop)),
        }),
    },
    native('.prop.type=string', StringControl),
    native('.prop.type=time', TextControl, TimeVal),
    native('.prop.type=url', TextControl, UrlVal),
    native('.prop.type=number,priority', TextControl),
    native('.prop.type=query', QueryControl),
    native('.prop.type=json,jsonb', TextControl),
    native('.prop.type=enum', EnumControl),
    native('.prop.type=boolean', EnumControl),
    native('.prop.type=ref', EidControl),
  ]
}

/** The editors as a registry of their own, for a page that has none. */
export let views: Registry<Editor<Bundle>> = define(editorViews())

/** Draw an entity's view through the page's registry: a patch the view makes
 * goes out through the host, and an error is said there. */
export let renderView = (
  eid: string,
  view: string,
  ctx: Context & Events = {},
): ComponentChildren => {
  let { get, vocab, problem, renderView: own } = host()
  if (own) return own(eid, view, ctx)
  let b: Bundle = get(eid) ?? { entity: { eid } }
  let context = {
    onPatch: (patch: Patch) => void apply(eid, patch),
    onError: (e: unknown) =>
      problem(e instanceof Error ? e.message : String(e), eid),
    ...ctx,
  }
  return render(views, b, view, vocab, context, { e: b, ...context })
}

/** The registration a property selects, if any: its editor, and the face it
 * gives a value. */
export let columnView = (
  eid: string,
  comp: string,
  prop: string,
  view = 'Edit',
): (Registration & Pick<Editor, 'show'>) | undefined => {
  let { get, vocab, columnView: own } = host()
  if (own) return own(eid, comp, prop, view)
  if (!vocab.prop(comp, prop)) return
  let b: Bundle = get(eid) ?? { entity: { eid } }
  return resolve(views, b, view, vocab, { comp, prop })
}

/** A value typed over in place, through the registry's `Inline.Edit`, so a
 * page can put its own in place of this one. */
export let Edit = (
  { eid, comp, prop, ...ctx }: InlineEditProps,
): ComponentChildren => renderView(eid, 'Inline.Edit', { ...ctx, comp, prop })

/** A property's editor opened by its caller, anchored where it says. The
 * status pip opens one: a derived enum with its own mark action, but the
 * same picker and vocabulary as every other enum. */
export let ColumnEdit = (
  { eid, comp, prop, ...ctx }: Omit<EditProps, 'value'> & { value?: unknown },
): ComponentChildren =>
  renderView(eid, 'Edit', {
    ...ctx,
    comp,
    prop,
    onPatch: (patch: Patch) => {
      void apply(eid, patch)
      ctx.done()
    },
  })

// ---- the door ----

/** What a <Prop> is drawn with. */
export type PropProps = {
  eid: string
  comp: string
  prop: string
  editable?: boolean
  /** the ghost label when empty */
  name?: string
  /** paint a custom face (a badge, a chip, a link) from the formatted text
   * and the value; the registry still owns the editing */
  show?: (face: string | null, value: unknown) => JSX.Element | null
  /** a LINK face gets its own edit press, so navigation stays the link's */
  handle?: boolean
}

/**
 * <Prop eid comp prop editable/> — the <Entity> of values: the registry
 * supplies the type's face (a reference reads as what it is called, a time as
 * words) and, editable, the control a press opens — the entry's wrapper owns
 * the layout, Prop only hands it the anchor and the face.
 */
export let Prop = (
  { eid, comp, prop, editable, name, show: paint, handle }: PropProps,
): JSX.Element => {
  let [editing, setEditing] = useState(false)
  // What the popout control anchors on — the value or its handle.
  let anchor = useRef<HTMLElement>(null)
  let { vocab, get, name: called } = host()
  let value = columnValue(get(eid), comp, prop)
  let bool = vocab.prop(comp, prop)?.scalar == 'bool'
  let faceValue = formatProp(vocab, comp, prop, value, called)
  let entry = columnView(eid, comp, prop)
  let editor = editable && canEdit(vocab, comp, prop) ? entry : undefined
  // The face, through the registry; plain is the net under a prop no
  // entry claims (one outside the vocabulary).
  let face = paint
    ? paint(faceValue, value)
    : entry?.show
    ? entry.show(faceValue)
    : plain(faceValue)
  let done = () => setEditing(false)
  let ep: EditorProps = { eid, comp, prop, value, done }
  // A flag never enters an edit mode: the value IS the toggle. For popout
  // editors the same press closes an open control — the value is the
  // press target both ways.
  let press = !editor
    ? undefined
    : bool
    ? () => set(ep, value ? 0 : 1)
    : () => setEditing((was) => !was)
  // The press, resolved by the link stack: a click that lands on a link
  // INSIDE the face belongs to that link, and inside a linked surround
  // the press demotes the way nested links do — an edit-click never
  // rides the anchor around it.
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
  return h(
    Frame,
    { mod: editor && 'live' },
    editing && editor ? h(ColumnEdit, { ...ep, anchor, face: shown }) : shown,
  )
}
