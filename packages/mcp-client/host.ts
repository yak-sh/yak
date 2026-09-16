/** Private MCP OAuth records using the shared host store. */
import { fileAuthorizationStore as fileStore } from '@yaks/oauth/host'
import type { AuthorizationRecord, AuthorizationStore } from './oauth.ts'
export const fileAuthorizationStore = (path: string): AuthorizationStore =>
  fileStore<AuthorizationRecord>(path, (record) => {
    if (
      record.tokens &&
      (typeof record.tokens.access_token !== 'string' ||
        typeof record.tokens.token_type !== 'string' ||
        (record.tokens.refresh_token != null &&
          typeof record.tokens.refresh_token !== 'string'))
    ) throw new Error('Invalid OAuth credential record')
  })
