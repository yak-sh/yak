import { line } from '@yaks/query'
import { secretEid } from '@yaks/secrets'
import { BROKERS, brokerSecret } from './brokers.ts'
import { clientSecret } from './clients.ts'
import { connectable, type Integration, type Read } from './integrations.ts'

let setupOf = (i: Integration) =>
  i.broker
    ? Object.hasOwn(BROKERS, i.broker.name) && brokerSecret(i.broker.name)
    : i.client && clientSecret(i.client)

/** Which built integrations have sign-in configured, for showing setup links.
 * Read the directory's sealed records together. The sign-in itself reads its
 * credential from the vault when the person follows the link. */
export let configuredSignIns = async (
  read: Read,
  integrations: Integration[],
): Promise<Set<string>> => {
  let setups = integrations.filter((i) => i.built).map((i) => {
    let name = setupOf(i)
    return { i, eid: name ? secretEid(name) : undefined }
  })
  let ids = [...new Set(setups.flatMap(({ eid }) => eid ? [eid] : []))]
  let rows = ids.length
    ? await read(
      line`.entity.eid=${ids}&.secret.value&!provisional&!failed&.fields=entity.eid`,
    )
    : []
  let kept = new Set(rows.map((row) => row.entity.eid))
  return new Set(
    setups.filter(({ i, eid }) => connectable(i, eid && kept.has(eid)))
      .map(({ i }) => i.name),
  )
}
