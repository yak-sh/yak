import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Edit } from '../Edit.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'Task', { Head: 'div', Title: 'span', Body: 'p' })
let { Head, Title, Body } = Frame

// A single task: head, body, then its edges as Dependency sentences.
export let Task = ({ e }: { e: Ent }) => (
  <Frame>
    <Head>
      <Dot status={e.task!.status} />
      <Title>
        <Edit eid={e.eid} comp='task' prop='title' />
      </Title>
      <View eid={e.eid} view='Id' />
    </Head>
    {e.task!.body && <Body>{e.task!.body}</Body>}
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
  </Frame>
)

// The same view in card context: the task IS the card, its head lives in
// the titlebar (Card.Title) — here just the innards.
export let TaskCard = ({ e }: { e: Ent }) => (
  <>
    {e.task!.body && <Body mod='bare'>{e.task!.body}</Body>}
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
  </>
)
