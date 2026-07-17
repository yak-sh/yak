import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { Edit } from '../Edit.tsx'
import { Pip } from './Task.tsx'
import { Dot } from '../Dot.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'CardTitle', { Text: 'span' })
let { Text } = Frame

// The Card.Title view: what an entity shows in a card's titlebar — the
// entity IS the card. Everything reads dot → title → id chip, then the
// tabs push off to the right. The task's dot is its status CONTROL
// (Task.tsx Pip) — a card carries one dot, and that dot is where status
// is edited; a session's dot just says how the run is doing.
export let TaskTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Pip e={e} />
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
    <View eid={e.eid} view='Id' />
  </Frame>
)

export let BoardTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
    <View eid={e.eid} view='Id' />
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
      <Text>{e.doc?.title ?? host}</Text>
      <View eid={e.eid} view='Id' />
    </Frame>
  )
}

export let DocTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
    <View eid={e.eid} view='Id' />
  </Frame>
)

export let SessionTitle = ({ e }: { e: Ent }) => {
  let s = e.session!
  return (
    <Frame>
      <Dot status={s.status ?? ''} />
      <Text>
        {s.provider
          ? `${s.provider} · ${s.serving_model || s.model}`
          : 'session'}
      </Text>
      <View eid={e.eid} view='Id' />
    </Frame>
  )
}

export let AnyTitle = ({ e }: { e: Ent }) => (
  <Frame mod='dim'>
    <Text>{e.kind}</Text>
    <View eid={e.eid} view='Id' />
  </Frame>
)
