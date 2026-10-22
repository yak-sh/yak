// New: Debug on an empty entity. A person adds components by searching the
// vocabulary, types or picks each property, and may outline more entities
// like it, one a line, nested by indent. The batch they become shows as it is
// typed and is written whole on Create, held until the server takes it, so a
// refusal lands beside the field it names and nothing half-made shows. What
// is typed is the person's draft (../new.ts), kept and seen in every
// interface. Every control is a kit field or button, so a terminal draws and
// drives the same page.
import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import * as ui from '@yaks/ui'
import { label, pickLine, reading, useHits } from '@yaks/ux'
import { drafts } from '@yaks/draft/input'
import type { Bundle } from '@yaks/graph'
import {
  ent,
  findEid,
  relations,
  resolveGen,
  resolvingId,
  serverEid,
  submit,
  useHold,
} from '../live.ts'
import {
  comps,
  EID,
  IdError,
  idOf,
  kindOf,
  type PropType,
  typeName,
  vocab,
} from '../types.ts'
import { entityPath } from '../url.ts'
import {
  type At,
  type Batch,
  batch,
  find,
  like,
  placed,
  placeOf,
  press,
  type Said,
  type Sketch,
  sketchOf,
  textOf,
  written,
} from '../new.ts'
import { ux } from './registry.ts'
import { navigate } from './nav.tsx'
import { useReference } from './subscriptions.ts'
import { Id } from './views/Inline.tsx'

let Frame = ui.block('form', 'New', {
  Context: 'p',
  None: 'span',
  Said: 'p',
  Writes: 'pre',
  Bar: 'div',
})
let { Context, None, Writes, Bar } = Frame
let { Item, Text, Note } = ui.Choices

// What can't be written as it stands, said in its place.
let Says = ({ said }: { said: Said[] }) => (
  <>
    {said.map((s, i) => (
      <Frame.Said key={i}>
        {s.line != null && `line ${s.line + 1}: `}
        {s.said}
      </Frame.Said>
    ))}
  </>
)

// An id as the address writes it, as an eid: the cache's, else the
// server's (resolveGen wakes this when it answers); nothing for one that
// names nothing.
let eidOf = (id?: string) => {
  if (!id) return undefined
  resolveGen.value
  try {
    return findEid(id) ?? serverEid(id)
  } catch (error) {
    if (error instanceof IdError) return undefined
    throw error
  }
}

// Where a new child goes in an entity's list: after what it holds.
let next = (eid?: string) => {
  if (!eid) return 0
  let kids = relations(eid).value.filter((d) => d.type == 'contains')
  return Math.max(kids.length, ...kids.map((d) => (d.ord ?? -1) + 1))
}

// A property's typed text as its value, in the fleet's input language (P2, a
// relative time, a human id); throws what it cannot read.
let read = (comp: string, prop: string, text: string) =>
  (reading(ux, { entity: { eid: '$1' } }, comp, prop, text)[comp] as Record<
    string,
    unknown
  >)[prop]

// An eid as a person reads it, for what the batch shows; nothing for text.
let named = (v: string) => EID.test(v) ? idOf(ent(v)) : undefined

// A row a keyboard can take in both hosts: Enter or a press picks it.
let pickable = (pick: () => void) => ({
  role: 'button',
  tabIndex: 0,
  onClick: pick,
  onKeyDown: (ev: KeyboardEvent) => {
    if (ev.key != 'Enter' && ev.key != ' ') return
    ev.preventDefault()
    pick()
  },
})

// A search field whose Enter takes its first answer rather than the form's.
let Find = (
  { place, hint, first }: { place: string; hint: string; first: () => void },
) => (
  <ui.Field
    value={drafts.text(place)}
    placeholder={hint}
    onInput={(ev: InputEvent) =>
      drafts.type(place, (ev.currentTarget as HTMLInputElement).value)}
    onKeyDown={(ev: KeyboardEvent) => {
      if (ev.key != 'Enter') return
      ev.preventDefault()
      first()
    }}
  />
)

// A reference: the entity picked, with a way to let it go; or a search of
// the graph for the kind it names.
let Ref = (
  { place, kind, text, set }: {
    place: string
    kind: string
    text: string
    set: (text: string) => void
  },
) => {
  let q = drafts.text(place)
  let hits = useHits(
    pickLine(q, kind == 'entity' ? '' : kind),
    6,
    ux.find,
    ux.settle,
  )
  let held = useReference(text || undefined).value
  let pick = (b?: Bundle) => {
    if (!b) return
    set(b.entity.eid)
    void drafts.spend(place)
  }
  if (text) {
    return (
      <>
        <Id e={held ?? ent(text)} /> {held?.doc?.title ?? ''}{' '}
        <ui.Button
          type='button'
          mod='quiet'
          aria-label={`clear ${kind}`}
          onClick={() => set('')}
        >
          ×
        </ui.Button>
      </>
    )
  }
  return (
    <>
      <Find place={place} hint={`find ${kind}…`} first={() => pick(hits[0])} />
      {q.trim() && (
        <ui.Choices>
          {hits.map((b) => (
            <Item
              key={b.entity.eid}
              {...pickable(() => pick(b))}
            >
              <Text>{label(ux, b)}</Text>
            </Item>
          ))}
        </ui.Choices>
      )}
    </>
  )
}

