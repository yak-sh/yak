// The admin forwarding service runs under its own Unix identity. Its only
// private input is its state file; no credential enters an environment or argv.
import { client, type Provider, type Tokens } from '@yaks/oauth'
import { queue } from '@yaks/secrets'
import { report } from '@yaks/tracker/report'
import { forward } from '../packages/admin/forward.ts'

type State = {
  provider: Provider
  tokens: Tokens & { website_session?: string }
}
let path = Deno.args[0] ?? '/var/lib/yak-admin/account.json'
let state: State = JSON.parse(await Deno.readTextFile(path))
let held = queue()
let saved = JSON.stringify(state)
let persist = async () => {
  let next = JSON.stringify(state)
  if (next == saved) return
  let temporary = `${path}.tmp`
  await Deno.writeTextFile(temporary, next, { mode: 0o600 })
  await Deno.rename(temporary, path)
  saved = next
}
let update = <T>(fn: (tokens: State['tokens']) => Promise<T>) =>
  held('account', async () => {
    try {
      return await fn(state.tokens)
    } finally {
      await persist()
    }
  })
let oauth = client(state.provider, {
  key: 'admin',
  redirect: '',
  store: {
    read: () => Promise.resolve(state.tokens),
    update: (_, fn) => update(fn),
  },
})
let handler = forward({
  credential: async () => {
    let bearer = await oauth.token()
    if (!bearer) throw new Error('Admin has no OAuth grant')
    await held('account', persist)
    return { bearer, session: state.tokens.website_session }
  },
  renewed: (session) =>
    update((tokens) => {
      tokens.website_session = session
      return Promise.resolve()
    }),
})
Deno.serve({
  hostname: '127.0.0.1',
  port: 5176,
  onError: async () => {
    await report(new Error('Admin forwarding failed'), {
      tags: { source: 'admin-forward' },
      mechanism: 'catch',
      sink: async (rows) => {
        let response = await fetch('http://127.0.0.1:5173/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(rows),
          signal: AbortSignal.timeout(5000),
        })
        await response.body?.cancel()
        if (!response.ok) {
          throw new Error('Tracker refused admin forwarding report')
        }
      },
    })
    return new Response('Admin forwarding failed', { status: 502 })
  },
}, handler)
