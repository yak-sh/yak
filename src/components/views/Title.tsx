import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
import { Dot } from '../Dot.tsx'

let Frame = block('div', 'CardTitle', { Text: 'span' })
let { Text } = Frame

// The Card.Title view: what an entity shows in a card's titlebar — the
// entity IS the card. Tasks lead with their status dot, projects and pages
// with their name, anything else with its kind, dimmed.
export let TaskTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Dot status={e.task!.status} />
    <Text>{e.task!.title}</Text>
  </Frame>
)

export let ProjectTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Text>{e.project!.title}</Text>
  </Frame>
)

export let WebTitle = ({ e }: { e: Ent }) => {
  let host
  try {
    host = new URL(e.web!.url).host
  } catch {
    host = e.web!.url
  }
  return (
    <Frame>
      <Text>{host}</Text>
    </Frame>
  )
}

export let AnyTitle = ({ e }: { e: Ent }) => (
  <Frame mod='dim'>
    <Text>{e.kind}</Text>
  </Frame>
)
