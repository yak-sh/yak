/** Private local file storage for OpenRouter keys obtained through PKCE or
 * provisioned by hand. */
import { fileAuthorizationStore } from '@yaks/oauth/host'
import { authorization, type Record } from './oauth.ts'

/** Uses the same locked, private file backend as MCP authorization. */
export const fileAuthorization = (
  path: string,
): ReturnType<typeof authorization> =>
  authorization({ store: fileAuthorizationStore<Record>(path) })
