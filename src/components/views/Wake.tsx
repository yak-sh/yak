// A wake's two faces: a title derived from its recipient and clock, and a
// quiet summary that makes the scheduled moment and people visible.
import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { wakeTitle } from '../../title.ts'
import { ago, block, pretty } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Entity } from '../Entity.tsx'
import { Id } from './Inline.tsx'

let Title = block('div', 'CardTitle', { Text: 'span' })
let Frame = block('section', 'Wake', {
  Moment: 'div',
  Relative: 'strong',
  Exact: 'time',
  Outcome: 'div',
  Status: 'strong',
  Detail: 'span',
  People: 'div',
  Party: 'div',
  Label: 'span',
})

let state = (e: Ent) =>
  e.delivered ? 'delivered' : e.error ? 'failed' : 'pending'

export let WakeTitle = ({ e }: { e: Ent }) => {
  let status = state(e)
  return (
    <Title>
      <Id e={e} />
      <Dot status={status == 'delivered' ? 'done' : status} />
      <Title.Text>{wakeTitle(e, ent)}</Title.Text>
    </Title>
  )
}

export let Wake = ({ e }: { e: Ent }) => {
  let at = e.wake!.at
  let to = e.deliver?.to
  let by = e.created?.by
  let status = state(e)
  let outcome = e.delivered ?? e.error
  return (
    <Frame>
      <Frame.Moment mod={status}>
        <Frame.Relative>{ago(at)}</Frame.Relative>
        <Frame.Exact dateTime={at}>{pretty(at)}</Frame.Exact>
        <Frame.Outcome>
          <Frame.Status>{status}</Frame.Status>
          {outcome?.at && (
            <span data-tip={pretty(outcome.at)}>{ago(outcome.at)}</span>
          )}
          {e.delivered?.via && (
            <Frame.Detail>via {e.delivered.via}</Frame.Detail>
          )}
          {e.error?.message && <Frame.Detail>{e.error.message}</Frame.Detail>}
        </Frame.Outcome>
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
