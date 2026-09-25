// OAuth clients: what an integration signs in as, registered once with a
// service and kept once, however many integrations share it. google-calendar
// names `google`, and so will a later google-drive; a product that needs a
// client of its own names another. An integration names its client
// (`Integration.client`); the client is a secret (@yaks/secrets), so the graph
// holds its handle and the vault its id and secret. It is set the way any
// secret is — a sealed write through trusted code — never through a tool's
// arguments, which a graph keeps as the text of a call, nor a host's
// environment.

import type { Bundle } from '@yaks/graph'
import { reveal, sealed, type Vault } from '@yaks/secrets'
import { installed, type Integration, type Read } from './integrations.ts'

/** A client registered with a service: its id, and a confidential client's
 * secret. */
export type Registered = { id: string; secret?: string }

// The name a client is kept under among the graph's secrets.
let keptAs = (name: string) => `oauth_client ${name}`

/** The bundle that keeps `client` under `name`: the id and the secret go to
 * the vault, and the graph holds the handle. */
export let registration = (name: string, client: Registered): Bundle =>
  sealed(keptAs(name), JSON.stringify(client))

/** The client kept under `name`, if one is. */
export let registered = async (
  vault: Vault,
  name: string,
): Promise<Registered | undefined> => {
  let text = await reveal(vault, keptAs(name), { env: () => undefined })
  if (!text) return undefined
  let c = JSON.parse(text)
  if (
    typeof c?.id != 'string' ||
    (c.secret != null && typeof c.secret != 'string')
  ) throw new Error(`${name} is not an OAuth client`)
  return c
}

/** The client an integration signs in as. A custom integration never signs in
 * as a client a built one names: that client's secret would go to whatever
 * token endpoint the custom integration gives. */
export let clientOf = async (
  vault: Vault,
  read: Read,
  i: Integration,
): Promise<Registered | undefined> => {
  if (!i.client) return undefined
  let taken = !i.built &&
    (await installed(read)).some((b) => b.client == i.client)
  return taken ? undefined : registered(vault, i.client)
}
