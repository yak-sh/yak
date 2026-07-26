import { useRef } from 'preact/hooks'
import { md } from '../md.ts'
import { commentsOn, ent, mutate, uuid } from '../live.ts'
import { ago, block, pretty } from './ui.tsx'
import { useDraft } from './drafts.ts'
import { type Ent, idOf, nick, sessionActive } from '../types.ts'
import { linkProps } from './nav.tsx'

let Frame = block('div', 'Comments', {
  Item: 'div',
  Who: 'a',
  Via: 'a',
  When: 'a',
  Body: 'div',
  New: 'textarea',
})
let { Item, Who, Via, When, Body, New } = Frame

// An instrument's face: browsers by a short client handle, anything else
// by its chip id (S-31, never the raw session uuid).
export let viaName = (eid?: string | null) => {
  if (!eid) return 'anon'
  let a = ent(eid)
  return a.client ? `web-${a.num}` : idOf(a)
}

// The universal stamp's human face: actor first, instrument after via.
export let byline = (c: Ent) => {
  let actor = c.created?.by ? ent(String(c.created.by)) : undefined
  let instrument = c.created?.via ? ent(String(c.created.via)) : undefined
  let by = actor ? actor.doc?.title || idOf(actor) : ''
  let via = instrument ? viaName(instrument.eid) : ''
  return by && via && actor?.eid != instrument?.eid
    ? `${by} · via ${via}`
    : by || via || 'anon'
}

// One comment, anywhere it renders — the rail here, the session thread
// inline. The stamp names actor and instrument directly; the actor leads
// and the instrument dims behind a "via" — both still links.
export let Note = ({ c }: { c: Ent }) => {
  let actor = c.created?.by ? ent(String(c.created.by)) : undefined
  let instrument = c.created?.via ? ent(String(c.created.via)) : undefined
  let who = actor ?? instrument
  return (
    /* An event is machinery speaking (M-4062) — a chip, not a
       bubble: the -event modifier shrinks and dims the row. */
    <Item mod={c.comment!.event ? 'event' : undefined}>
      {
        /* The name links to whoever said it; the age to the comment
        itself — both wear the internal-link contract. */
      }
      <Who {...(who ? linkProps(who) : {})}>
        {actor ? actor.doc?.title || idOf(actor) : viaName(instrument?.eid)}
      </Who>
      {actor && instrument && actor.eid != instrument.eid && (
        <Via {...linkProps(instrument)}>
          · via {viaName(instrument.eid)}
        </Via>
      )}
      <When data-tip={pretty(c.created?.at)} {...linkProps(c)}>
        {ago(c.created?.at)}
      </When>
      <Body
        dangerouslySetInnerHTML={{ __html: md(c.doc?.body ?? '') }}
      />
    </Item>
  )
}

// The box that says more — Enter posts (Shift+Enter for a newline), and
// the instrument is this browser's client entity.
//
// On a session the comment IS the way to talk to the agent — no side
// channel: the server's created(comment) effect resumes a settled
// managed session with the words, and an active one hears them on its
// next tool call through the bus. To leave a note ABOUT the run without
// waking it, comment on its task instead.
export let prompt = (e: Ent) => {
  let s = e.session
  let settled = !!s && s.origin == 'managed' && !!s.provider_session_id &&
    !sessionActive.includes(String(s.status))
  // Persona, model nick, graph chip: provider ids never face people.
  let who = s &&
    ((s.persona_eid && ent(s.persona_eid).doc?.title) ||
      nick(s.serving_model ?? s.model) || idOf(e))
  return settled
    ? `send to ${who}… (resumes the session)`
    : s
    ? 'comment… (the agent hears it on its next tool call)'
    : 'comment…'
}

export let Composer = ({ eid }: { eid: string }) => {
  let box = useRef<HTMLTextAreaElement>(null)
  let dkey = `${eid}.comment`
  // A draft outlives blur on purpose — abandon the box, come back, the
  // words are still there. Only posting spends it. If this box was the
  // one being typed in when a hot swap hit, it takes the caret back.
  let { sync, spend } = useDraft(dkey, box)

  let post = () => {
    let body = box.current!.value.trim()
    if (!body) return
    let c = uuid()
    mutate(
      { eid: c, name: 'doc', comp: { title: '', body } },
      {
        eid: c,
        name: 'comment',
        comp: { target_eid: eid },
      },
    )
    box.current!.value = ''
    spend()
  }

  let key = (e: KeyboardEvent) => {
    if (e.key == 'Enter' && !e.shiftKey) {
      e.preventDefault()
      post()
    }
    if (e.key == 'Escape') box.current!.blur()
  }

  return (
    <New
      elRef={box}
      data-eid={eid}
      rows={1}
      onInput={(e: InputEvent) => sync(e.currentTarget as HTMLTextAreaElement)}
      placeholder={prompt(ent(eid))}
      onKeyDown={key}
    />
  )
}

// The comment rail under any entity: everything said about it, oldest
// first, plus the composer. (A session doesn't use this — its view
// weaves the heard comments into the thread and pins its own composer.)
export let Comments = ({ eid }: { eid: string }) => (
  <Frame>
    {commentsOn(eid).map((c) => <Note key={c.eid} c={c} />)}
    <Composer eid={eid} />
  </Frame>
)
