import { useRef } from 'preact/hooks'
import { md } from '../md.ts'
import { clientId, commentsOn, ent, mutate, uuid } from '../live.ts'
import { ago, block, pretty } from './ui.tsx'
import { useDraft } from './drafts.ts'
import { idOf, nick, sessionActive } from '../types.ts'
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

// Who said it: browsers by a short client handle, anything else by its
// chip id (S-31, never the raw session uuid). Pure — the TUI names
// authors with it too.
export let author = (eid?: string | null) => {
  if (!eid) return 'anon'
  let a = ent(eid)
  return a.client ? `web-${a.num}` : idOf(a)
}

// The comment rail under any entity: everything said about it, oldest
// first, plus the box that says more. A comment is a doc + a comment
// component aiming at the target — Enter posts (Shift+Enter for a
// newline), and the author is this browser's client entity.
//
// On a session the comment IS the way to talk to the agent — no side
// channel: the server's created(comment) effect resumes a settled
// managed session with the words, and an active one hears them on its
// next tool call through the bus. To leave a note ABOUT the run without
// waking it, comment on its task instead.
export let Comments = ({ eid }: { eid: string }) => {
  let box = useRef<HTMLTextAreaElement>(null)
  let dkey = `${eid}.comment`
  // A draft outlives blur on purpose — abandon the box, come back, the
  // words are still there. Only posting spends it. If this box was the
  // one being typed in when a hot swap hit, it takes the caret back.
  let { sync, spend } = useDraft(dkey, box)
  let s = ent(eid).session
  let settled = !!s && s.origin == 'managed' && !!s.provider_session_id &&
    !sessionActive.includes(String(s.status))
  // Who you're addressing: the persona's name when the session has one,
  // else the model's nick — never the raw session id.
  let who = s &&
    ((s.persona_eid && ent(s.persona_eid).doc?.title) ||
      nick(s.serving_model ?? s.model) || s.id)

  let post = () => {
    let body = box.current!.value.trim()
    if (!body) return
    let c = uuid()
    mutate(
      { eid: c, name: 'doc', comp: { title: '', body } },
      {
        eid: c,
        name: 'comment',
        comp: { target_eid: eid, author_eid: clientId() },
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
    <Frame>
      {commentsOn(eid).map((c) => {
        // The author is the INSTRUMENT (client or session); when its row
        // says who it acts for, the actor leads the byline and the
        // instrument dims behind a "via" — both still links.
        let by = c.comment!.author_eid
        let a = by ? ent(by) : undefined
        let actor = a?.session?.actor_eid ?? a?.client?.actor_eid
        let who = actor ? ent(String(actor)) : undefined
        return (
          /* An event is machinery speaking (M-4062) — a chip, not a
             bubble: the -event modifier shrinks and dims the row. */
          <Item key={c.eid} mod={c.comment!.event ? 'event' : undefined}>
            {
              /* The name links to whoever said it; the age to the comment
              itself — both wear the internal-link contract. */
            }
            <Who {...((who ?? a) ? linkProps(who ?? a!) : {})}>
              {who ? who.doc?.title || idOf(who) : author(by)}
            </Who>
            {who && <Via {...linkProps(a!)}>· via {author(by)}</Via>}
            <When data-tip={pretty(c.created?.at)} {...linkProps(c)}>
              {ago(c.created?.at)}
            </When>
            <Body
              dangerouslySetInnerHTML={{ __html: md(c.doc?.body ?? '') }}
            />
          </Item>
        )
      })}
      <New
        elRef={box}
        data-eid={eid}
        rows={1}
        onInput={(e: InputEvent) =>
          sync(e.currentTarget as HTMLTextAreaElement)}
        placeholder={settled
          ? `send to ${who}… (resumes the session)`
          : s && !settled
          ? 'comment… (the agent hears it on its next tool call)'
          : 'comment…'}
        onKeyDown={key}
      />
    </Frame>
  )
}
