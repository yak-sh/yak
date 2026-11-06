import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { join } from 'node:path'
import { API, reads } from './deployed.ts'

let root = Deno.makeTempDirSync()
Deno.writeTextFileSync(
  join(root, 'wrangler.toml'),
  'name="yak"\naccount_id="acct"\n[env.staging]\nname="yak-staging"',
)
let sent: string[] = []
let answer = (status: number, result?: unknown) => (url: string) => {
  sent.push(url)
  return Promise.resolve(Response.json({ result }, { status }))
}
let headers = () => Promise.resolve({ Authorization: 'Bearer t' })

test('a read asks the script its config names in its environment', async () => {
  sent = []
  let read = reads(root, headers, answer(200, { deployments: [1] }))
  assertEquals(await read.deployments('wrangler.toml', ['--env', 'staging']), [
    1,
  ])
  let version = reads(root, headers, answer(200, { id: 'v' }))
  assertEquals(await version.version('wrangler.toml', 'v'), { id: 'v' })
  assertEquals(sent, [
    `${API}/accounts/acct/workers/scripts/yak-staging/deployments`,
    `${API}/accounts/acct/workers/scripts/yak/versions/v`,
  ])
})

test('a read Cloudflare, the credentials or the config refuse is unread', async () => {
  let refused = reads(root, headers, answer(404))
  assertEquals(await refused.deployments('wrangler.toml'), undefined)
  let signedOut = reads(root, () => Promise.reject(Error('no token')))
  assertEquals(await signedOut.version('wrangler.toml', 'v'), undefined)
  let missing = reads(root, headers, answer(200, { deployments: [] }))
  assertEquals(await missing.deployments('absent.toml'), undefined)
})
