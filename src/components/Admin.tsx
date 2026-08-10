// The census — the canvas's counterpart. A traditional admin: sidebar of
// kinds (derived from kindOrder), an index per kind whose columns ARE
// the vocabulary row (admin.ts columnsFor), and a new-form whose fields
// pick controls by PropType. Nothing here names a specific comp: add one
// to types.ts and this interface grows a section, a column set, and a
// form with zero edits — the same property every other surface holds.
import { useState } from 'preact/hooks'
import { comps, type Ent, idOf, type PropType, uuid } from '../types.ts'
import { ent, mutate, rows } from '../live.ts'
import { block } from './ui.tsx'
import {
  adminRoute,
  type Col,
  columnsFor,
  countsByPresence,
  groupedKinds,
  inSection,
} from './admin.ts'
import { FilterInput, passOf } from './Filter.tsx'
import { Prop } from './editors.tsx'
import { Id } from './views/Inline.tsx'
import { Entity } from './Entity.tsx'
import { follow, navigate, route } from './nav.tsx'
import { title } from './title.tsx'

let Frame = block('div', 'Admin', {
  Side: 'nav',
  Group: 'div',
  Kind: 'a',
  Count: 'span',
  Main: 'section',
  Head: 'header',
  Name: 'h1',
  Tools: 'span',
  Tool: 'button',
  Table: 'div',
  Grid: 'div',
  Cell: 'div',
  Th: 'div',
  Row: 'div',
  More: 'div',
  Form: 'form',
  Field: 'label',
  Key: 'span',
  Save: 'button',
})
let {
  Side,
  Group,
  Kind,
  Count,
  Main,
  Head,
  Name,
  Tools,
  Tool,
  Table,
  Grid,
  Cell,
  Th,
  Row,
  More,
  Form,
  Field,
  Key,
  Save,
} = Frame

let CAP = 200

// ---- cells: a value's read-only face, picked by its PropType ----

let CellVal = ({ e, col }: { e: Ent; col: Col }) => {
  if (col.key == 'id') return <Id e={e} />
  if (col.key == 'title') {
    return <span {...title(String(e.doc?.title ?? ''))} />
  }
  if (col.key == 'modified') {
    return (
      <span>{String(e.updated?.at ?? e.created?.at ?? '').slice(0, 16)}</span>
    )
  }
  return <Prop eid={e.eid} comp={col.comp!} prop={col.prop!} />
}

// ---- the index: one kind, every row, columns from the vocabulary ----

let sortVal = (e: Ent, col: Col): string | number => {
  if (col.key == 'id') return e.num
  if (col.key == 'title') return String(e.doc?.title ?? '')
  if (col.key == 'modified') return String(e.updated?.at ?? e.created?.at ?? '')
  let v = (e as unknown as Record<string, Record<string, unknown>>)[col.comp!]
    ?.[col.prop!]
  return typeof v == 'number' ? v : String(v ?? '')
}

