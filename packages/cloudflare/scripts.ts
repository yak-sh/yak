// A Worker script's secrets on the account, as the account API keeps them:
// one put names the secret and its value, which Cloudflare never answers back.
// Putting one deploys the script's current version again with it.
import { type Account, accountUrl, answered, resent } from './api.ts'

/** Put `value` as the secret `name` on the Worker `script`, with `token`
 * (Workers Scripts write).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let sent: [string, RequestInit][] = []
 * let fetch = globalThis.fetch
 * globalThis.fetch = (url, init) => (
 *   sent.push([String(url), init!]),
 *     Promise.resolve(Response.json({ success: true, result: {} }))
 * )
 * await putSecret({ CF_ACCOUNT: 'a', token: 't' }, 'yak', 'KEY', 'v')
 * globalThis.fetch = fetch
 * assertEquals(sent[0][0], 'https://api.cloudflare.com/client/v4/accounts/a/workers/scripts/yak/secrets')
 * assertEquals(JSON.parse(String(sent[0][1].body)), { name: 'KEY', text: 'v', type: 'secret_text' })
 * ```
 */
export let putSecret = async (
  account: Account & { token: string },
  script: string,
  name: string,
  value: string,
): Promise<void> => {
  await answered(
    await resent(
      accountUrl(
        account,
        `/workers/scripts/${encodeURIComponent(script)}/secrets`,
      ),
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${account.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name, text: value, type: 'secret_text' }),
      },
    ),
  )
}
