// The document-side conversation: indexed cited-entity associations above one
// actor's selected graph-native Session. The binding is graph data on the
// session, so a reload or another browser finds the same transcript.
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { sessionFrames } from '../client.ts'
import { capable, ent, mutate, myActor, rowsSub, uuid } from '../live.ts'
import { catalog, type Provider } from '../providers.ts'
import type { Change, Ent } from '../types.ts'
import { block } from './ui.tsx'
import { ComposerInput } from './Comments.tsx'
import { Entity } from './Entity.tsx'
import { ListFrame } from './ListFrame.tsx'
import { liveBlocked, load, providers } from './Run.tsx'
import { useChatFor, useReferences } from './useQuery.ts'

let Frame = block('aside', 'Chat', {
  References: 'section',
  Label: 'h2',
  Head: 'div',
  New: 'button',
  Start: 'div',
  State: 'p',
})
let { References, Label, Head, New, Start, State } = Frame

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

// A tile reads the row alone, never its edges: a referencing session's bare
// route carried its hundred edges, 4.8 KB and the last frame of a page load.
export let ReferenceRow = ({ eid }: { eid: string }) => (
  <Entity eid={eid} view='List.Tile' />
)

// The list holds its rows in ONE sub (live.ts rowsSub): ten referencing
// sessions were ten route subs and ten frames after the edges answered. A
// list whose rows already RIDE the citation answer as peers (useQuery
// REFERENCE_PEERS: the referencing sessions of a task) is `held` and asks for
// nothing more, so it paints from the edges frame itself.
export let ReferenceList = (
  { label, items, held }: {
    label: string
    items: { eid: string }[]
    held?: boolean
  },
) => {
  let key = held ? '' : items.map((i) => i.eid).join(',')
  useLayoutEffect(() => rowsSub(key ? key.split(',') : []), [key])
  return items.length
    ? (
      <References>
        <Label>{label}</Label>
        <ListFrame>
          {items.map((item) => (
            <ListFrame.Row key={item.eid}>
              <ReferenceRow eid={item.eid} />
            </ListFrame.Row>
          ))}
        </ListFrame>
      </References>
    )
    : null
}

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

export let Starter = (
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
      <ComposerInput
        elRef={box}
        rows={3}
        placeholder='start a chat…'
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
  let cited = useReferences(e.eid)
  let selected = useChatFor(actor, e.eid)
  let [fresh, setFresh] = useState(false)
  return (
    <Frame>
      <ReferenceList label='references' items={cited.out} />
      <ReferenceList label='referenced by' items={cited.in} held />
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
