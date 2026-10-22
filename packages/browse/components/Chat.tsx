// The document-side conversation: indexed cited-entity associations above one
// actor's selected Session. The binding is graph data on the session, so a
// reload or another browser finds the same transcript. On a persona the
// conversation is with it: a message to it begins a native session wearing it
// on the host's default model (D-130780), as `yak session new --persona`
// does. On any other document the chat plan picks a provider.
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { sessionFrames } from '../client.ts'
import { mutate, myActor, rowsSub, uuid } from '../live.ts'
import { catalog, type Provider, usingOf } from '../providers.ts'
import type { Change, Ent } from '../types.ts'
import { block, Field } from '@yaks/ui'
import { Entity } from './Entity.tsx'
import { Rows } from '@yaks/ui'
import { liveBlocked, load, nativeUsing, providers } from './Run.tsx'
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
  ps: Provider[],
  blocked: (name: string) => boolean,
) => {
  let ready = (name: string) =>
    ['codex', 'ollama'].includes(name) && !blocked(name)
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
        <Rows>
          {items.map((item) => (
            <Rows.Item key={item.eid}>
              <ReferenceRow eid={item.eid} />
            </Rows.Item>
          ))}
        </Rows>
      </References>
    )
    : null
}

// Who a chat on `e` talks to: `e` itself when it is a persona, so a chat
// there is a message to it (D-130780); no one in particular otherwise.
export let voiceOf = (e: Ent): string | undefined =>
  e.persona ? e.eid : undefined

// A chat is opened by the person typing its first ask, bound to this actor
// and document; one sent to a persona is native and wears it. A new one
// unbinds the old.
export let chatChanges = (
  old: string | undefined,
  session: string,
  actor: string,
  target: string,
  using: { provider: string; model?: string; effort?: string },
  body: string,
  persona?: string,
): Change[] => [
  ...(old ? [{ eid: old, name: 'chat', comp: null } as Change] : []),
  ...sessionFrames(session, body, using, {
    operator: true,
    persona,
    native: !!persona,
  }),
  { eid: session, name: 'chat', comp: { actor, target } },
]

// The provider and model a document's chat runs on, by the chat plan.
let planned = async () => {
  if (!providers.value.length) await load()
  return usingOf(
    providers.value,
    chatPlan(providers.value, await liveBlocked()),
  )
}

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
      let persona = voiceOf(e)
      let using = persona ? await nativeUsing() : await planned()
      mutate(...chatChanges(old, uuid(), actor, e.eid, using, body, persona))
      done()
    } catch (error) {
      setState(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <Start>
      <Field
        lines
        elRef={box}
        rows={3}
        placeholder={voiceOf(e)
          ? `message ${e.doc?.title || 'this persona'}…`
          : 'start a chat…'}
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
