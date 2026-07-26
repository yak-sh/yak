import { type Ent, friendly, standing } from '../../types.ts'
import { block } from '../ui.tsx'
import { Edit } from '../Edit.tsx'
import { Pip } from './Show.tsx'
import { Dot } from '../Dot.tsx'
import { Id } from './Inline.tsx'

let Frame = block('div', 'CardTitle', { Text: 'span' })
let { Text } = Frame

// The Card.Title view: what an entity shows in a card's titlebar — the
// entity IS the card. Everything reads id chip → dot → title (the id is
// the address, first like a filename; a dot only when the entity has a
// status), then the titlebar's own flex pushes filter + tabs off to the
// right. The task's dot is its status CONTROL (Show.tsx Pip) — a card
// carries one dot, and that dot is where status is edited; a session's
// dot just says how the run is doing.
export let TaskTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Id e={e} />
    <Pip e={e} />
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
  </Frame>
)

export let BoardTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Id e={e} />
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
      <Id e={e} />
      <Text>{e.doc?.title ?? host}</Text>
    </Frame>
  )
}

export let DocTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Id e={e} />
    <Text>
      <Edit eid={e.eid} comp='doc' prop='title' />
    </Text>
  </Frame>
)

export let SessionTitle = ({ e }: { e: Ent }) => {
  let s = e.session!
  return (
    <Frame>
      <Id e={e} />
      <Dot status={standing(s)} />
      <Text>
        {friendly(s.serving_model || s.model) ?? 'session'}
      </Text>
    </Frame>
  )
}

export let AnyTitle = ({ e }: { e: Ent }) => (
  <Frame mod='dim'>
    <Id e={e} />
    <Text>{e.kind}</Text>
  </Frame>
)
