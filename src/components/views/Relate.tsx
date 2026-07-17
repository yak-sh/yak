import { useState } from 'preact/hooks'
import { type Ent, uuid } from '../../types.ts'
import { cache, ent, mutate } from '../../live.ts'
import { spec, taskChanges } from '../../client.ts'
import { block, focus } from '../ui.tsx'

let Frame = block('span', 'Relate', {
  Verb: 'button',
  Anchor: 'span',
  Pop: 'span',
  Find: 'input',
  Row: 'span',
  New: 'span',
})
let { Verb, Anchor, Pop, Find, Row, New } = Frame

// The five sentences a task grows an edge by — parent-first, the same
// grammar Dependency renders. out: this task is the parent.
let verbs = [
  { label: 'requires', type: 'requires', out: true },
  { label: 'blocks', type: 'requires', out: false },
  { label: 'contains', type: 'contains', out: true },
  { label: 'part of', type: 'contains', out: false },
  { label: 'reads', type: 'reads', out: true },
] as const
type V = (typeof verbs)[number]

// Add an edge by finishing its sentence: pick a verb chip, then type —
// the list is a live search over tasks; Enter (or a click) links the
// pick, and text that matches nothing becomes a NEW task, spec-parsed
// (`P1 .domain=Eng title` works here), created and linked in one atomic
// apply, inheriting the host's project and domain. The list overlays —
// nothing below it moves.
export let Relate = ({ e }: { e: Ent }) => {
  let [verb, setVerb] = useState<V | null>(null)
  let [q, setQ] = useState('')
  let [pick, setPick] = useState(0)
  let close = () => {
    setVerb(null)
    setQ('')
    setPick(0)
  }
  let taken = new Set([
    e.eid,
    ...e.refs.map((r) => r.child),
    ...e.kids.map((k) => k.eid),
  ])
  let hits = !verb ? [] : Object.keys(cache.value)
    .map(ent)
    .filter((t) => t.task && !taken.has(t.eid))
    .filter((t) =>
      !q || (t.doc?.title ?? '').toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => b.num - a.num)
    .slice(0, 6)
  let fresh = q.trim() ? spec(q).title : ''

  let edge = (v: V, other: string) =>
    v.out
      ? {
        eid: e.eid,
        name: 'dependency',
        comp: { type: v.type, child_eid: other },
      }
      : {
        eid: other,
        name: 'dependency',
        comp: { type: v.type, child_eid: e.eid },
      }
  let link = (other: string) => {
    if (verb) mutate(edge(verb, other))
    close()
  }
  let create = () => {
    if (!verb || !fresh) return
    let { title, body, grouped } = spec(q)
    let id = uuid()
    mutate(
      ...taskChanges(id, {
        ...grouped,
        doc: { title, body, ...grouped.doc },
        task: {
          project_eid: e.task?.project_eid ?? null,
          domain: e.task?.domain ?? null,
          ...grouped.task,
        },
      }),
      edge(verb, id),
    )
    close()
  }
  let key = (ev: KeyboardEvent) => {
    if (ev.key == 'Escape') return close()
    if (ev.key == 'Enter') {
      ev.preventDefault()
      return hits[pick] ? link(hits[pick].eid) : create()
    }
    let d = ev.key == 'ArrowDown' ? 1 : ev.key == 'ArrowUp' ? -1 : 0
    if (!d) return
    ev.preventDefault()
    setPick((p) => Math.min(Math.max(p + d, 0), hits.length - (fresh ? 0 : 1)))
  }
  let grab = (ev: MouseEvent, go: () => void) => {
    ev.preventDefault() // keep focus — the click must land before any blur
    go()
  }

  if (!verb) {
    return (
      <Frame>
        {verbs.map((v) => (
          <Verb
            key={v.label}
            type='button'
            onClick={() => setVerb(v)}
          >
            + {v.label}
          </Verb>
        ))}
      </Frame>
    )
  }
  return (
    <Frame>
      <Verb mod='on' type='button' onClick={close}>{verb.label}</Verb>
      <Anchor>
        <Find
          elRef={focus}
          placeholder='task…'
          onInput={(ev: InputEvent) => {
            setQ((ev.currentTarget as HTMLInputElement).value)
            setPick(0)
          }}
          onKeyDown={key}
          onBlur={close}
        />
        <Pop>
          {hits.map((t, i) => (
            <Row
              key={t.eid}
              mod={i == pick && 'sel'}
              onMouseEnter={() => setPick(i)}
              onMouseDown={(ev: MouseEvent) => grab(ev, () => link(t.eid))}
            >
              {t.doc?.title || t.kind}
            </Row>
          ))}
          {fresh && (
            <New
              mod={pick == hits.length && 'sel'}
              onMouseEnter={() => setPick(hits.length)}
              onMouseDown={(ev: MouseEvent) => grab(ev, create)}
            >
              + new “{fresh}”
            </New>
          )}
        </Pop>
      </Anchor>
    </Frame>
  )
}
