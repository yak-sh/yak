// A wake's two faces: a title derived from its recipient and clock, and a
// quiet summary that makes the scheduled moment and people visible.
import { type Ent, idOf } from '../../types.ts'
import { ent } from '../../live.ts'
import { ago, block, pretty } from '../ui.tsx'
import { Entity } from '../Entity.tsx'
import { Id } from './Inline.tsx'

let Title = block('div', 'CardTitle', { Text: 'span' })
let Frame = block('section', 'Wake', {
  Moment: 'div',
  Relative: 'strong',
  Exact: 'time',
  People: 'div',
  Party: 'div',
  Label: 'span',
})

export let WakeTitle = ({ e }: { e: Ent }) => {
  let to = e.deliver?.to
  return (
    <Title>
      <Id e={e} />
      <Title.Text>
        wake {to ? idOf(ent(to)) : 'someone'} · {ago(e.wake!.at)}
      </Title.Text>
    </Title>
  )
}

export let Wake = ({ e }: { e: Ent }) => {
  let at = e.wake!.at
  let to = e.deliver?.to
  let by = e.created?.by
  return (
    <Frame>
      <Frame.Moment>
        <Frame.Relative>{ago(at)}</Frame.Relative>
        <Frame.Exact dateTime={at}>{pretty(at)}</Frame.Exact>
      </Frame.Moment>
      {to && (
        <Frame.People>
          <Frame.Party>
            <Frame.Label>deliver to</Frame.Label>
            <Entity eid={to} view='Tile' />
          </Frame.Party>
          {by && by != to && (
            <Frame.Party>
              <Frame.Label>created by</Frame.Label>
              <Entity eid={by} view='Tile' />
            </Frame.Party>
          )}
        </Frame.People>
      )}
    </Frame>
  )
}