// A closed set: its members, the one held marked; pressing it again lets it
// go.
let Pick = (
  { values, text, set }: {
    values: readonly string[]
    text: string
    set: (text: string) => void
  },
) => (
  <ui.Tabs>
    {values.map((v) => (
      <ui.Tabs.Tab
        key={v}
        type='button'
        mod={v == text && 'on'}
        onClick={() => set(v == text ? '' : v)}
      >
        {v}
      </ui.Tabs.Tab>
    ))}
  </ui.Tabs>
)

// A property's control, as its type says: typed, picked from a closed set,
// or a reference found in the graph.
let Input = (
  { type, place, text, set }: {
    type: PropType
    place: string
    text: string
    set: (text: string) => void
  },
) =>
  type == 'bool'
    ? <Pick values={['true', 'false']} text={text} set={set} />
    : typeof type == 'object' && 'enum' in type
    ? <Pick values={type.enum} text={text} set={set} />
    : typeof type == 'object' && 'eid' in type
    ? <Ref place={place} kind={type.eid} text={text} set={set} />
    : (
      <ui.Field
        lines={type == 'body'}
        value={text}
        placeholder={typeName(type)}
        onInput={(ev: InputEvent) =>
          set((ev.currentTarget as HTMLInputElement).value)}
      />
    )

// The sketch's components, a row per property, each with what is said of
// it; a component with nothing to type is one row.
let Fields = (
  { s, place, said, put }: {
    s: Sketch
    place: string
    said: Said[]
    put: (s: Sketch) => void
  },
) => (
  <ui.Pairs>
    {Object.entries(s.comps).flatMap(([comp, typed]) => {
      let props = Object.entries(comps[comp] ?? {})
      let drop = (
        <ui.Button
          type='button'
          mod='quiet'
          aria-label={`remove ${comp}`}
          onClick={() => {
            let { [comp]: _, ...rest } = s.comps
            put({ ...s, comps: rest })
          }}
        >
          ×
        </ui.Button>
      )
      let row = (key: string, value: ComponentChildren, first: boolean) => [
        <ui.Pairs.Key key={`${key}:k`}>{key}{first && drop}</ui.Pairs.Key>,
        <ui.Pairs.Value key={`${key}:v`}>{value}</ui.Pairs.Value>,
      ]
      if (!props.length) return row(comp, <None>no properties</None>, true)
      return props.flatMap(([prop, type], i) =>
        row(
          `${comp}.${prop}`,
          <>
            <Input
              type={type}
              place={`${place}|${comp}.${prop}`}
              text={typed[prop] ?? ''}
              set={(text) =>
                put({
                  ...s,
                  comps: { ...s.comps, [comp]: { ...typed, [prop]: text } },
                })}
            />
            <Says said={said.filter((x) => x.comp == comp && x.prop == prop)} />
          </>,
          i == 0,
        )
      )
    })}
  </ui.Pairs>
)

// Adding a component: a search of the vocabulary, each answer shown as
// `comp{prop, …}` and what it is.
let Add = (
  { s, place, put }: { s: Sketch; place: string; put: (s: Sketch) => void },
) => {
  let at = `${place}|find`
  let hits = find(vocab, drafts.text(at), Object.keys(s.comps))
  let add = (name?: string) => {
    if (!name) return
    put({ ...s, comps: { ...s.comps, [name]: {} } })
    void drafts.spend(at)
  }
  return (
    <>
      <Find
        place={at}
        hint='add a component: type to search the vocabulary'
        first={() => add(hits[0]?.name)}
      />
      {drafts.text(at).trim() && (
        <ui.Choices>
          {hits.map((h) => (
            <Item key={h.name} {...pickable(() => add(h.name))}>
              <Text>{h.signature}</Text>
              <Note>{h.about}</Note>
            </Item>
          ))}
        </ui.Choices>
      )}
    </>
  )
}

// The outline: Enter keeps the line's indent, Tab and Shift+Tab move the
// line in and out, Escape leaves the field.
let Outline = (
  { s, put }: { s: Sketch; put: (s: Sketch) => void },
) => (
  <ui.Field
    lines
    value={s.outline}
    placeholder='Outline: one entity a line, like this one; indent a line to put it in the one above'
    onInput={(ev: InputEvent) =>
      put({ ...s, outline: (ev.currentTarget as HTMLTextAreaElement).value })}
    onKeyDown={(ev: KeyboardEvent) => {
      let el = ev.currentTarget as HTMLTextAreaElement
      if (ev.key == 'Escape') return el.blur()
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      let to = press(el.value, el.selectionStart ?? 0, ev.key, ev.shiftKey)
      if (!to) return
      ev.preventDefault()
      el.value = to.text
      el.setSelectionRange(to.at, to.at)
      el.setAttribute('data-caret', String(to.at))
      put({ ...s, outline: to.text })
    }}
  />
)

