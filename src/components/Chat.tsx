// The document-side conversation: indexed cited-entity associations above one
// actor's selected graph-native Session. The binding is graph data on the
// session, so a reload or another browser finds the same transcript.
import { useRef, useState } from 'preact/hooks'
import { sessionFrames } from '../client.ts'
import {
  capable,
  chatFor,
  ent,
  mutate,
  myActor,
  references,
  uuid,
} from '../live.ts'
import { catalog, type Provider } from '../providers.ts'
import type { Change, Ent } from '../types.ts'
import { block } from './ui.tsx'
import { follow } from './nav.tsx'
import { Entity } from './Entity.tsx'
import { liveBlocked, load, providers } from './Run.tsx'

let Frame = block('aside', 'Chat', {
  References: 'section',
  Label: 'h2',
  Links: 'div',
  Link: 'a',
  Head: 'div',
  New: 'button',
  Start: 'div',
  Box: 'textarea',
  State: 'p',
})
let { References, Label, Links, Link, Head, New, Start, Box, State } = Frame

export let chatPlan = (
  operator: Ent,
  ps: Provider[],
  blocked: (name: string) => boolean,
) => {
  let ready = (name: string) =>
    ['codex', 'ollama'].includes(name) && !blocked(name) &&
    ps.find((p) => p.name == name)?.ready !== false
  let pick = catalog(ps).find((p) => p.transports.some(ready))
  let provider = pick?.transports.find(ready)
  if (!pick || !provider) {
    throw new Error('No graph-native chat model is available')
  }
  let effort = pick.efforts.length
    ? (pick.efforts.includes('medium') ? 'medium' : pick.efforts[0])
    : undefined
  return {
    provider,
    model: pick.model,
    effort,
    persona: operator.spawn?.persona ?? undefined,
  }
}

let ReferenceList = (
  { label, items }: {
    label: string
    items: { eid: string; id: string; title: string }[]
  },
) =>
  items.length
    ? (
      <References>
        <Label>{label}</Label>
        <Links>
          {items.map((item) => (
            <Link
              key={item.eid}
              href={`/${item.id}`}
              onClick={follow(`/${item.id}`)}
            >
              <span>{item.title || item.id}</span>
              {item.title && <small>{item.id}</small>}
            </Link>
          ))}
        </Links>
      </References>
    )
    : null

export let chatChanges = (
  old: string | undefined,
  session: string,
  actor: string,
  target: string,
  comp: Record<string, unknown>,
  body: string,
  canonical = true,
): Change[] => [
  ...(old ? [{ eid: old, name: 'chat', comp: null } as Change] : []),
  ...(canonical
    ? sessionFrames(session, comp)
    : [{ eid: session, name: 'session', comp }]),
  { eid: session, name: 'chat', comp: { actor, target } },
  { eid: session, name: 'doc', comp: { title: '', body } },
]

let Starter = (
  { e, actor, old, done }: {
    e: Ent
    actor: string
    old?: string
    done: () => void
  },
) => {
  let box = useRef<HTMLTextAreaElement>(null)
  let [state, setState] = useState('')
  let start = async () => {
    let body = box.current?.value.trim() ?? ''
    if (!body || state) return
    setState('Starting chat…')
    try {
      if (!providers.value.length) await load()
      let operator = ent(actor)
      let blocked = await liveBlocked()
      let plan = chatPlan(operator, providers.value, blocked)
      let session = uuid()
      let comp = {
        id: uuid(),
        provider: plan.provider,
        model: plan.model,
        actor,
        ...(plan.effort ? { effort: plan.effort } : {}),
        ...(plan.persona ? { persona: plan.persona } : {}),
      }
      mutate(...chatChanges(
        old,
        session,
        actor,
        e.eid,
        comp,
        body,
        capable('spawn'),
      ))
      done()
    } catch (error) {
      setState(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <Start>
      <Box
        elRef={box}
        rows={3}
        placeholder={`Ask about ${e.doc?.title || 'this document'}…`}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key != 'Enter' || event.shiftKey) return
          event.preventDefault()
          start()
        }}
      />
      {state && <State>{state}</State>}
    </Start>
  )
}

export let Chat = ({ e }: { e: Ent }) => {
  let actor = myActor()
  let cited = references(e.eid)
  let selected = actor ? chatFor(actor, e.eid) : undefined
  let [fresh, setFresh] = useState(false)
  return (
    <Frame>
      <ReferenceList label='references' items={cited.out} />
      <ReferenceList label='referenced by' items={cited.in} />
      {actor && (
        <section class='Chat_Conversation'>
          <Head>
            <Label>chat</Label>
            {selected && (
              <New
                type='button'
                onClick={() => setFresh((value) => !value)}
              >
                {fresh ? 'current chat' : 'new chat'}
              </New>
            )}
          </Head>
          {selected && !fresh
            ? <Entity eid={selected.eid} view='Session' />
            : (
              <Starter
                e={e}
                actor={actor}
                old={selected?.eid}
                done={() => setFresh(false)}
              />
            )}
        </section>
      )}
    </Frame>
  )
}
