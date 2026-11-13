// Service publication references the app's declaration, never a second schema.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { CallError } from '@yaks/tools/errors'
import { integrationEid } from './identity.ts'
import {
  type About,
  type Integration,
  PUBLISHED,
  publishing,
  type Read,
  told,
} from './integrations.ts'

/** A service keeps its integration name across app and space renames. */
export let serviceName = (app: string) => `app-${app}`

/** Publish or withdraw an app's offer without deleting its connections. */
export let publishService = async (
  read: Read,
  a: About & {
    app: string
    owner: string
    description?: string
    listed: boolean
  },
): Promise<Bundle[]> => {
  let name = serviceName(a.app)
  let eid = integrationEid(name)
  let [held] = await read(`.entity.eid=${eid}&.integration&?${PUBLISHED}`)
  let i = held?.integration as Integration | undefined
  if (i && (i.owner != a.owner || i.service?.app != a.app)) {
    throw new CallError(
      'access',
      'Only the owner of this app publishes its service',
    )
  }
  return [{
    entity: { eid },
    integration: {
      name,
      owner: a.owner,
      hosts: [],
      service: { app: a.app },
      ...told(a),
      ...a.description == null ? {} : { description: a.description },
    },
    ...a.listed == !!held?.[PUBLISHED]
      ? {}
      : { [PUBLISHED]: publishing(a.listed) },
    ...i ? { $was: { integration: { owner: token(i.owner) } } } : {},
  }]
}

/** The authority retained by a service order or delayed operation. */
export type ServiceAuthority = {
  person: string
  app: string
  space: string
  service: string
  connection: string
  operation: string
}

/** Check the current person-owned connection and its source-app link. */
export let serviceAuthority = async (
  read: Read,
  a: ServiceAuthority,
): Promise<boolean> => {
  let rows = await read(
    `(.entity.eid=${a.connection}&.connection)|(.edge.from=${a.app}&.edge.to=${a.connection}&.uses)`,
  )
  let c = rows.find((b) => b.entity.eid == a.connection)?.connection as
    | Comp
    | undefined
  return !!c && c.owner == a.person && c.status == 'connected' &&
    c.integration == serviceName(a.service) && Array.isArray(c.scopes) &&
    c.scopes.includes(a.operation) &&
    rows.some((b) =>
      b.uses && (b.edge as Comp | undefined)?.from == a.app &&
      (b.edge as Comp | undefined)?.to == a.connection
    )
}

/** The person's explicit selection of service operations, or its revocation. */
export let grantService = async (
  read: Read,
  a: { person: string; connection: string; operations: string[] },
): Promise<Bundle[]> => {
  let [held] = await read(`.entity.eid=${a.connection}&.connection`)
  let c = held?.connection as Comp | undefined as Comp | undefined
  if (!c || c.owner != a.person) {
    throw new CallError(
      'access',
      'Only the person who owns this connection grants its operations',
    )
  }
  return [{
    entity: { eid: a.connection },
    connection: {
      scopes: [...new Set(a.operations)],
      status: a.operations.length ? 'connected' : 'needed',
    },
    $was: {
      connection: {
        owner: token(c.owner),
        scopes: token(c.scopes),
        status: token(c.status),
      },
    },
  }]
}
