import { useRef } from 'preact/hooks'
import snarkdown from 'snarkdown'
import { clientId, commentsOn, ent, mutate, uuid } from '../live.ts'
import { ago, block, pretty } from './ui.tsx'
import { idOf } from '../types.ts'

let Frame = block('div', 'Comments', {
  Item: 'div',
  Who: 'span',
  When: 'span',
  Body: 'div',
  New: 'textarea',
})
let { Item, Who, When, Body, New } = Frame

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
export let Comments = ({ eid }: { eid: string }) => {
  let box = useRef<HTMLTextAreaElement>(null)

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
            dangerouslySetInnerHTML={{ __html: snarkdown(c.doc?.body ?? '') }}
          />
        </Item>
      ))}
      <New elRef={box} rows={1} placeholder='comment…' onKeyDown={key} />
    </Frame>
  )
}