let Index = ({ kind, query }: { kind: string; query: string }) => {
  let [grid, setGrid] = useState(false)
  let [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  let cols = columnsFor(kind)
  // A deep-linked query gets its own filter identity: it arrives filled,
  // remains editable, and cannot inherit an unrelated glance at this kind.
  let filter = `admin:${kind}${query ? `:${query}` : ''}`
  let pass = passOf(filter, query)
  let all = inSection(rows(), kind).map((r) => ent(r.eid))
    .filter((e) => pass(e.eid))
  if (sort) {
    let col = cols.find((c) => c.key == sort!.key)!
    all.sort((a, b) => {
      let x = sortVal(a, col), y = sortVal(b, col)
      return (typeof x == 'number' && typeof y == 'number'
        ? x - y
        : String(x).localeCompare(String(y))) * sort!.dir
    })
  } else all.sort((a, b) => b.num - a.num)
  let shown = all.slice(0, CAP)
  return (
    <Main>
      <Head>
        <Name>{kind}</Name>
        <FilterInput key={filter} eid={filter} initial={query} />
        <Tools>
          <Tool
            type='button'
            mod={!grid && 'on'}
            onClick={() => setGrid(false)}
          >
            table
          </Tool>
          <Tool type='button' mod={grid && 'on'} onClick={() => setGrid(true)}>
            grid
          </Tool>
          <Tool type='button' onClick={() => navigate(`/admin/${kind}/new`)}>
            + new
          </Tool>
        </Tools>
      </Head>
      {grid
        ? (
          <Grid>
            {shown.map((e) => (
              <Entity key={e.eid} eid={e.eid} view='List.Tile' />
            ))}
          </Grid>
        )
        : (
          <Table
            style={{
              gridTemplateColumns:
                `repeat(${cols.length}, minmax(max-content, 1fr))`,
            }}
          >
            <Row mod='head'>
              {cols.map((c) => (
                <Th
                  key={c.key}
                  mod={sort?.key == c.key && (sort.dir > 0 ? 'asc' : 'desc')}
                  onClick={() =>
                    setSort(
                      sort?.key == c.key && sort.dir > 0
                        ? { key: c.key, dir: -1 }
                        : { key: c.key, dir: 1 },
                    )}
                >
                  {c.key.replace(/_eid$/, '')}
                </Th>
              ))}
            </Row>
            {shown.map((e) => (
              <Row key={e.eid} onClick={follow(`/${idOf(e)}`, e.eid)}>
                {cols.map((c) => (
                  <Cell key={c.key} mod={c.key}>
                    <CellVal e={e} col={c} />
                  </Cell>
                ))}
              </Row>
            ))}
          </Table>
        )}
      {all.length > CAP && (
        <More>
          showing {CAP} of {all.length}
        </More>
      )}
      {!all.length && <More>nothing here yet</More>}
    </Main>
  )
}

// ---- the new form: fields from the vocabulary, controls by type ----

// The editor registry's controls write in place on an existing entity;
// a not-yet-minted one needs local state first, so the form derives from
// the same PropType detection but commits once, as one batch.
let Control = (
  { t, value, set }: {
    t: PropType
    value: unknown
    set: (v: unknown) => void
  },
) => {
  if (typeof t == 'object' && 'enum' in t) {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e: Event) =>
          set((e.currentTarget as HTMLSelectElement).value)}
      >
        {t.enum.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    )
  }
  if (typeof t == 'object' && 'eid' in t) {
    let target = t.eid
    let opts = rows()
      .filter((r) => target ? r.comps[target] : r.comps.doc)
      .map((r) => ent(r.eid))
      .sort((a, b) => b.num - a.num)
      .slice(0, 50)
    return (
      <select
        value={String(value ?? '')}
        onChange={(e: Event) =>
          set((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value=''>none</option>
        {opts.map((e) => (
          <option key={e.eid} value={e.eid}>
            {idOf(e)} {e.doc?.title ?? e.kind}
          </option>
        ))}
      </select>
    )
  }
  if (t == 'bool') {
    return (
      <input
        type='checkbox'
        checked={!!value}
        onChange={(e: Event) =>
          set((e.currentTarget as HTMLInputElement).checked ? 1 : 0)}
      />
    )
  }
  if (t == 'body') {
    return (
      <textarea
        rows={6}
        value={String(value ?? '')}
        onInput={(e: Event) =>
          set((e.currentTarget as HTMLTextAreaElement).value)}
      />
    )
  }
  // text, number, query, {text: well} — a plain input; numbers parse at
  // submit so a half-typed minus sign never fights the keystroke.
  return (
    <input
      value={String(value ?? '')}
      onInput={(e: Event) => set((e.currentTarget as HTMLInputElement).value)}
    />
  )
}

let NewForm = ({ kind }: { kind: string }) => {
  let props = comps[kind] ?? {}
  // enums start on their first value — a select never submits unanswered
  let seed: Record<string, unknown> = {}
  for (let [prop, t] of Object.entries(props)) {
    if (typeof t == 'object' && 'enum' in t) seed[prop] = t.enum[0]
  }
  let [doc, setDoc] = useState({ title: '', body: '' })
  let [vals, setVals] = useState<Record<string, unknown>>(seed)
  let submit = (ev: Event) => {
    ev.preventDefault()
    let eid = uuid()
    let comp: Record<string, unknown> = {}
    for (let [prop, t] of Object.entries(props)) {
      let v = vals[prop]
      if (v == null || v === '') continue
      comp[prop] = t == 'number' && typeof v == 'string' ? Number(v) : v
    }
    mutate(
      ...(doc.title || doc.body
        ? [{ eid, name: 'doc', comp: { ...doc } }]
        : []),
      { eid, name: kind, comp },
    )
    navigate(`/${eid}`)
  }
  return (
    <Main>
      <Head>
        <Name>new {kind}</Name>
      </Head>
      <Form onSubmit={submit}>
        <Field>
          <Key>title</Key>
          <input
            value={doc.title}
            onInput={(e: Event) =>
              setDoc({
                ...doc,
                title: (e.currentTarget as HTMLInputElement).value,
              })}
          />
        </Field>
        <Field>
          <Key>body</Key>
          <textarea
            rows={4}
            value={doc.body}
            onInput={(e: Event) =>
              setDoc({
                ...doc,
                body: (e.currentTarget as HTMLTextAreaElement).value,
              })}
          />
        </Field>
        {Object.entries(props).map(([prop, t]) => (
          <Field key={prop}>
            <Key>{prop.replace(/_eid$/, '')}</Key>
            <Control
              t={t}
              value={vals[prop]}
              set={(v) => setVals({ ...vals, [prop]: v })}
            />
          </Field>
        ))}
        <Save type='submit'>create</Save>
      </Form>
    </Main>
  )
}

// ---- the frame: sidebar + whichever page the route names ----

export let Admin = () => {
  let url = new URL(route.value, 'http://x')
  let { kind, form } = adminRoute(url.pathname)
  let query = url.searchParams.get('q') ?? ''
  let counts = countsByPresence(rows())
  let { content, system } = groupedKinds()
  let [folded, setFolded] = useState(true)
  let link = (k: string) => (
    <Kind
      key={k}
      href={`/admin/${k}`}
      mod={k == kind && !form && 'on'}
      onClick={(ev: MouseEvent) => {
        if (ev.metaKey || ev.ctrlKey) return
        ev.preventDefault()
        navigate(`/admin/${k}`)
      }}
    >
      {k}
      <Count>{counts[k] ?? 0}</Count>
    </Kind>
  )
  return (
    <Frame>
      <Side>
        <Group>{content.map(link)}</Group>
        <Group mod='system'>
          <Kind
            href='#'
            mod='fold'
            onClick={(ev: MouseEvent) => {
              ev.preventDefault()
              setFolded(!folded)
            }}
          >
            system {folded ? '▸' : '▾'}
          </Kind>
          {!folded && system.map(link)}
        </Group>
      </Side>
      {form ? <NewForm kind={kind} /> : <Index kind={kind} query={query} />}
    </Frame>
  )
}
