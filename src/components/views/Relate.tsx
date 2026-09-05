import { useEffect, useRef, useState } from 'preact/hooks'
import { type Ent, uuid } from '../../types.ts'
import { mutate } from '../../live.ts'
import { link } from '../../edge.ts'
import { spec, taskChanges } from '../../client.ts'
import { peek, useDraft } from '../drafts.ts'
import { block } from '../ui.tsx'
import { Overlay } from '../overlay.tsx'
import { pickLine, useHits } from '../hits.ts'
import * as suggest from '../suggest.ts'

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
  { label: 'requires', type: 'requires', out: true },
  { label: 'blocks', type: 'requires', out: false },
  { label: 'contains', type: 'contains', out: true },
  { label: 'part of', type: 'contains', out: false },
  { label: 'reads', type: 'reads', out: true },
  { label: 'about', type: 'about', out: true },
] as const
type V = (typeof verbs)[number]

// Add an edge by finishing its sentence: pick a verb chip, then type —
// the list is a live search over documented entities; Enter (or a click)
// links the pick, and text that matches nothing becomes a NEW task, spec-parsed
// (`P1 .domain=Eng title` works here), created and linked in one atomic
// apply, inheriting the host's project and domain. The list overlays —
// nothing below it moves.
export let Relate = ({ e }: { e: Ent }) => {
  // On mount, a verb whose line was left half-typed reopens itself — a
  // new task or edge the last mount never filed resurfaces, caret and all
  // (drafts.ts). Keyed by (host, verb) so the sentence resumes exact.
  let dk = (v: V) => `relate:${e.eid}:${v.label}`
  let [verb, setVerb] = useState<V | null>(() =>
    verbs.find((v) => peek(dk(v))) ?? null
  )
  let [q, setQ] = useState('')
  let [pick, setPick] = useState(0)
  // The Find input doubles as the picker's anchor; focus it when a verb
  // opens it (it only mounts then), the way Search takes the palette.
  let find = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (verb) find.current?.focus()
  }, [verb])
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
  // Candidates come from the server (hits.ts): FTS over every doc plus
  // id-addressing, so a typed id, title word, or dot-filter names an entity
  // even when the cache holds only part of the graph. An unopened verb (no
  // line) searches nothing; already-linked targets and the host drop out.
  let hits = useHits(verb ? pickLine(q) : '')
    .filter((h) => !taken.has(h.eid))
    .slice(0, 6)
  let fresh = q.trim() ? spec(q).title : ''

  let edge = (v: V, other: string) =>
    v.out ? link(e.eid, v.type, other) : link(other, v.type, e.eid)
  let tie = (other: string) => {
    if (verb) mutate(...edge(verb, other))
    spend()
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
          project: e.task?.project ?? null,
          domain: e.task?.domain ?? null,
          ...grouped.task,
        },
      }),
      ...edge(verb, id),
    )
    spend()
    close()
  }
  let key = (ev: KeyboardEvent) => {
    if (ev.key == 'Escape') {
      spend()
      return close()
    }
    if (ev.key == 'Enter') {
      ev.preventDefault()
      return hits[pick] ? tie(hits[pick].eid) : create()
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
            mod={v.type}
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
      <Verb mod={verb.type} type='button' onClick={close}>{verb.label}</Verb>
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
          <Overlay anchor={find} side='below'>
            <Pop>
              {hits.map((t, i) => (
                <Row
                  key={t.eid}
                  mod={i == pick && 'sel'}
                  onMouseEnter={() => setPick(i)}
                  onMouseDown={(ev: MouseEvent) => grab(ev, () => tie(t.eid))}
                >
                  {suggest.label(t)}
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
          </Overlay>
        )}
      </Anchor>
    </Frame>
  )
}
