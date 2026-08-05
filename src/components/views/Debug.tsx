import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { formatProp, propAt } from '../../props.ts'
import { comps as vocab, type Ent } from '../../types.ts'
import { backlinks, ent, mutate, parents } from '../../live.ts'
import { up } from './Show.tsx'
import { block } from '../ui.tsx'
import { Prop } from '../editors.tsx'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { viaName } from '../Comments.tsx'
import { title } from '../title.tsx'

// Adding/removing comps is a browser power tool — the TUI paints Debug as
// static lines with no live events, so the controls stay web-only. typeof
// Deno is the seam: undefined in the browser bundle, set in the TUI's Deno
// process.
let browser = typeof Deno == 'undefined'
let priority = propAt('task', 'priority')!

// The Debug view: one full inspector for the entity itself — EVERY prop,
// nothing hidden — with contained children as one linked Debug.Tile row
// each (a board full of tasks stays a list, not an explosion). The per-kind
// dispatch lives in Debug.Tile: tasks get the status row, everything
// else the generic one; the inspector's own head is its ListTile too.

let Frame = block('div', 'Debug', {
  Props: 'div',
  Key: 'span',
  Comp: 'span',
  Val: 'span',
  Rm: 'button',
  Add: 'div',
  AddBtn: 'button',
  AddList: 'div',
  AddItem: 'button',
  Item: 'div',
  Kind: 'span',
  Title: 'span',
  Status: 'span',
  Claim: 'span',
  Prio: 'span',
  Kids: 'div',
  Linked: 'div',
  Via: 'span',
})
let {
  Props: Grid,
  Key,
  Comp,
  Val,
  Rm,
  Add,
  AddBtn,
  AddList,
  AddItem,
  Item,
  Kind,
  Title,
  Status,
  Claim,
  Prio,
  Kids,
  Linked,
  Via,
} = Frame

// The comps an entity actually carries, minus the spine — the raw payload.
// Provenance (created/updated) rides in `rest` now like any component, so
// Debug renders each as its own key→value row (T-6670).
let comps = (e: Ent) => {
  let { eid: _e, num: _n, kind: _k, refs: _r, kids: _kids, ...rest } = e
  return Object.entries(rest).filter(([, v]) => v) as [
    string,
    Record<string, unknown>,
  ][]
}

// Values color by shape: numbers, uuids, everything else.
let shape = (v: unknown) =>
  typeof v == 'number'
    ? 'num'
    : typeof v == 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}/.test(v)
    ? 'id'
    : false

// null and '' still get a row — debug hides nothing, including absence.
let Row = ({ comp, k, v }: { comp?: string; k: string; v: unknown }) => (
  <>
    <Key>
      {comp && <Comp>{comp}.</Comp>}
      {k}
    </Key>
    {v == null || v === ''
      ? <Val mod='nil'>{v === '' ? '""' : 'null'}</Val>
      : <Val mod={shape(v)}>{String(v)}</Val>}
  </>
)

// EVERY prop as a key → value grid row — the spine (eid, num), then each
// component whole ('pin.x  664'). kind is NOT here: it's derived, not
// data, and the summary line above already says it. Wire-writable props
// render through <Prop editable> — the typed vocabulary picks each one's
// editor, so the WHOLE entity is editable here with the right control and
// zero per-kind code; server-owned columns stay the plain read they are.
//
// A component's rows are the UNION of its stored columns and its
// vocabulary columns: a freshly-added comp lands in the cache empty
// (mutate({name, comp:{}})), so the vocab keys are what surface its
// editable Prop rows before any value exists — set memory.scope_eid the
// moment you add memory. For an entity loaded whole (snapshot carries every
// column) this union is exactly its stored keys.
let cells = (e: Ent, name: string, comp: Record<string, unknown>) => {
  let keys = [
    ...new Set([...Object.keys(comp), ...Object.keys(vocab[name] ?? {})]),
  ]
  return keys.flatMap((k, i) => {
    let v = comp[k]
    let rm = browser && i == 0 && name in vocab && (
      <Rm
        type='button'
        title={`remove ${name}`}
        onClick={() => mutate({ eid: e.eid, name, comp: null })}
      >
        ×
      </Rm>
    )
    return [
      <Fragment key={`${name}.${k}`}>
        <Key>
          <Comp>{name}.</Comp>
          {k}
          {rm}
        </Key>
        {k in (vocab[name] ?? {})
          ? <Prop eid={e.eid} comp={name} prop={k} editable />
          : v == null || v === ''
          ? <Val mod='nil'>{v === '' ? '""' : 'null'}</Val>
          : <Val mod={shape(v)}>{String(v)}</Val>}
      </Fragment>,
      // The Rails idiom, reified: assignee_eid is the COLUMN (uuid,
      // above); assignee is the ASSOCIATION — the entity itself, said as
      // its chip + name. Derived, so read-only and dim-keyed.
      ...(k.endsWith('_eid') && v
        ? [
          <Fragment key={`${name}.${k}.assoc`}>
            <Key mod='drv'>
              <Comp>{name}.</Comp>
              {k.slice(0, -4)}
            </Key>
            <Val mod='ent'>
              <Id e={ent(String(v))} /> {ent(String(v)).doc?.title ?? ''}
            </Val>
          </Fragment>,
        ]
        : []),
    ]
  })
}

