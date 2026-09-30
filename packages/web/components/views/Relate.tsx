import { useEffect, useRef, useState } from 'preact/hooks'
import { type Ent, uuid } from '../../types.ts'
import { link } from '../../edge.ts'
import { up } from './Dependency.tsx'
import { spec, taskChanges } from '../../client.ts'
import { block } from '@yaks/ui'
import { Float } from '@yaks/ui'
import { label, pickLine, useHits } from '@yaks/ux'
import { drafts, useDraft } from '../drafts.ts'
import { bundlesOf } from '../../wire.ts'
import { rows } from '../hits.ts'
import { ux } from '../registry.ts'

let Frame = block('span', 'Relate', {
  Verb: 'button',
  Anchor: 'span',
  Pop: 'span',
  Find: 'input',
  Row: 'span',
  New: 'span',
})
let { Verb, Anchor, Pop, Find, Row, New } = Frame

// The sentences a task grows an edge by — parent-first, the same
// grammar Dependency renders. out: this task is the parent.
let verbs = [
  { type: 'requires', out: true },
  { type: 'requires', out: false },
  { type: 'contains', out: true },
  { type: 'contains', out: false },
  { type: 'reads', out: true },
  { type: 'about', out: true },
] as const
type V = (typeof verbs)[number]

// A verb as it reads: the relation's name from the parent's side, its
// reversed phrase from the child's ('required by', 'contained by').
let said = (v: V) => v.out ? v.type : up(v.type)

// Add an edge by finishing its sentence: pick a verb chip, then type —
// the list is a live search over documented entities; Enter (or a click)
// links the pick, and text that matches nothing becomes a NEW task, spec-parsed
// (`P1 .domain=Eng title` works here), created and linked in one atomic
// apply, inheriting the host's project and domain. The list overlays —
// nothing below it moves.
export let Relate = ({ e }: { e: Ent }) => {
  // A verb whose line is half-typed stays open — a new task or edge not yet
  // filed, typed here before a reload, in another tab or in the terminal
  // (../drafts.ts). Keyed by (host, verb) so the sentence resumes exact. A
  // verb picked here takes the keyboard; one its draft opened waits.
  let dk = (v: V) => `relate:${e.eid}:${said(v)}`
  let [picked, setVerb] = useState<V | null>(null)
  let verb = picked ?? verbs.find((v) => drafts.text(dk(v))) ?? null
  let [q, setQ] = useState('')
  let [pick, setPick] = useState(0)
  // The Find input doubles as the picker's anchor; focus it when a verb
  // opens it (it only mounts then), the way Search takes the palette.
  let find = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (picked) find.current?.focus()
  }, [picked])
  let { sync, spend } = useDraft(verb ? dk(verb) : '', find, setQ)
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
  // Candidates come from the server (@yaks/ux useHits): FTS over every doc plus
  // id-addressing, so a typed id, title word, or dot-filter names an entity
  // even when the cache holds only part of the graph. An unopened verb (no
  // line) searches nothing; already-linked targets and the host drop out.
  let hits = useHits(verb ? pickLine(q) : '', 8, rows)
    .filter((h) => !taken.has(h.entity.eid))
    .slice(0, 6)
  let fresh = q.trim() ? spec(q).title : ''

  let edge = (v: V, other: string) =>
    v.out ? link(e.eid, v.type, other) : link(other, v.type, e.eid)
  let tie = (other: string) => {
    if (verb) spend(bundlesOf(edge(verb, other)))
    close()
  }
  let create = () => {
    if (!verb || !fresh) return
    let { title, body, grouped } = spec(q)
    let id = uuid()
    spend(bundlesOf([
      ...taskChanges(id, {
        ...grouped,
        doc: { title, body, ...grouped.doc },
        task: { ...grouped.task },
        filed: {
          project: e.filed?.project ?? null,
          domain: e.filed?.domain ?? null,
        },
      }, true),
      ...edge(verb, id),
    ]))
    close()
  }
  let key = (ev: KeyboardEvent) => {
    if (ev.key == 'Escape') {
      spend()
      return close()
    }
    if (ev.key == 'Enter') {
      ev.preventDefault()
      return hits[pick] ? tie(hits[pick].entity.eid) : create()
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
            key={said(v)}
            mod={v.type}
            type='button'
            onClick={() => setVerb(v)}
          >
            + {said(v)}
          </Verb>
        ))}
      </Frame>
    )
  }
  return (
    <Frame>
      <Verb mod={verb.type} type='button' onClick={close}>{said(verb)}</Verb>
      <Anchor>
        <Find
          elRef={find}
          placeholder='entity…'
          onInput={(ev: InputEvent) => {
            sync(ev.currentTarget as HTMLInputElement)
            setPick(0)
          }}
          onKeyDown={key}
          onBlur={close}
        />
        {(hits.length || fresh) && (
          <Float anchor={find} side='below'>
            <Pop>
              {hits.map((t, i) => (
                <Row
                  key={t.entity.eid}
                  mod={i == pick && 'sel'}
                  onMouseEnter={() => setPick(i)}
                  onMouseDown={(ev: MouseEvent) =>
                    grab(ev, () => tie(t.entity.eid))}
                >
                  {label(ux, t)}
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
          </Float>
        )}
      </Anchor>
    </Frame>
  )
}
