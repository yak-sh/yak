import { opened as openedFor, signed } from '@yaks/secrets/signed'

/** Short-lived tracker tickets issued by a trusted host: a signed value
 * (@yaks/secrets/signed) under the tracker's own label. No ticket or secret is
 * persisted; callers issue one when they call remotely. */
export type Access = {
  scope: string
  person: string
  exp: number
  admin?: boolean
  ingest?: boolean
  mark?: boolean
}

let LABEL = 'yaks.app/tracker'

/** Signs the tracker ticket the tracker's authorization opens. */
export let sign = (access: Access, secret: string): Promise<string> =>
  signed(LABEL, access, secret)

/** What a ticket grants, or null for anything but a ticket signed under this
 * secret; its expiry and scope are the caller's to check. */
export let opened = (ticket: string, secret: string): Promise<Access | null> =>
  openedFor<Access>(LABEL, ticket, secret)
