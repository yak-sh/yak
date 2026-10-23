import { useEffect, useRef, useState } from 'preact/hooks'
import { relations, reversed } from '@yaks/edge/vocab'
import { type Ent, uuid, vocab } from '../../types.ts'
import { link } from '../../edge.ts'
import { up } from './Dependency.tsx'
import { spec, taskChanges } from '../../client.ts'
import { block } from '@yaks/ui'
import { Float } from '@yaks/ui'
import { label, pickLine, useHits } from '@yaks/ux'
import { drafts, useDraft } from '@yaks/draft/input'
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

// A sentence an entity grows a link by: a relation, and which end the entity
// is (out: it is the parent), the same grammar Dependency renders.
type V = { type: string; out: boolean }

// Every relation the vocabulary declares and the wire may write (not a
// computed one, not the meta vocabulary's), read off the vocabulary each time
// so a relation declared today is offered today: forwards by its name, and
// from the child's side too where it declares a phrase for that ('required
// by').
export let verbs = (): V[] => {
  let back = reversed(vocab)
  return Object.entries(relations(vocab)).filter(([, name]) => {
    let c = vocab.comp(name)
    return c?.wire && !c.computed
  }).flatMap(([type]) => [
    { type, out: true },
    ...(back[type] ? [{ type, out: false }] : []),
  ])
}

// A verb as it reads: the relation's name from the parent's side, its
// reversed phrase from the child's ('required by', 'contained by').
let said = (v: V) => v.out ? v.type : up(v.type)

// Add a link by finishing its sentence: press `+ link` and pick its relation
// from every one declared (typing narrows them), then type its far end — the
// list is a live search over documented entities; Enter (or a click) links
// the pick, and text that matches nothing becomes a NEW task, spec-parsed
// (`P1 .filed.domain=Eng title` works here), created and linked in one atomic
// apply, inheriting the host's project and domain. Both lists overlay —
// nothing below them moves.
export let Relate = ({ e }: { e: Ent }) => {
  // A verb whose line is half-typed stays open — a new task or edge not yet
  // filed, typed here before a reload, in another tab or in the terminal
  // (../drafts.ts). Keyed by (host, verb) so the sentence resumes exact. A
  // verb picked here takes the keyboard; one its draft opened waits.
  let all = verbs()
  let dk = (v: V) => `relate:${e.eid}:${said(v)}`
  let [picked, setVerb] = useState<V | 'choose' | null>(null)
  let choosing = picked == 'choose'
  let verb = picked == 'choose'
    ? null
    : picked ?? all.find((v) => drafts.text(dk(v))) ?? null
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
  let fresh = verb && q.trim() ? spec(q).title : ''
  // While choosing, the relations whose sentence holds what is typed.
  let options = choosing
    ? all.filter((v) => said(v).includes(q.trim().toLowerCase()))
    : []
  let choose = (v: V) => {
    if (find.current) find.current.value = ''
    setVerb(v)
    setQ('')
    setPick(0)
  }

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
      if (choosing) return options[pick] && choose(options[pick])
      return hits[pick] ? tie(hits[pick].entity.eid) : create()
    }
    let d = ev.key == 'ArrowDown' ? 1 : ev.key == 'ArrowUp' ? -1 : 0
    if (!d) return
    ev.preventDefault()
    let last = choosing ? options.length - 1 : hits.length - (fresh ? 0 : 1)
    setPick((p) => Math.min(Math.max(p + d, 0), last))
  }
  let grab = (ev: MouseEvent, go: () => void) => {
    ev.preventDefault() // keep focus — the click must land before any blur
    go()
  }

  if (!verb && !choosing) {
    return (
      <Frame>
        <Verb type='button' onClick={() => setVerb('choose')}>+ link</Verb>
      </Frame>
    )
  }
  return (
    <Frame>
      <Verb mod={verb?.type} type='button' onClick={close}>
        {verb ? said(verb) : '+ link'}
      </Verb>
      <Anchor>
        <Find
          elRef={find}
          placeholder={verb ? 'entity…' : 'relation…'}
          onInput={(ev: InputEvent) => {
            let el = ev.currentTarget as HTMLInputElement
            sync(el)
            setQ(el.value)
            setPick(0)
          }}
          onKeyDown={key}
          onBlur={close}
        />
        {(options.length || hits.length || fresh) && (
          <Float anchor={find} side='below'>
            <Pop>
              {options.map((v, i) => (
                <Row
                  key={said(v)}
                  mod={[v.type, i == pick && 'sel']}
                  onMouseEnter={() => setPick(i)}
                  onMouseDown={(ev: MouseEvent) =>
                    grab(ev, () =>
                      choose(v))}
                >
                  {said(v)}
                </Row>
              ))}
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
