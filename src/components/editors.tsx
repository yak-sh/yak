import { type ComponentChildren, type JSX } from 'preact'
import { useContext, useRef, useState } from 'preact/hooks'
import { formatProp, propAt } from '../props.ts'
import { idOf, type PropType, statuses } from '../types.ts'
import { cache, census, domains, ent, mutate, problem } from '../live.ts'
import { ago, block, focus, pretty, Surround } from './ui.tsx'
import { Dot } from './Dot.tsx'
import { Edit } from './Edit.tsx'
import { Overlay } from './overlay.tsx'
import { useComplete } from './Complete.tsx'
import * as suggest from './suggest.ts'

// The PROP registry — the renderer registry's sibling. The typed
// vocabulary (types.ts comps) is the DETECTION layer: one entry per
// PropType kind owns both faces of knowing what a value is — `show`
// (the display) and `Edit` (the control) — so views render props and
// they become editable with the right control without naming one.
//
// Defaults are curated at the bottom; defineEditors prepends, so a later
// registration outranks the stock one — the registry is defaults, not a
// ceiling.

export type EditorProps = {
  eid: string
  comp: string
  prop: string
  t: PropType
  value: unknown
  done: () => void
}
// What the layout wrappers add: the element the control anchors on and
// the face it may keep rendering (popout) or replace (inline).
export type EditProps = EditorProps & {
  anchor: { current: HTMLElement | null }
  face?: ComponentChildren
  side?: 'above' | 'below'
}
export type Editor = {
  match: (t: PropType) => boolean
  show?: (value: string | null, t: PropType) => JSX.Element | null
  Edit: (p: EditProps) => JSX.Element
}

let editors: Editor[] = []
export let defineEditors = (list: Editor[]) => editors.unshift(...list)
export let editorFor = (t: PropType) => editors.find((e) => e.match(t))

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

// Named suggestion WELLS: the schema says {text: 'domains'} and stays
// declarative; the browser registers what that name means here.
let wells: Record<string, () => string[]> = {}
export let defineWells = (w: typeof wells) => Object.assign(wells, w)

// One write path for every editor: a single column, patched in place.
let set = (p: EditorProps, v: unknown) => {
  try {
    mutate({ eid: p.eid, name: p.comp, comp: { [p.prop]: v } })
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
  let t = p.t as { enum: readonly string[] }
  return (
    <Pop>
      {t.enum.map((v) => (
        <Tab
          key={v}
          type='button'
          mod={v == p.value && 'on'}
          onClick={() => v == p.value ? p.done() : set(p, v)}
        >
          {t.enum == statuses && <Dot status={v} />}
          {v}
        </Tab>
      ))}
    </Pop>
  )
}

// {text: well}: free text with the graph's suggestions — the same popout
// search list the eid editor wears (one look for every picker; datalist
// was the browser's own UI, styled by nobody). The difference from a
// reference: the QUERY is a candidate — Enter commits what's typed, and
// an unheard-of value shows as the top row, so new domains stay mintable.
// The 'none' row clears, as everywhere.
let WellEdit = ({ ...p }: EditorProps) => {
  let t = p.t as { text: string }
  let [q, setQ] = useState('')
  let all = wells[t.text]?.() ?? []
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

// {eid: target}: a lazy search over the cache — entities carrying the
// target component ('' = anything with a doc), filtered by what's typed,
// newest first. A 'none' row clears the association.
let EidEdit = ({ ...p }: EditorProps) => {
  let t = p.t as { eid: string }
  let [q, setQ] = useState('')
  let hits = candidates(t.eid)
    .filter((e) => suggest.match(q, e))
    .sort(suggest.order(q))
    .slice(0, 8)
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
let candidates = (target: string) =>
  census.value
    .map((eid) => ent(eid))
    .filter((e) =>
      target ? !!(e as unknown as Record<string, unknown>)[target] : !!e.doc
    )

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
    multi={p.t == 'body'}
    open
    onClose={p.done}
  />
)

defineEditors([
  {
    match: (t) => t == 'text' || t == 'body',
    show: plain,
    Edit: inline(TextEdit),
  },
  { match: (t) => t == 'time', show: TimeVal, Edit: inline(TextEdit) },
  { match: (t) => t == 'url', show: UrlVal, Edit: inline(TextEdit) },
  {
    match: (t) => t == 'number' || t == 'priority',
    show: plain,
    Edit: inline(NumEdit),
  },
  { match: (t) => t == 'query', show: plain, Edit: inline(QueryEdit) },
  {
    match: (t) => typeof t == 'object' && 'enum' in t,
    show: plain,
    Edit: popout(EnumEdit),
  },
  {
    match: (t) => typeof t == 'object' && 'text' in t,
    show: plain,
    Edit: popout(WellEdit),
  },
  {
    match: (t) => typeof t == 'object' && 'eid' in t,
    show: titled,
    Edit: popout(EidEdit),
  },
])
defineWells({ domains: () => domains.value })

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
  let e = ent(eid) as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >
  let value = e[comp]?.[prop]
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
  let entry = t ? editorFor(t) : undefined
  let editor = editable ? entry : undefined
  // The face, through the registry; plain is the net under types no
  // entry claims (bool, a prop outside the vocabulary).
  let face = paint
    ? paint(faceValue, value)
    : entry?.show
    ? entry.show(faceValue, t!)
    : (
      plain(faceValue)
    )
  let done = () => setEditing(false)
  let ep: EditorProps = { eid, comp, prop, t: t!, value, done }
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
        ? <editor.Edit {...ep} anchor={anchor} face={shown} />
        : shown}
    </Frame>
  )
}
