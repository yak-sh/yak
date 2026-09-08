import { type ComponentChildren, type JSX } from 'preact'
import { type Context } from '@yaks/render'
import { parse } from '@yaks/query'
import { useContext, useRef, useState } from 'preact/hooks'
import { formatProp, propAt } from '../props.ts'
import { type Ent, idOf } from '../types.ts'
import { cache, domains, ent, problem } from '../live.ts'
import { ago, block, focus, pretty, Surround } from './ui.tsx'
import { Dot } from './Dot.tsx'
import { Edit, InlineEdit } from './Edit.tsx'
import {
  applyPatch,
  canEdit,
  columnValue,
  columnView,
  type Renderer,
  renderView,
  vocab,
  writeColumn,
} from './registry.ts'
import { Overlay } from './overlay.tsx'
import { useComplete } from './Complete.tsx'
import { pickLine, useHits } from './hits.ts'
import * as suggest from './suggest.ts'

// Native Edit overlays: the same registry selects entity and column views.
// These shared controls own the browser's inline and popout presentation.

export type EditorProps = {
  eid: string
  comp: string
  prop: string
  value: unknown
  done: () => void
  onChange?: (value: unknown) => void
}
// What the layout wrappers add: the element the control anchors on and
// the face it may keep rendering (popout) or replace (inline).
export type EditProps = EditorProps & {
  anchor: { current: HTMLElement | null }
  face?: ComponentChildren
  side?: 'above' | 'below'
}
// The two layout idioms, composed at registration — a third is a new
// audited wrapper here, never ad-hoc in an editor body:
//   inline(E) — the control takes the face's place at the value's own
//               metrics (the Edit.tsx discipline: same font, no swap,
//               zero pixels move entering edit)
//   popout(E) — the face keeps rendering; the control anchors beside it
//               (nothing in the flow can jump, because the control was
//               never in the flow)
export let inline = (E: (p: EditorProps) => JSX.Element) => (p: EditProps) => (
  <E {...p} />
)
export let popout = (E: (p: EditorProps) => JSX.Element) => (p: EditProps) => (
  <>
    {p.face}
    <Overlay anchor={p.anchor} side={p.side ?? 'above'}>
      <E {...p} />
    </Overlay>
  </>
)

// A caller can provide an action for a derived value (the status pip's marks).
// Every stored column otherwise uses the package's validated patch action.
let set = (p: EditorProps, v: unknown) => {
  try {
    if (p.onChange) p.onChange(v)
    else writeColumn(p.eid, p.comp, p.prop, v)
  } catch (e) {
    problem.value = e instanceof Error ? e.message : String(e)
  }
  p.done()
}

let Frame = block('span', 'Prop', {
  Val: 'span',
  Hand: 'button',
  Pop: 'span',
  Tab: 'button',
  Row: 'span',
  Find: 'input',
  Num: 'input',
  Query: 'span',
})
let { Val, Hand, Pop, Tab, Row, Find, Num, Query } = Frame

// ---- the stock editors ----

// number: a parsing text input at the value's metrics — never
// type=number (spinners are a layout event). Empty or NaN reverts.
let NumEdit = ({ ...p }: EditorProps) => (
  <Num
    elRef={focus}
    value={String(p.value ?? '')}
    onKeyDown={(ev: KeyboardEvent) => {
      let t = ev.currentTarget as HTMLInputElement
      if (ev.key == 'Enter') t.blur()
      else if (ev.key == 'Escape') {
        t.value = String(p.value ?? '')
        t.blur()
      }
    }}
    onBlur={(ev: FocusEvent) => {
      let text = (ev.currentTarget as HTMLInputElement).value.trim()
      text != String(p.value ?? '') ? set(p, text) : p.done()
    }}
  />
)

