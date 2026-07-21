import { type JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'
import { comps, type PropType, statuses } from '../types.ts'
import { cache, domains, ent, mutate } from '../live.ts'
import { block, focus } from './ui.tsx'
import { Dot } from './Dot.tsx'
import { Edit } from './Edit.tsx'
import { Overlay } from './overlay.tsx'
import { useComplete } from './Complete.tsx'

// The editor registry — the renderer registry's sibling. The typed
// vocabulary (types.ts comps) is the DETECTION layer: a PropType picks
// its control here, so views render props and they become editable with
// the right control without naming one. Two presentation modes, declared
// per editor:
//
//   inline — the control takes the value's place at the value's own
//            metrics (the Edit.tsx discipline: same font, no swap, zero
//            pixels move entering edit)
//   popout — the value keeps rendering; the control anchors ABOVE it
//            (nothing in the flow can jump, because the control was
//            never in the flow)
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
export type Editor = {
  match: (t: PropType) => boolean
  mode: 'inline' | 'popout'
  Edit: (p: EditorProps) => JSX.Element
}

let editors: Editor[] = []
export let defineEditors = (list: Editor[]) => editors.unshift(...list)
export let editorFor = (t: PropType) => editors.find((e) => e.match(t))

// Named suggestion WELLS: the schema says {text: 'domains'} and stays
// declarative; the browser registers what that name means here.
let wells: Record<string, () => string[]> = {}
export let defineWells = (w: typeof wells) => Object.assign(wells, w)

// One write path for every editor: a single column, patched in place.
let set = (p: EditorProps, v: unknown) => {
  mutate({ eid: p.eid, name: p.comp, comp: { [p.prop]: v } })
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
      let v = Number(text)
      text && isFinite(v) && v != p.value ? set(p, v) : p.done()
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
  let t = p.t as { enum: string[] }
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
    .filter((e) =>
      !q || (e.doc?.title ?? '').toLowerCase().includes(q.toLowerCase())
    )
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
          {e.doc?.title || e.kind}
        </Row>
      ))}
    </Pop>
  )
}
let candidates = (target: string) =>
  Object.keys(cache.value)
    .map((eid) => ent(eid))
    .filter((e) =>
      target ? !!(e as unknown as Record<string, unknown>)[target] : !!e.doc
    )
    .sort((a, b) => b.num - a.num)

defineEditors([
  {
    match: (t) => t == 'text' || t == 'body',
    mode: 'inline',
    Edit: (p) => (
      <Edit
        eid={p.eid}
        comp={p.comp}
        prop={p.prop}
        multi={p.t == 'body'}
        open
        onClose={p.done}
      />
    ),
  },
  { match: (t) => t == 'number', mode: 'inline', Edit: NumEdit },
  { match: (t) => t == 'query', mode: 'inline', Edit: QueryEdit },
  {
    match: (t) => typeof t == 'object' && 'enum' in t,
    mode: 'popout',
    Edit: EnumEdit,
  },
  {
    match: (t) => typeof t == 'object' && 'text' in t,
    mode: 'popout',
    Edit: WellEdit,
  },
  {
    match: (t) => typeof t == 'object' && 'eid' in t,
    mode: 'popout',
    Edit: EidEdit,
  },
])
defineWells({ domains: () => domains.value })

// ---- the door ----

// <Prop eid comp prop editable/> — the <View> of values: renders the
// prop; editable, a click opens the type's editor. An eid value shows
// its target's title (the association reads as a name, not a uuid).
// Callers may dress the value: `show` paints a custom face (a badge, a
// chip, a link) while the registry still owns the editing; `name` is the
// ghost label when empty; `handle` moves the press to a ▾ beside the
// face — for faces that are links, whose own click must stay navigation.
export let Prop = (
  { eid, comp, prop, editable, name, show: paint, handle }: {
    eid: string
    comp: string
    prop: string
    editable?: boolean
    name?: string
    show?: (v: unknown) => JSX.Element | null
    handle?: boolean
  },
) => {
  let [editing, setEditing] = useState(false)
  // The face the popout control anchors ABOVE — the value or its handle,
  // whichever is showing (both wear this ref; only one renders at a time).
  let anchor = useRef<HTMLElement>(null)
  let t = comps[comp]?.[prop]
  let e = ent(eid) as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >
  let value = e[comp]?.[prop]
  let editor = t && editable ? editorFor(t) : undefined
  let text = value == null || value === ''
    ? ''
    : typeof t == 'object' && 'eid' in t
    ? ent(String(value)).doc?.title ?? String(value)
    : String(value)
  let face = paint ? paint(value) : (text || null)
  let done = () => setEditing(false)
  let ep: EditorProps = { eid, comp, prop, t: t!, value, done }
  // bool never enters an edit mode: the value IS the toggle. For popout
  // editors the same click closes an open control — the value is the
  // handle both ways.
  let press = !editor
    ? undefined
    : t == 'bool'
    ? () => set(ep, value ? 0 : 1)
    : () => setEditing((was) => !was)
  if (editing && editor?.mode == 'inline') {
    return (
      <Frame>
        <editor.Edit {...ep} />
      </Frame>
    )
  }
  return (
    <Frame mod={editor && 'live'}>
      {(face || !handle) && (
        <Val
          elRef={anchor}
          mod={!face && 'nil'}
          onClick={handle ? undefined : press}
        >
          {face || (paint && editor ? `+ ${name ?? prop}` : '—')}
        </Val>
      )}
      {handle && editor && (
        <Hand
          elRef={anchor}
          mod={!face && 'empty'}
          type='button'
          onClick={press}
        >
          {face ? '▾' : `+ ${name ?? prop}`}
        </Hand>
      )}
      {editing && editor?.mode == 'popout' && (
        <Overlay anchor={anchor} side='above'>
          <editor.Edit {...ep} />
        </Overlay>
      )}
    </Frame>
  )
}
