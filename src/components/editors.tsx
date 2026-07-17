import { type JSX } from 'preact'
import { useState } from 'preact/hooks'
import { comps, type PropType } from '../types.ts'
import { cache, domains, ent, mutate } from '../live.ts'
import { block, focus } from './ui.tsx'
import { Edit } from './Edit.tsx'

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
  Pop: 'span',
  Tab: 'button',
  Row: 'span',
  Find: 'input',
  Num: 'input',
  Free: 'input',
})
let { Val, Pop, Tab, Row, Find, Num, Free } = Frame

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

// enum: the values ARE the control — a row of tabs above the value,
// current one marked. Small closed sets only ever need one press.
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
          {v}
        </Tab>
      ))}
    </Pop>
  )
}

// {text: well}: free text whose datalist is whatever the graph already
// says (the named well). Empty commits null — clearing a facet is an
// edit.
let WellEdit = ({ ...p }: EditorProps) => {
  let t = p.t as { text: string }
  let list = `well-${t.text}-${p.eid}-${p.prop}`
  return (
    <>
      <Free
        elRef={focus}
        value={String(p.value ?? '')}
        list={list}
        onKeyDown={(ev: KeyboardEvent) => {
          let el = ev.currentTarget as HTMLInputElement
          if (ev.key == 'Enter') el.blur()
          else if (ev.key == 'Escape') {
            el.value = String(p.value ?? '')
            el.blur()
          }
        }}
        onBlur={(ev: FocusEvent) => {
          let text = (ev.currentTarget as HTMLInputElement).value.trim()
          text != String(p.value ?? '') ? set(p, text || null) : p.done()
        }}
      />
      <datalist id={list}>
        {(wells[t.text]?.() ?? []).map((x) => <option key={x} value={x} />)}
      </datalist>
    </>
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
  {
    match: (t) => typeof t == 'object' && 'enum' in t,
    mode: 'popout',
    Edit: EnumEdit,
  },
  {
    match: (t) => typeof t == 'object' && 'text' in t,
    mode: 'inline',
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
export let Prop = (
  { eid, comp, prop, editable }: {
    eid: string
    comp: string
    prop: string
    editable?: boolean
  },
) => {
  let [editing, setEditing] = useState(false)
  let t = comps[comp]?.[prop]
  let e = ent(eid) as unknown as Record<
    string,
    Record<string, unknown> | undefined
  >
  let value = e[comp]?.[prop]
  let editor = t && editable ? editorFor(t) : undefined
  let show = value == null || value === ''
    ? ''
    : typeof t == 'object' && 'eid' in t
    ? ent(String(value)).doc?.title ?? String(value)
    : String(value)
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
      <Val mod={!show && 'nil'} onClick={press}>
        {show || '—'}
      </Val>
      {editing && editor?.mode == 'popout' && <editor.Edit {...ep} />}
    </Frame>
  )
}
