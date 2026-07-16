import { type Ent } from '../../types.ts'
import { el } from '../ui.tsx'
import { View } from '../View.tsx'

let cols = ['open', 'wip', 'done']

let Frame = el('div', 'Board')
let Col = el('div', 'Board_Col')
let ColName = el('div', 'Board_ColName')

// A project as kanban: columns derived from task status. Nothing spatial is
// stored — the same children on a Canvas would read pins.
export let Board = ({ e }: { e: Ent }) => (
  <Frame>
    {cols.map((s) => (
      <Col key={s}>
        <ColName>{s}</ColName>
        {e.kids.filter((k) => k.task?.status == s).map((k) => (
          <View key={k.eid} eid={k.eid} />
        ))}
      </Col>
    ))}
  </Frame>
)
