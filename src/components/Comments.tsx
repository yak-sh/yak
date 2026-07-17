import { useEffect, useRef, useState } from 'preact/hooks'
import { md } from '../md.ts'
import { base, clientId, commentsOn, ent, mutate, uuid } from '../live.ts'
import { ago, block, pretty } from './ui.tsx'
import { drop, focused, peek, save } from './drafts.ts'
import { idOf, nick, sessionActive } from '../types.ts'

let Frame = block('div', 'Comments', {
  Item: 'div',
  Who: 'span',
  When: 'span',
  Body: 'div',
  New: 'textarea',
  Send: 'button',
})
let { Item, Who, When, Body, New, Send } = Frame

// Who said it: sessions by their id, browsers by a short client handle,
// anything else by its entity id. Pure — the TUI names authors with it too.
export let author = (eid?: string | null) => {
  if (!eid) return 'anon'
  let a = ent(eid)
  return a.session?.id ?? (a.client ? `web-${a.num}` : idOf(a))
}

// The comment rail under any entity: everything said about it, oldest
// first, plus the box that says more. A comment is a doc + a comment
// component aiming at the target — Enter posts (Shift+Enter for a
// newline), and the author is this browser's client entity.
//
// On a session it's ALSO the way to talk to the agent — one box, an
// armed "→ session" switch deciding whether the words are about it or
// to it. A settled managed session resumes (POST input) when armed; an
// active one takes no stdin, but the bus already hands comments to the
// agent on its next tool call, so the comment alone is delivery.
export let Comments = ({ eid }: { eid: string }) => {
  let box = useRef<HTMLTextAreaElement>(null)
  let dkey = `${eid}.comment`
  // A draft outlives blur on purpose — abandon the box, come back, the
  // words are still there. Only posting spends it. If this box was the
  // one being typed in when a hot swap hit, it takes the caret back.
  useEffect(() => {
    let d = peek(dkey)
    if (!d || !box.current) return
    box.current.value = d.v
    if (focused(dkey)) {
      box.current.focus()
      let c = d.caret ?? d.v.length
      box.current.setSelectionRange(c, c)
    }
  }, [])
  let s = ent(eid).session
  let settled = !!s && s.origin == 'managed' && !!s.provider_session_id &&
    !sessionActive.includes(String(s.status))
  let [send, setSend] = useState(true)
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
    if (settled && send) {
      fetch(`${base()}/sessions/${eid}/input`, {
        method: 'POST',
        body: JSON.stringify({ text: body }),
      }).catch(() => {})
    }
    box.current!.value = ''
    drop(dkey)
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
      {commentsOn(eid).map((c) => (
        <Item key={c.eid}>
          <Who>{author(c.comment!.author_eid)}</Who>
          <When data-tip={pretty(c.created_at)}>{ago(c.created_at)}</When>
          <Body
            dangerouslySetInnerHTML={{ __html: md(c.doc?.body ?? '') }}
          />
        </Item>
      ))}
      <New
        elRef={box}
        rows={1}
        onInput={(e: InputEvent) => {
          let t = e.currentTarget as HTMLTextAreaElement
          save(dkey, t.value, t.selectionStart ?? undefined)
        }}
        placeholder={settled && send
          ? `send to ${who}…`
          : s && !settled
          ? 'comment… (the agent hears it on its next tool call)'
          : 'comment…'}
        onKeyDown={key}
      />
      {settled && (
        <Send
          type='button'
          mod={send && 'on'}
          data-tip={send
            ? 'armed: posting also resumes the session'
            : 'off: the comment is about the session, not to it'}
          onClick={() => setSend(!send)}
        >
          → session
        </Send>
      )}
    </Frame>
  )
}