// query: a filter line that knows its own vocabulary — the palette's
// completion dropdown under a plain input (Complete.tsx, same grammar
// teacher everywhere). Controlled, because the dropdown rerenders while
// you type; Enter commits (when the dropdown isn't eating it), Escape
// reverts, blur commits like NumEdit — but empty is a VALUE here ('' =
// every task), so only no-change skips the write.
let QueryEdit = ({ ...p }: EditorProps) => {
  let [v, setV] = useState(String(p.value ?? ''))
  let c = useComplete()
  return (
    <Query>
      <Find
        elRef={focus}
        value={v}
        onInput={(ev: InputEvent) => {
          let el = ev.currentTarget as HTMLInputElement
          setV(el.value)
          c.track(el)
        }}
        onKeyDown={(ev: KeyboardEvent) => {
          if (c.key(ev)) return
          let el = ev.currentTarget as HTMLInputElement
          if (ev.key == 'Enter') el.blur()
          else if (ev.key == 'Escape') {
            setV(String(p.value ?? ''))
            el.value = String(p.value ?? '')
            el.blur()
          }
        }}
        onBlur={(ev: FocusEvent) => {
          let text = (ev.currentTarget as HTMLInputElement).value.trim()
          text != String(p.value ?? '') ? set(p, text) : p.done()
        }}
      />
      {c.list}
    </Query>
  )
}

// enum: the values ARE the control — a row of tabs above the value,
// current one marked. Small closed sets only ever need one press. The
// status set answers the pip that opened it in the same paint: each
// choice wears its own dot.
let EnumEdit = ({ ...p }: EditorProps) => {
  let values = vocab.column(p.comp, p.prop)!.values!
  return (
    <Pop>
      {values.map((v) => (
        <Tab
          key={v}
          type='button'
          mod={v == p.value && 'on'}
          onClick={() => v == p.value ? p.done() : set(p, v)}
        >
          {p.comp == 'task' && p.prop == 'status' && <Dot status={v} />}
          {v}
        </Tab>
      ))}
    </Pop>
  )
}

// A vocabulary declaration names its suggestion source; plugins can replace
// that source while the column still selects its control through the registry.
let wells: Record<string, () => string[]> = { domains: () => domains.value }
export let defineWells = (sources: typeof wells) =>
  Object.assign(wells, sources)

// {text: well}: free text with the graph's suggestions — the same popout
// search list the eid editor wears (one look for every picker; datalist
// was the browser's own UI, styled by nobody). The difference from a
// reference: the QUERY is a candidate — Enter commits what's typed, and
// an unheard-of value shows as the top row, so new domains stay mintable.
// The 'none' row clears, as everywhere.
let WellEdit = ({ ...p }: EditorProps) => {
  let [q, setQ] = useState('')
  let type = propAt(p.comp, p.prop)?.type
  let name = typeof type == 'object' && 'text' in type ? type.text : ''
  let all = wells[name]?.() ?? []
  let typed = q.trim()
  let hits = all
    .filter((x) => !typed || x.toLowerCase().includes(typed.toLowerCase()))
    .slice(0, 8)
  return (
    <Pop mod='list'>
      <Find
        elRef={focus}
        placeholder={String(p.value ?? 'search…')}
        onInput={(ev: InputEvent) =>
          setQ((ev.currentTarget as HTMLInputElement).value)}
        onKeyDown={(ev: KeyboardEvent) => {
          if (ev.key == 'Escape') p.done()
          if (ev.key == 'Enter') typed ? set(p, typed) : p.done()
        }}
      />
      <Row mod='none' onClick={() => set(p, null)}>none</Row>
      {typed && !all.includes(typed) && (
        <Row onClick={() => set(p, typed)}>“{typed}”</Row>
      )}
      {hits.map((x) => <Row key={x} onClick={() => set(p, x)}>{x}</Row>)}
    </Pop>
  )
}

// {eid: target}: a server search (hits.ts) over entities carrying the target
// component ('' = anything with a doc), narrowed by what's typed — so the
// picker offers the whole graph, not just the slice the cache holds. A 'none'
// row clears the association.
let EidEdit = ({ ...p }: EditorProps) => {
  let target = vocab.column(p.comp, p.prop)!.ref!
  let [q, setQ] = useState('')
  let hits = useHits(pickLine(q, target))
  return (
    <Pop mod='list'>
      <Find
        elRef={focus}
        placeholder='search…'
        onInput={(ev: InputEvent) =>
          setQ((ev.currentTarget as HTMLInputElement).value)}
        onKeyDown={(ev: KeyboardEvent) => {
          if (ev.key == 'Escape') p.done()
          if (ev.key == 'Enter' && hits[0]) set(p, hits[0].eid)
        }}
      />
      <Row mod='none' onClick={() => set(p, null)}>none</Row>
      {hits.map((e) => (
        <Row key={e.eid} onClick={() => set(p, e.eid)}>
          {suggest.label(e)}
        </Row>
      ))}
    </Pop>
  )
}
// ---- the stock faces ----

