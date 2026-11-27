/** @jsxImportSource react */
// The box a key is pasted in, on a task that asks a person for one
// (@yaks/connections `asks`): one for each connection it asks for that holds
// no working key yet. Saving writes the key through the graph, never through
// the outbox, and the server's vault keeps it; the task is completed once the
// key is checked and kept where it is used (@yaks/connections
// `connection_given`).
import { fieldsOf, KeyForm, pasted } from '@yaks/connections/form'
import { integrationEid } from '@yaks/connections/identity'
import type { Field } from '@yaks/connections/form'
import { Markdown } from '@yaks/markdown'
import { type Ent, vocab } from '../types.ts'
import { ent } from '../live.ts'
import { saveKey } from '../configuration.ts'
import { bundle } from './registry.ts'
import { useQueryResult } from './useQuery.ts'
import { useEntity } from './subscriptions.ts'

type Connection = { integration?: string; status?: string }
type Integration = {
  title?: string
  fields?: Field[]
  example?: string
  instructions?: string
}

let Asked = ({ eid }: { eid: string }) => {
  useEntity(eid, 'connection.integration,connection.status,secret.name')
  let c = ent(eid).connection as Connection | undefined
  let name = c?.integration
  let at = name ? integrationEid(name) : undefined
  useEntity(
    at,
    'integration.title,integration.fields,integration.example,integration.instructions',
  )
  if (!name || !c?.status) return null
  let i = ent(at!).integration as Integration | undefined
  let fields = fieldsOf(i)
  return (
    <KeyForm
      id={eid}
      title={`Key for ${i?.title || name}`}
      fields={fields}
      status={c.status}
      howTo={i?.instructions && <Markdown source={i.instructions} />}
      save={(given) => saveKey(pasted(bundle(ent(eid)), name, fields, given))}
    />
  )
}

/** The connections `e` asks for, each with its box. */
export let Keys = ({ e }: { e: Ent }) => {
  let on = !!e.task && !!vocab.comp('asks')
  let asks = useQueryResult(
    on ? `.edge.from=${e.eid}&.asks&.fields=edge.to` : '',
    on,
    true,
  )
  return (
    <>
      {asks.eids.map((a) => {
        let to = (ent(a).edge as { to?: string } | undefined)?.to
        return to ? <Asked key={to} eid={to} /> : null
      })}
    </>
  )
}