let AllProps = ({ e }: { e: Ent }) => (
  <Grid>
    <Row k='eid' v={e.eid} />
    <Row k='num' v={e.num} />
    {comps(e).flatMap(([name, comp]) => cells(e, name, comp))}
  </Grid>
)

// The add-comp picker — a `+ component` toggle listing wire-writable
// comps this entity lacks (comps keys minus present ones). Selecting one
// applies an empty patch; db.ts upserts the row with its column defaults
// (a doc + empty memory reads as a memory at once, type defaulting to
// 'project'), and its columns then surface as the editable Prop rows
// above. The spine and `entity` are never comps here, so they can't be
// added; deleting the entity stays the verb menu's job.
let AddComp = ({ e }: { e: Ent }) => {
  let [open, setOpen] = useState(false)
  let present = new Set(comps(e).map(([n]) => n))
  let addable = Object.keys(vocab).filter((n) => !present.has(n)).sort()
  let add = (name: string) => {
    mutate({ eid: e.eid, name, comp: {} })
    setOpen(false)
  }
  return (
    <Add>
      <AddBtn type='button' onClick={() => setOpen((o) => !o)}>
        + component
      </AddBtn>
      {open && (
        <AddList>
          {addable.map((n) => (
            <AddItem
              key={n}
              type='button'
              onClick={() => add(n)}
            >
              {n}
            </AddItem>
          ))}
        </AddList>
      )}
    </Add>
  )
}

export let Debug = ({ e }: { e: Ent }) => {
  // Incoming references too: whatever in the cache points here, said by
  // which prop brought it (live.ts backlinks, derived from the typed
  // vocabulary — sessions on their task, cards on their target, …).
  let links = backlinks(e.eid)
  return (
    <Frame>
      <Entity eid={e.eid} view='Debug.Tile' />
      <AllProps e={e} />
      {browser && <AddComp e={e} />}
      {parents(e.eid).map((d) => (
        <Entity
          key={d.parent + d.type}
          eid={d.parent}
          view='Dependency'
          type={d.type}
          label={up[d.type] ?? d.type}
        />
      ))}
      {e.refs.map((r) => (
        <Entity key={r.child} eid={r.child} view='Dependency' type={r.type} />
      ))}
      {e.kids.length > 0 && (
        <Kids>
          {e.kids.map((k) => (
            <Entity key={k.eid} eid={k.eid} view='Debug.Tile' />
          ))}
        </Kids>
      )}
      {links.length > 0 && (
        <Kids>
          {links.map((b) => (
            <Linked key={b.from + b.via}>
              <Via>← {b.via}</Via>
              <Entity eid={b.from} view='Debug.Tile' />
            </Linked>
          ))}
        </Kids>
      )}
    </Frame>
  )
}

export let DebugTaskItem = ({ e }: { e: Ent }) => (
  <Item>
    <Id e={e} />
    <Kind>{e.kind}</Kind>
    <Title {...title(e.doc?.title ?? '')} />
    {e.claim && <Claim>⚑ {viaName(e.claim.session_eid)}</Claim>}
    <Prio>{formatProp(priority, e.task!.priority)}</Prio>
    <Status mod={e.task!.status}>{e.task!.status}</Status>
  </Item>
)

export let DebugAnyItem = ({ e }: { e: Ent }) => (
  <Item>
    <Id e={e} />
    <Kind>{e.kind}</Kind>
    {e.doc?.title && <Title {...title(e.doc.title)} />}
  </Item>
)
