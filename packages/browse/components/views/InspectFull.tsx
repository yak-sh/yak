import { type ComponentChildren, Fragment } from 'preact'
import { isRef } from '../../props.ts'
import { comps as vocab, type Ent, idOf, plural } from '../../types.ts'
import { ent, mutate, parents } from '../../live.ts'
import { useBacklinks } from '../useQuery.ts'
import { up } from './Dependency.tsx'
import * as ui from '@yaks/ui'
import { Edit } from '@yaks/ux'
import { usePage } from '../page.ts'
import { bundle, renderView } from '../registry.ts'
import { Entity } from '../Entity.tsx'
import { follow } from '../nav.tsx'
import { compTone } from '../comp.ts'
import { Icon } from '../icons.tsx'
import { dragData } from '../drag.ts'

// Adding/removing comps is a browser power tool — the TUI paints InspectFull as
// static lines with no live events, so the controls stay web-only. typeof
// Deno is the seam: undefined in the browser bundle, set in the TUI's Deno
// process.
let browser = typeof Deno == 'undefined'

// Inspect.Full: one full inspector for the entity itself — EVERY prop,
// nothing hidden — with contained children as one linked List.Tile row
// each (a board full of tasks stays a list, not an explosion). The per-kind
// dispatch lives in List.Tile: tasks get the status row, everything
// else the generic one; the inspector's own head is its ListTile too.

let Frame = ({ children }: { children?: ComponentChildren }) => (
  <div class='InspectFull'>{children}</div>
)
let Lens = ui.Section, Head = ui.Section, Grid = ui.Pairs, Tabs = ui.Tabs
let Key = ui.Pairs.Key, Comp = ui.Chip, Val = ui.Value, Rm = ui.Button
let Add = ui.Section,
  AddBtn = ui.Button,
  AddList = ui.Choices,
  AddItem = ui.Choices.Item
let Kids = ui.Section, Linked = ui.Tile, Via = ui.Value
let { Tab } = ui.Tabs

// Raw file forms belong to the inspector, not every card's primary tab row.
// They remain draggable here because the same gesture is how a browser hands
// the serialized bytes to the desktop.
export let InspectFullTabs = (
  { e, head, children }: {
    e: Ent
    head?: ComponentChildren
    children?: ComponentChildren
  },
) => {
  let page = usePage<{ format?: string }>('inspectFull', e.eid)
  let view = page.value?.format ?? 'Inspect.Full'
  let views = ['Inspect.Full', ...(e.doc ? ['Markdown'] : []), 'JSON']
  return (
    <Lens>
      <Head data-formats-head=''>
        {head}
        <Tabs data-formats=''>
          <ui.Tabs>
            {views.map((v) => (
              <Tab
                key={v}
                type='button'
                mod={v == view && 'on'}
                draggable={v != 'Inspect.Full'}
                onDragStart={(ev: DragEvent) => dragData(ev, e.eid, v)}
                onClick={() => page.set({ format: v })}
                aria-label={v == 'Inspect.Full' ? 'Components' : v}
                data-tip={v == 'Inspect.Full' ? 'Components' : v}
              >
                <Icon
                  name={v == 'Inspect.Full'
                    ? 'scan-search'
                    : v == 'Markdown'
                    ? 'hash'
                    : 'braces'}
                />
              </Tab>
            ))}
          </ui.Tabs>
        </Tabs>
      </Head>
      {view == 'Markdown'
        ? renderView(e, 'Markdown')
        : view == 'JSON'
        ? renderView(e, 'JSON')
        : children}
    </Lens>
  )
}

// The comps an entity actually carries, minus the spine — the raw payload.
// Provenance (created/updated) rides in `rest` now like any component, so
// InspectFull renders each as its own key→value row (T-6670).
let comps = (e: Ent) => {
  let {
    eid: _e,
    entity: _spine,
    num: _n,
    kind: _k,
    refs: _r,
    kids: _kids,
    ...rest
  } = e
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
      {comp && <Comp mod={compTone(comp)}>{comp}.</Comp>}
      {k}
    </Key>
    {v == null || v === ''
      ? <Val mod='nil'>{v === '' ? '""' : 'null'}</Val>
      : (
        <Val mod={shape(v)}>
          {typeof v == 'object' ? JSON.stringify(v) : String(v)}
        </Val>
      )}
  </>
)

