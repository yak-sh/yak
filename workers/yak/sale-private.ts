// Customer authority uses the same verified person and instrument as graph
// writes; a payment email or checkout id never identifies its reader.
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { owns } from '@yaks/member'
import { instrumentEid } from './instrument.ts'
import { opened, seal } from './lib/token.ts'

export type SaleAccess = { buyer?: string | null; via?: string | null }
export type Buyer = { person?: string | null; via?: string | null }

export let saleAccess = (who: SaleAccess): SaleAccess => ({
  buyer: who.buyer || null,
  via: who.via ? instrumentEid(who.via) : null,
})

export let mayReceive = (access: SaleAccess, who: Buyer): boolean =>
  owns(
    { by: access.buyer, via: access.via ? instrumentEid(access.via) : null },
    { by: who.person, via: who.via ? instrumentEid(who.via) : null },
  )

export let protectedSale = (rows: Bundle[], access: SaleAccess): Bundle[] =>
  rows.map((row) => ({ ...row, sale_access: saleAccess(access) }))

/** Identical files may belong to several customers. Their entitlement rows
 * stay separate while content-addressed metadata remains seller-private. */
export let protectedArtifact = (
  rows: Bundle[],
  sha: string,
  access: SaleAccess,
): Bundle[] => {
  let owner = saleAccess(access)
  return [
    ...protectedSale(rows, {}),
    {
      entity: {
        eid: derivedEid(JSON.stringify(['sale-artifact', sha, owner])),
      },
      sale_artifact: { artifact: sha },
      sale_access: owner,
    },
  ]
}

export type ArtifactTicket = { app: string; sha: string; exp: number }
export let ARTIFACT_LIFE = 15 * 60_000

/** A provider may fetch exactly these bytes until expiry. Renewal goes through
 * the authenticated artifact door and checks current ownership again. */
export let artifactTicket = (
  app: string,
  sha: string,
  secret: string,
  now = Date.now(),
) => seal('artifact', { app, sha, exp: now + ARTIFACT_LIFE }, secret)

export let artifactPermit = async (
  token: string,
  app: string,
  sha: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> => {
  let ticket = await opened<ArtifactTicket>('artifact', token, secret)
  return !!ticket && ticket.app == app && ticket.sha == sha &&
    Number.isFinite(ticket.exp) && ticket.exp > now
}
