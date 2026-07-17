import { type Ent } from '../../types.ts'
import { pinned } from '../../live.ts'
import { block } from '../ui.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'List', { Row: 'div' })
let { Row } = Frame

// A canvas as a linear list — every pinned card's target, one summary row
// each, id chips linking through. The mobile answer to a spatial plane.
export let List = ({ e }: { e: Ent }) => (
  <Frame>
    {pinned(e.eid)
      .toSorted((a, b) => b.z - a.z)
      .map((p) => (
        <Row key={p.eid}>
          <View eid={p.target_eid} view='List.Item' />
        </Row>
      ))}
  </Frame>
)

// The default list line: title (or kind) + the linking id chip. Tasks
// override with Task.Row via the registry.
let Line = block('div', 'ListItem', { Title: 'span' })
export let ListItem = ({ e }: { e: Ent }) => (
  <Line>
    <Line.Title>{e.doc?.title || e.kind}</Line.Title>
    <View eid={e.eid} view='Id' />
  </Line>
)