// A reference reads as its ASSOCIATION, not its raw column: the entity's
// chip + title, then the eid it stored. One row, not two — the column
// (assignee, a uuid) and the association (assignee, the entity) said
// together. The chip is a link; the rest of the value opens the eid editor
// where the reference is wire-writable.
let refFace = (v: unknown) =>
  v == null || v === '' ? null : (
    <>
      <Entity eid={String(v)} view='Inspect.Reference.Inline' />{' '}
      <Val mod='id'>{typeof v == 'object' ? JSON.stringify(v) : String(v)}</Val>
    </>
  )

// EVERY prop as a key → value grid row — the spine (eid, num), then each
// component whole ('pin.x  664'). kind is NOT here: it's derived, not
// data, and the summary line above already says it. Wire-writable props
// render through <Edit editable> — the typed vocabulary picks each one's
// editor, so the WHOLE entity is editable here with the right control and
// zero per-kind code; server-owned columns stay the plain read they are.
//
// A component's rows are the UNION of its stored columns and its
// vocabulary columns: a freshly-added comp lands in the cache empty
// (mutate({name, comp:{}})), so the vocab keys are what surface its
// editable Prop rows before any value exists — set memory.scope the
// moment you add memory. For an entity loaded whole (snapshot carries every
// column) this union is exactly its stored keys.
let cells = (e: Ent, name: string, comp: Record<string, unknown>) => {
  let keys = [
    ...new Set([...Object.keys(comp), ...Object.keys(vocab[name] ?? {})]),
  ]
  return keys.map((k, i) => {
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
    // The reference detector reads the PropType, so `created.by`, `to`, and
    // `project` are associations without a second naming convention.
    let assoc = isRef(name, k)
    let editable = k in (vocab[name] ?? {})
    return (
      <Fragment key={`${name}.${k}`}>
        <Key>
          <Comp mod={compTone(name)}>{name}.</Comp>
          {k}
          {rm}
        </Key>
        {assoc
          ? (
            <Edit
              e={bundle(e)}
              comp={name}
              prop={k}
              editable={editable}
              show={(_, val) => refFace(val)}
            />
          )
          : editable
          ? <Edit e={bundle(e)} comp={name} prop={k} editable />
          : v == null || v === ''
          ? <Val mod='nil'>{v === '' ? '""' : 'null'}</Val>
          : (
            <Val mod={shape(v)}>
              {typeof v == 'object' ? JSON.stringify(v) : String(v)}
            </Val>
          )}
      </Fragment>
    )
  })
}

let AllProps = ({ e }: { e: Ent }) => (
  <Grid data-raw-properties=''>
    <Row k='eid' v={e.eid} />
    <Row k='num' v={e.num} />
    {comps(e).flatMap(([name, comp]) => cells(e, name, comp))}
  </Grid>
)

// The add-comp picker — a `+ component` toggle listing wire-writable
// comps this entity lacks (comps keys minus present ones). Selecting one
// applies an empty patch; the host upserts the row with its column defaults
// (a doc + empty memory reads as a memory at once, type defaulting to
// 'project'), and its columns then surface as the editable Prop rows
// above. The spine and `entity` are never comps here, so they can't be
// added; deleting the entity stays the verb menu's job.
export let AddComp = ({ e }: { e: Ent }) => {
  let page = usePage<{ adding?: boolean }>('inspectFull', e.eid)
  let open = page.value?.adding ?? false
  let present = new Set(comps(e).map(([n]) => n))
  let addable = Object.keys(vocab).filter((n) => !present.has(n)).sort()
  let add = (name: string) => {
    mutate({ eid: e.eid, name, comp: {} })
    page.set({ adding: false })
  }
  return (
    <Add>
      <AddBtn
        data-add-component=''
        type='button'
        onClick={() => page.set({ adding: !open })}
      >
        + component
      </AddBtn>
      {open && (
        <AddList>
          {addable.map((n) => (
            <AddItem
              data-add-choice=''
              key={n}
              role='button'
              tabIndex={0}
              onKeyDown={(ev: KeyboardEvent) => {
                if (ev.key == 'Enter' || ev.key == ' ') add(n)
              }}
              onClick={() => add(n)}
            >
              <Comp mod={compTone(n)}>{n}</Comp>
            </AddItem>
          ))}
        </AddList>
      )}
    </Add>
  )
}