// Where it is made, said once at the top.
let Where = ({ inEid, likeEid }: { inEid?: string; likeEid?: string }) =>
  inEid || likeEid
    ? (
      <Context>
        {inEid && (
          <>
            in <Id e={ent(inEid)} /> {ent(inEid).doc?.title ?? ''}
            {' '}
          </>
        )}
        {likeEid && likeEid != inEid && (
          <>
            like <Id e={ent(likeEid)} /> {ent(likeEid).doc?.title ?? ''}
          </>
        )}
      </Context>
    )
    : null

// The id a made entity is read by, from the server's answer.
let madeId = (applied: Bundle[], alias?: string) => {
  let b = applied.find((x) => x.$alias == alias)
  return b &&
    idOf({ eid: b.entity.eid, kind: kindOf(b), num: Number(b.entity.num) })
}

// The entity to open once the batch is made: the sketch's own, else the one
// its outline went into, else its first line's.
let opened = (applied: Bundle[], b: Batch, inEid?: string) => {
  let [first] = b.made
  return first?.line == null
    ? madeId(applied, first?.alias)
    : inEid
    ? idOf(ent(inEid))
    : madeId(applied, first.alias)
}

export let New = ({ at }: { at: At }) => {
  useHold(at.in && { entity: at.in }, at.like && { entity: at.like })
  let inEid = eidOf(at.in), likeEid = eidOf(at.like ?? at.in)
  let form = useRef<HTMLFormElement>(null)
  let [refused, setRefused] = useState<Said>()
  let [busy, setBusy] = useState(false)
  let lost = [at.in, at.like].find((id) => id && !eidOf(id))
  // The keyboard goes to the first field once there is one.
  useLayoutEffect(() => {
    form.current?.querySelector<HTMLElement>('input,textarea')?.focus()
  }, [!!lost])
  if (lost) {
    return resolvingId(lost)
      ? <ui.Loading>Loading {lost}…</ui.Loading>
      : <p>{lost} names nothing here.</p>
  }
  let where: At = { in: inEid, like: at.like ? likeEid : undefined }
  let place = placeOf(where)
  let seed = likeEid ? like(vocab, ent(likeEid)) : { comps: {}, outline: '' }
  let s = sketchOf(drafts.text(place)) ?? seed
  let put = (next: Sketch) => {
    setRefused(undefined)
    drafts.type(place, textOf(next))
  }
  let nests = !!vocab.comp('contains')
  let b = batch(s, { vocab, read, in: inEid, ord: next(inEid) })
  let said = [...b.said, ...refused ? [refused] : []]
  let loose = said.filter((x) => !x.comp)
  let ready = b.bundles.length > 0 && !b.said.length && !busy
  let create = async (ev?: Event) => {
    ev?.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      let applied = await submit(b.bundles)
      void drafts.spend(place)
      let to = opened(applied, b, inEid)
      if (to) navigate(entityPath(to))
    } catch (error) {
      setRefused(placed(error, b, s))
    } finally {
      setBusy(false)
    }
  }
  let entities = b.made.length, links = b.bundles.length - entities
  return (
    <Frame
      elRef={form}
      onSubmit={create}
      onKeyDown={(ev: KeyboardEvent) => {
        if (ev.key == 'Enter' && (ev.ctrlKey || ev.metaKey || ev.altKey)) {
          void create(ev)
        }
      }}
    >
      <Where inEid={inEid} likeEid={likeEid} />
      <Fields s={s} place={place} said={said} put={put} />
      <Add s={s} place={place} put={put} />
      {nests && <Outline s={s} put={put} />}
      {entities > 0 && (
        <ui.Section>
          <ui.Section.Title>
            Writes
            <ui.Section.Count>
              {entities} {entities == 1 ? 'entity' : 'entities'}
              {links > 0 && `, ${links} ${links == 1 ? 'link' : 'links'}`}
            </ui.Section.Count>
          </ui.Section.Title>
          <Writes>{b.bundles.map((x) => written(x, named)).join('\n')}</Writes>
        </ui.Section>
      )}
      <Says said={loose} />
      <Bar>
        <ui.Button type='submit' mod='go' disabled={!ready}>
          {busy ? 'Creating…' : 'Create'}
        </ui.Button>
        <ui.Button
          type='button'
          mod='quiet'
          onClick={() => {
            setRefused(undefined)
            void drafts.spend(place)
          }}
        >
          Discard
        </ui.Button>
      </Bar>
    </Frame>
  )
}
