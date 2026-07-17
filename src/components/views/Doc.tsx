import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { Comments } from '../Comments.tsx'
import { Edit } from '../Edit.tsx'
import { TaskBody } from './Task.tsx'
import { View } from '../View.tsx'

// A bare doc: title + markdown body — what any doc-carrying entity looks
// like when nothing more specific (task, board) outscores it. Wears the
// Task block's clothes: same head/body pattern, no status dot.
let Frame = block('div', 'Task', { Head: 'div', Title: 'span' })
let { Head, Title } = Frame

export let DocView = ({ e }: { e: Ent }) => (
  <Frame>
    <Head>
      <Title>
        <Edit eid={e.eid} comp='doc' prop='title' />
      </Title>
      <View eid={e.eid} view='Id' />
    </Head>
    <TaskBody e={e} />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Comments eid={e.eid} />
  </Frame>
)

// Card context: the titlebar already shows the title — body + edges only.
export let DocCard = ({ e }: { e: Ent }) => (
  <>
    <TaskBody e={e} mod='bare' />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Comments eid={e.eid} />
  </>
)
