import { equal, test } from '@yaks/testing'
import { mark } from './mark.ts'
import { providers } from './provider.ts'

let reply = { id: 'msg-1', model: 'haiku', items: [], claudeSession: 's-1' }
let requestedAt = Date.parse('2026-11-11T10:00:00Z')

test('a reply is marked with its ids and the expiry of the prefix it cached', () => {
  // The session resolver hands the reply the expiry its provider row's
  // lifetime gives; a host that passes the lifetime itself reads the same.
  let expires = '2026-11-11T11:00:00.000Z'
  let marked = {
    claude: {
      response_id: 'msg-1',
      session_id: 's-1',
      cache_expires_at: expires,
    },
  }
  equal(mark({ ...reply, cacheExpiresAt: expires }, { requestedAt }), marked)
  equal(mark(reply, { requestedAt, retention: 3600 }), marked)
})

test('a reply whose provider row records no lifetime is marked cold', () => {
  let { claude } = providers({ env: () => undefined } as never)
  equal(claude.mark?.(reply, { requestedAt }), {
    claude: { response_id: 'msg-1', session_id: 's-1', cache_expires_at: null },
  })
})
