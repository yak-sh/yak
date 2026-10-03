// T-64683: transfer held provider connections without replacing credentials.
import { compose } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { identityEid } from '@yaks/graph'
import { reveal } from '@yaks/secrets'
let host = await compose(read(Deno.args[0]), ['graph'])
try {
  let owner = host.config.person
  if (!owner) throw new Error('configured person is required')
  let rows = await host.graph.read('.connection&?secret')
  let patches = []
  let unknown = 0
  for (let b of rows) {
    let c = b.connection as Record<string, unknown>
    let integration = String(c.integration)
    if (!['openai', 'openrouter'].includes(integration)) continue
    if (c.owner != identityEid('provider', [integration])) continue
    let account = c.account
    if (!account && integration == 'openai') {
      let s = b.secret as Record<string, unknown>
      let value = await reveal(host.vault, String(s.name), {
        env: () => undefined,
      })
      if (!value) throw new Error('held provider credential missing')
      let tokens = JSON.parse(value)
      let jwt = tokens.id_token ?? tokens.access_token
      let payload = jwt?.split('.')[1]
      if (payload) {
        let body = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(
              atob(payload.replaceAll('-', '+').replaceAll('_', '/')),
              (c) => c.charCodeAt(0),
            ),
          ),
        )
        account = body.email ?? body['https://api.openai.com/profile']?.email
      }
      if (typeof account != 'string' || !account.includes('@')) {
        throw new Error(
          'OpenAI identity unavailable; do not replace held grant',
        )
      }
    }
    if (!account) unknown++
    patches.push({
      entity: b.entity,
      connection: {
        owner,
        ...(account ? { account: String(account).toLowerCase() } : {}),
      },
    })
  }
  if (patches.length) await host.graph.apply(patches)
  let after = await host.graph.read('.connection&?secret')
  if (after.length != rows.length) throw new Error('connection count changed')
  for (let b of rows) {
    let now = after.find((x) => x.entity.eid == b.entity.eid)
    if (JSON.stringify(now?.secret) != JSON.stringify(b.secret)) {
      throw new Error('held credential changed')
    }
  }
  console.log(
    JSON.stringify({
      before: rows.length,
      moved: patches.length,
      unknownAccount: unknown,
      after: after.length,
      credentialHandlesPreserved: true,
    }),
  )
} finally {
  await host.close()
}
