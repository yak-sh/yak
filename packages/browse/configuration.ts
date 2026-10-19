// Private configuration writes bypass the offline outbox: a pasted credential
// is sent once to the server's vault boundary and never retained for replay.
import type { Bundle } from '@yaks/graph'
import type { AuthAction, AuthReply } from '@yaks/connections'
import { sealed } from '@yaks/secrets'
import { base } from './live.ts'
import { hosting } from './hosting.ts'

let post = async (path: string, body: unknown) => {
  let response = await fetch(base() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let result = await response.json()
  if (!response.ok) throw new Error(result.message ?? result.error ?? 'Refused')
  return result
}

export let saveSecret = (
  name: string,
  value: string,
  eid?: string,
): Promise<Bundle[]> => {
  let bundle = sealed(name, value)
  return post(hosting().apply, [{
    ...bundle,
    entity: { eid: eid ?? bundle.entity.eid },
  }])
}

export let signIn = (
  action: AuthAction,
  name?: string,
  callback?: string,
): Promise<AuthReply> => post('/web/authorize', { action, name, callback })
