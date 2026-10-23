// The document-side conversation: indexed cited-entity associations above one
// actor's selected Session. The binding is graph data on the session, so a
// reload or another browser finds the same transcript. On a persona the
// conversation is with it: a message to it begins a native session wearing it
// on the host's default model (D-130780), as `yak session new --persona`
// does. On a topic it is with the oracle, the session opened on the topic
// (D-131941), as `yak session new --topic` does. On any other document the
// chat plan picks a provider. The conversation alone is `Conversation`, the
// part a topic's page asks its host for.
import { useRef, useState } from 'preact/hooks'
import { ORACLE } from '@yaks/topic'
import { sessionFrames } from '../client.ts'
import { mutate, myActor, useHold, uuid } from '../live.ts'
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
  Box: 'div',
})
let { References, Label, Head, New, Start, State, Box } = Frame

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
  useHold(!held && items.length > 0 && { rows: items.map((i) => i.eid) })
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

/** Who a chat talks to, and what about: the persona its session wears, and
 * the topic it is opened on. */
export type Voice = { persona: string; topic?: string }

// Who a chat on `e` talks to: `e` itself when it is a persona, so a chat
// there is a message to it (D-130780); the oracle when it is a topic, about
// that topic (D-131941); no one in particular otherwise.
export let voiceOf = (e: Ent): Voice | undefined =>
  e.persona
    ? { persona: e.eid }
    : e.topic
    ? { persona: ORACLE, topic: e.eid }
    : undefined

// A chat is opened by the person typing its first ask, bound to this actor
// and document; one sent to a persona or a topic is native and wears the
// persona, opened on the topic. A new one unbinds the old.
export let chatChanges = (
  old: string | undefined,
  session: string,
  actor: string,
  target: string,
  using: { provider: string; model?: string; effort?: string },
  body: string,
  voice?: Voice,
): Change[] => [
  ...(old ? [{ eid: old, name: 'chat', comp: null } as Change] : []),
  ...sessionFrames(session, body, using, {
    operator: true,
    ...voice,
    native: !!voice,
  }),
  { eid: session, name: 'chat', comp: { actor, target } },
]

// What the first line says it starts.
let invite = (e: Ent): string => {
  let voice = voiceOf(e)
  return voice?.topic
    ? `ask about ${e.doc?.title || 'this topic'}…`
    : voice
    ? `message ${e.doc?.title || 'this persona'}…`
    : 'start a chat…'
}

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
      let voice = voiceOf(e)
      let using = voice ? await nativeUsing() : await planned()
      mutate(...chatChanges(old, uuid(), actor, e.eid, using, body, voice))
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
        placeholder={invite(e)}
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

// This actor's conversation on `e`: the session it last bound here, or a
// line to start one. Nothing for a reader with no actor. A page that draws it
// among its parts lets the session scroll with it; the chat beside a page
// that stays put gives it a box of its own to scroll in (`boxed`).
export let Conversation = (
  { e, boxed = false }: { e: Ent; boxed?: boolean },
) => {
  let actor = myActor()
  let selected = useChatFor(actor, e.eid)
  let [fresh, setFresh] = useState(false)
  return actor
    ? (
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
          ? (boxed
            ? (
              <Box>
                <Entity eid={selected.eid} view='Session' />
              </Box>
            )
            : <Entity eid={selected.eid} view='Session' />)
          : (
            <Starter
              e={e}
              actor={actor}
              old={selected?.eid}
              done={() => setFresh(false)}
            />
          )}
      </section>
    )
    : null
}

export let Chat = ({ e }: { e: Ent }) => {
  let cited = useReferences(e.eid)
  return (
    <Frame>
      <ReferenceList label='references' items={cited.out} />
      <ReferenceList label='referenced by' items={cited.in} held />
      <Conversation e={e} boxed />
    </Frame>
  )
}