export let InspectFull = (
  { e, project, tabs = true }: { e: Ent; project?: boolean; tabs?: boolean },
) => {
  // Incoming references too: whatever points here, said by which prop
  // brought it (useBacklinks — the held eid-keyed reverse sub, derived from
  // the typed vocabulary: sessions on their task, cards on their target, …).
  let head = <Entity eid={e.eid} view='Inspect.Head' />
  let body = (
    <>
      <Entity eid={e.eid} view='Inspect.Body' />
      <Entity eid={e.eid} view='Inspect.Facts' />
      <ui.Section data-properties=''>
        <AllProps e={e} />
      </ui.Section>
      {browser && <AddComp e={e} />}
      {!project && <Entity eid={e.eid} view='Inspect.Links' />}
      {project && parents(e.eid).map((d) => (
        <Entity
          key={d.parent + d.type}
          eid={d.parent}
          view='Dependency'
          type={d.type}
          label={up(d.type)}
        />
      ))}
      {project &&
        e.refs.map((r) => (
          <Entity key={r.child} eid={r.child} view='Dependency' type={r.type} />
        ))}
      {e.kids.length > 0 && (
        <Kids>
          {e.kids.map((k) => (
            <Entity key={k.eid} eid={k.eid} view='List.Tile' />
          ))}
        </Kids>
      )}
      {project && <ProjectIncoming e={e} />}
      <Entity eid={e.eid} view='Inspect.History' />
    </>
  )
  return (
    <Frame>
      {browser && tabs
        ? <InspectFullTabs e={e} head={head}>{body}</InspectFullTabs>
        : <>{head}{body}</>}
    </Frame>
  )
}

let CAP = 3
let groups = (links: { from: string; via: string }[]) => {
  let out = new Map<string, { kind: string; via: string; ids: string[] }>()
  for (let link of links) {
    if (link.via.endsWith('.by')) continue
    let kind = ent(link.from).kind
    let key = `${link.via}\0${kind}`
    let group = out.get(key) ?? { kind, via: link.via, ids: [] }
    group.ids.push(link.from)
    out.set(key, group)
  }
  return [...out.values()].map((group) => ({
    ...group,
    ids: group.ids.toSorted((a, b) => ent(b).num - ent(a).num),
  }))
}

let ProjectIncoming = ({ e }: { e: Ent }) => {
  let linked = groups(useBacklinks(e.eid))
  if (!linked.length) return null
  return (
    <Kids>
      {linked.flatMap((group) => {
        let shown = group.ids.slice(0, CAP)
        let more = group.ids.length - shown.length
        let query = `.${group.via}=${idOf(e)}`
        let href = `/inspect?q=${encodeURIComponent(query)}`
        return [
          ...shown.map((eid) => (
            <Linked key={group.via + eid}>
              <Via>← {group.via}</Via>
              <Entity eid={eid} view='List.Tile' />
            </Linked>
          )),
          ...(more
            ? [
              <Linked
                data-more-links=''
                key={group.via + group.kind}
                href={href}
                onClick={follow(href)}
              >
                <Via>← {group.via}</Via>
                +{more} more {plural(group.kind)}
              </Linked>,
            ]
            : []),
        ]
      })}
    </Kids>
  )
}

// A project is an actor and a home, so its complete backlink set is an
// activity ledger. Attribution belongs in history; associations stay here,
// capped per relation with a filtered census link for the remainder.
export let ProjectInspectFull = ({ e }: { e: Ent }) => (
  <InspectFull e={e} project />
)