// Most types show as their own text; empty shows nothing, so Prop can
// paint the ghost. A fragment, because a face is an element.
let plain = (v: unknown) => v == null || v === '' ? null : <>{String(v)}</>

// Association text is already described by formatProp; the registry only
// supplies its wrapper.
let titled = (v: unknown) => plain(v)

// A timestamp reads as relative words off the minute tick, full stamp on
// hover — the Stamp idiom (ui.tsx ago/pretty), one value at a time.
// Exported for <Val>: a bare Date wears the same face.
export let TimeVal = (v: unknown) =>
  v ? <span data-tip={pretty(String(v))}>{ago(String(v))}</span> : null

// A url reads as a link OUT. Navigation is the face's own click — the
// press leaves an anchor's clicks to the anchor, like any link face.
export let UrlVal = (v: unknown) =>
  v ? <a href={String(v)} target='_blank' rel='noopener'>{String(v)}</a> : null

// Every text-shaped type edits as the one inline text control; body gets
// the multiline door.
let TextEdit = (p: EditorProps) => (
  <Edit
    eid={p.eid}
    comp={p.comp}
    prop={p.prop}
    multi={propAt(p.comp, p.prop)?.type == 'body'}
    open
    onClose={p.done}
  />
)

// Registration only captures component bindings in closures: registry.ts can
// curate the list while the Edit/registry import cycle is still initializing.
export function editorViews(): Renderer[] {
  let native = (
    match: string,
    Control: (p: EditProps) => JSX.Element,
    show = (value: unknown) => plain(value),
  ): Renderer => ({
    view: 'Edit',
    match: parse(match),
    show,
    Render: (ctx) => <ColumnControl ctx={ctx} Control={Control} />,
  })
  return [
    {
      view: 'Inline.Edit',
      match: parse('.column'),
      Render: ({ e, comp, col, ...ctx }) => (
        <InlineEdit
          eid={e.eid}
          comp={String(comp)}
          prop={String(col)}
          {...ctx}
          readOnly={!!ctx.readOnly || !canEdit(String(comp), String(col))}
        />
      ),
    },
    native(
      '.column.comp=task .column.col=domain',
      (p) => <WellControl {...p} />,
    ),
    native('.column.type=string', (p) => <TextControl {...p} />),
    native(
      '.column.type=time',
      (p) => <TextControl {...p} />,
      (value) => TimeVal(value),
    ),
    native(
      '.column.type=url',
      (p) => <TextControl {...p} />,
      (value) => UrlVal(value),
    ),
    native('.column.type=number', (p) => <NumControl {...p} />),
    native('.column.type=priority', (p) => <NumControl {...p} />),
    native('.column.type=query', (p) => <QueryControl {...p} />),
    native('.column.type=enum', (p) => <EnumControl {...p} />),
    native(
      '.column.type=ref',
      (p) => <EidControl {...p} />,
      (value) => titled(value),
    ),
  ]
}
let TextControl = inline(TextEdit)
let NumControl = inline(NumEdit)
let QueryControl = inline(QueryEdit)
let EnumControl = popout(EnumEdit)
let WellControl = popout(WellEdit)
let EidControl = popout(EidEdit)

// Without a caller-owned edit session, mount the same closed field as Prop.
// This is the package Props layout's door: its fields own their anchors and
// bodies only open after a click. Read-only contexts never mount controls.
let ColumnControl = (
  { ctx, Control }: {
    ctx: Context & { e: Ent }
    Control: (p: EditProps) => JSX.Element
  },
) => {
  let { e, comp, col } = ctx
  let editable = !ctx.readOnly &&
    (canEdit(String(comp), String(col)) || typeof ctx.onChange == 'function')
  if (!editable || typeof ctx.done != 'function') {
    return (
      <Prop
        eid={e.eid}
        comp={String(comp)}
        prop={String(col)}
        editable={editable}
      />
    )
  }
  return <Control {...controlProps(ctx)} />
}

