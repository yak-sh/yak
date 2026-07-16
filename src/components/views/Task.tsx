import { type Ent } from '../../types.ts'
import { el } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { View } from '../View.tsx'

let Frame = el('div', 'Task')
let Head = el('div', 'Task_Head')
let Title = el('span', 'Task_Title')
let Body = el('p', 'Task_Body')

// A single task: head, body, then its edges as Dependency sentences.
export let Task = ({ e }: { e: Ent }) => (
  <Frame>
    <Head>
      <Dot status={e.task!.status} />
      <Title>{e.task!.title}</Title>
      <View eid={e.eid} view='Id' />
    </Head>
    {e.task!.body && <Body>{e.task!.body}</Body>}
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
  </Frame>
)
