// Service publication references the app's declaration, never a second schema.
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { CallError } from '@yaks/tools/errors'
import { integrationEid } from './identity.ts'
import {
  type About,
  type Integration,
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
  let [held] = await read(`.entity.eid=${eid}&.integration&?listed`)
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
    ...a.listed == !!held?.listed ? {} : { listed: a.listed ? {} : null },
    ...i ? { $was: { integration: { owner: token(i.owner) } } } : {},
  }]
}