let controlProps = (
  { e, comp, col, ...ctx }: Context & { e: Ent },
): EditProps => ({
  eid: e.eid,
  comp: String(comp),
  prop: String(col),
  value: 'value' in ctx ? ctx.value : columnValue(e, String(comp), String(col)),
  done: ctx.done as (() => void),
  onChange: ctx.onChange as EditorProps['onChange'],
  anchor: ctx.anchor as EditProps['anchor'] ?? { current: null },
  face: ctx.face as ComponentChildren,
  side: ctx.side as EditProps['side'],
})

// A column door is also used by the status pip, whose derived enum has its
// own mark action but the same picker and vocabulary as every other enum.
export let ColumnEdit = (
  { eid, comp, prop, ...ctx }: Omit<EditProps, 'value'> & { value?: unknown },
) => {
  let e = ent(eid)
  return renderView(e, 'Edit', {
    ...ctx,
    comp,
    col: prop,
    onPatch: (patch) => {
      applyPatch(eid, patch)
      ctx.done()
    },
  })
}

// ---- the door ----

// <Prop eid comp prop editable/> — the <Entity> of values: the registry
// supplies the type's face (an eid reads as its target's title, a time
// as relative words) and, editable, the control a click opens — the
// entry's wrapper owns the layout, Prop only hands it the anchor and the
// face. Callers may dress the value: `show` paints a custom face (a
// badge, a chip, a link) while the registry still owns the editing;
// `name` is the ghost label when empty; `handle` gives a LINK face its
// own edit press without stealing navigation.
export let Prop = (
  { eid, comp, prop, editable, name, show: paint, handle }: {
    eid: string
    comp: string
    prop: string
    editable?: boolean
    name?: string
    show?: (face: string | null, value: unknown) => JSX.Element | null
    handle?: boolean
  },
) => {
  let [editing, setEditing] = useState(false)
  // What the popout control anchors on — the value or its handle.
  let anchor = useRef<HTMLElement>(null)
  let e = ent(eid)
  let value = columnValue(e, comp, prop)
  let p = propAt(comp, prop)
  let t = p?.type
  let faceValue = p
    ? formatProp(p, value, {
      describe: (eid) => {
        if (!cache.value[eid]) return
        let target = ent(eid)
        let title = target.doc?.title
        return title || idOf(target)
      },
    })
    : value == null
    ? null
    : String(value)
  let entry = columnView(ent(eid), comp, prop)
  let editor = editable && canEdit(comp, prop) ? entry : undefined
  // The face, through the registry; plain is the net under types no
  // entry claims (bool, a prop outside the vocabulary).
  let face = paint
    ? paint(faceValue, value)
    : entry && 'show' in entry && entry.show
    ? entry.show(faceValue)
    : (
      plain(faceValue)
    )
  let done = () => setEditing(false)
  let ep: EditorProps = { eid, comp, prop, value, done }
  // bool never enters an edit mode: the value IS the toggle. For popout
  // editors the same click closes an open control — the value is the
  // press target both ways.
  let press = !editor
    ? undefined
    : t == 'bool'
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
  let shown = (
    <>
      {(face || !handle) && (
        <Val
          elRef={handle ? undefined : anchor}
          mod={!face && 'nil'}
          onClick={handle ? undefined : open}
        >
          {face || (paint && editor ? `+ ${name ?? prop}` : '—')}
        </Val>
      )}
      {handle && editor && (
        <Hand
          elRef={anchor}
          mod={!face && 'empty'}
          type='button'
          aria-label={`change ${name ?? prop}`}
          onClick={press}
        >
          {face ? '▾' : `+ ${name ?? prop}`}
        </Hand>
      )}
    </>
  )
  return (
    <Frame mod={editor && 'live'}>
      {editing && editor
        ? <ColumnEdit {...ep} anchor={anchor} face={shown} />
        : shown}
    </Frame>
  )
}
