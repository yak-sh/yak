import { mint } from '@yaks/graph'
import { stamp } from './directory.ts'
import { defect } from './defects.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'

export type Action = {
  operation: string
  space?: string
  target?: string
  store?: string
  rehearse?: boolean
}

/** Record whose authority a privileged request uses, independently of whether
 * its downstream operation succeeds. An audit outage is reported and never
 * costs the administrator their action. */
export let audit = async (
  env: Env,
  who: Who,
  action: Action,
): Promise<void> => {
  try {
    await stamp(env, {
      entities: [{
        entity: { eid: mint() },
        admin_action: { person: who.person, ...action },
      }],
    }, { actor: { by: who.actor ?? who.person!, via: who.via } })
  } catch (error) {
    defect(error, {
      request: 'admin action record',
      operation: action.operation,
    })
  }
}
