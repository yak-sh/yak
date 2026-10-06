import { type Ent, friendly } from '../../types.ts'
import { block } from '@yaks/ui'
import { title, TitleEdit } from '../title.tsx'
import { Pip } from './Show.tsx'
import { Id } from './Inline.tsx'
import { SessionDot } from '../session_status.tsx'
import { useModel, useReference } from '../subscriptions.ts'
import { renderView } from '../registry.ts'
import { ent, jobOf } from '../../live.ts'

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
      <TitleEdit eid={e.eid} />
    </Text>
  </Frame>
)

export let BoardTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Id e={e} />
    <Text>
      <TitleEdit eid={e.eid} />
    </Text>
  </Frame>
)

export let RoleTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Id e={e} />
    <Text>
      <TitleEdit eid={e.eid} />
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
      <Text {...title(e.doc?.title ?? host)} />
    </Frame>
  )
}

export let DocTitle = ({ e }: { e: Ent }) => (
  <Frame>
    <Id e={e} />
    <Text>
      <TitleEdit eid={e.eid} />
    </Text>
  </Frame>
)

export let SessionTitle = ({ e }: { e: Ent }) => {
  let model = useModel(e)
  return (
    <Frame>
      <Id e={e} />
      <SessionDot e={e} />
      <Text>
        {friendly(model.name) ?? 'session'}
        {model.effort && ` · ${model.effort}`}
      </Text>
    </Frame>
  )
}

// The bar over a session's page names what it is working on: the task it
// holds, else the one it worked, else its own title. Its id is beside it
// already, and its dot says how the run is doing.
export let SessionBarTitle = ({ e }: { e: Ent }) => {
  let job = jobOf(e)
  let worked = useReference(e.refs.find((r) => r.type == 'worked')?.child)
    .value
  let task = job ? ent(job) : worked
  return (
    <Frame>
      <SessionDot e={e} />
      <Text>
        {task
          ? renderView(task, 'Title')
          : <span {...title(e.doc?.title || 'Session')} />}
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
