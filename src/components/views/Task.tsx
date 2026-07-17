import { useState } from 'preact/hooks'
import snarkdown from 'snarkdown'
import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { block } from '../ui.tsx'
import { Comments } from '../Comments.tsx'
import { Dot } from '../Dot.tsx'
import { Edit } from '../Edit.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'Task', {
  Head: 'div',
  Title: 'span',
  Body: 'p',
  Claim: 'span',
})
let { Head, Title, Body, Claim } = Frame

// The body is markdown: rendered as HTML (snarkdown; our own data, so no
// sanitizer between us and ourselves), double-click swaps in the raw
// source through the same <Edit>, and the blur that commits swaps the
// rendered view back. An empty body keeps a line of height to give the
// double-click somewhere to land.
export let TaskBody = ({ e, mod }: { e: Ent; mod?: string }) => {
  let [src, setSrc] = useState(false)
  return src
    ? (
      <Body mod={mod}>
        <Edit
          eid={e.eid}
          comp='doc'
          prop='body'
          multi
          open
          onClose={() => setSrc(false)}
        />
      </Body>
    )
    : (
      <Body
        mod={mod}
        onDblClick={() => setSrc(true)}
        dangerouslySetInnerHTML={{ __html: snarkdown(e.doc?.body ?? '') }}
      />
    )
}

// A single task: head, body, then its edges as Dependency sentences.
export let Task = ({ e }: { e: Ent }) => (
  <Frame>
    <Head>
      <Dot status={e.task!.status} />
      <Title>
        <Edit eid={e.eid} comp='doc' prop='title' />
      </Title>
      {e.claim && <Claim>⚑ {ent(e.claim.session_eid).session?.id}</Claim>}
      <View eid={e.eid} view='Id' />
    </Head>
    <TaskBody e={e} />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Comments eid={e.eid} />
  </Frame>
)

// The same view in card context: the task IS the card, its head lives in
// the titlebar (Card.Title) — here just the innards.
export let TaskCard = ({ e }: { e: Ent }) => (
  <>
    <TaskBody e={e} mod='bare' />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Comments eid={e.eid} />
  </>
)
