import { type Ent } from '../../types.ts'
import { gated } from '../../live.ts'
import { block } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Edit } from '../Edit.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'CardTitle', { Text: 'span' })
let { Text } = Frame

// The Card.Title view: what an entity shows in a card's titlebar — the
// entity IS the card. Tasks lead with their status dot, then the id, then
// the title; boards and pages with id + name; anything else id + kind,
// dimmed.
export let TaskTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <View eid={e.eid} view='Id' />
    <Dot status={e.task!.status} gated={gated(e)} />
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
  </Frame>
)

export let BoardTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <View eid={e.eid} view='Id' />
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
  </Frame>
)

export let WebTitle = ({ e }: { e: Ent }) => {
  let host
  try {
    host = new URL(e.web!.url).host
  } catch {
    host = e.web!.url
  }
  // The freeze stamps the page <title> onto the entity as a doc.
  return (
    <Frame>
      <View eid={e.eid} view='Id' />
      <Text>{e.doc?.title ?? host}</Text>
    </Frame>
  )
}

export let DocTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <View eid={e.eid} view='Id' />
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
  </Frame>
)

export let AnyTitle = ({ e }: { e: Ent }) => (
  <Frame mod='dim'>
    <View eid={e.eid} view='Id' />
    <Text>{e.kind}</Text>
  </Frame>
)
