// A session's phone sized controls: choose the model for the next input and
// open its children and claims without leaving the transcript.
import { useEffect, useState } from 'preact/hooks'
import { catalog, transport, usingOf } from '../../providers.ts'
import { type Ent } from '../../types.ts'
import { Composer } from '@yaks/kernel/Comments'
import { Entity } from '../Entity.tsx'
import { load, providers } from '../Run.tsx'
import { useModel } from '../subscriptions.ts'
import { block } from '@yaks/ui'
import { useQueryResult } from '../useQuery.ts'

let Frame = block('div', 'SessionManage', {
  Input: 'div',
  Label: 'label',
  Related: 'div',
  Group: 'details',
  Gist: 'summary',
  List: 'div',
  Empty: 'span',
})
let { Input, Label, Related, Group, Gist, List, Empty } = Frame

export let SessionInput = ({ e }: { e: Ent }) => {
  let current = useModel(e)
  let [choice, setChoice] = useState('')
  let [effort, setEffort] = useState('')
  useEffect(() => {
    if (!providers.value.length) load()
  }, [])
  let picks = catalog(providers.value)
  let pick = picks.find((p) => p.model == choice)
  let tier = pick?.efforts.includes(effort)
    ? effort
    : pick?.efforts.includes(current.effort ?? '')
    ? current.effort
    : pick?.efforts[0]
  let provider = pick && transport(pick, () => false)
  let using = pick && provider
    ? usingOf(providers.value, {
      provider,
      model: pick.model,
      ...(tier ? { effort: tier } : {}),
    })
    : undefined
  return (
    <Input>
      <Label>
        model
        <select
          aria-label='model for next message'
          value={choice}
          onChange={(ev: Event) => {
            setChoice((ev.currentTarget as HTMLSelectElement).value)
            setEffort('')
          }}
        >
          <option value=''>
            {current.name ? `${current.name} (current)` : 'current model'}
          </option>
          {picks.map((p) => (
            <option key={p.model} value={p.model}>{p.label}</option>
          ))}
        </select>
      </Label>
      {!!pick?.efforts.length && (
        <Label>
          effort
          <select
            aria-label='effort for next message'
            value={tier}
            onChange={(ev: Event) =>
              setEffort((ev.currentTarget as HTMLSelectElement).value)}
          >
            {pick.efforts.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </Label>
      )}
      <Composer eid={e.eid} entry using={using} />
    </Input>
  )
}

let Links = ({ name, ids }: { name: string; ids: string[] }) => (
  <Group>
    <Gist>{name} · {ids.length}</Gist>
    <List>
      {ids.length
        ? ids.map((eid) => (
          <Entity key={eid} eid={eid} view='Session.Related.List.Tile' />
        ))
        : <Empty>none</Empty>}
    </List>
  </Group>
)

export let SessionRelated = ({ eid }: { eid: string }) => {
  let children = useQueryResult(
    `.spawned.parent=${eid}&*`,
    true,
    true,
  )
  let claims = useQueryResult(
    `.claim.session=${eid}&*`,
    true,
    true,
  )
  return (
    <Related>
      <Links name='children' ids={children.eids} />
      <Links name='claims' ids={claims.eids} />
    </Related>
  )
}
