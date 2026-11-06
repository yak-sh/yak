// T-143828: 845079031 published the pictures, fonts and sounds of six of
// jeff's apps through /api/public instead of releasing them. Release each
// published copy the checkout lacks with the app's code, then unpublish it, so
// the release is the one copy and an install carries it. Run once, as jeff:
//
//   deno run -A bin/migrate-published-assets.ts ~/.yak/yak.json
import { compose } from '@yaks/cli/host'
import { read as config } from '../packages/cli/config.ts'
import { account } from '../packages/admin/account.ts'
import {
  renewing,
  type Reply,
  rpc,
  storeUrl,
  valueOf,
} from '../packages/admin/api.ts'
import { asset, fileOf, push, read } from '../packages/admin/push.ts'

let SPACE = 'jeff'
let APPS = ['settlement', 'ladders', 'orbits', 'sound', 'yak-sh', 'yak-sh-v2']

let sha = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')

let host = await compose(config(Deno.args[0]), ['graph'])
let at = await account(host)(SPACE)
let auth = { authorization: `Bearer ${at.bearer}` }
let ok = async (r: Promise<Response>) => {
  let res = await r
  if (!res.ok) throw new Error(`${res.url} said ${res.status}`)
  return res
}
let door = (app: string, path = '') =>
  storeUrl(`${SPACE}/${app}`, `/public${path && `/${path}`}`)
try {
  for (let app of APPS) {
    let listed = await (await ok(fetch(door(app), { headers: auth })))
      .json() as {
        path: string
        sha: string
        url: string
      }[]
    let published = listed.filter((f) => asset(f.path))
    let local = await read(`apps/${app}`)
    let have = new Set(local.map((f) => f.path))
    for (let f of published.filter((f) => !have.has(f.path))) {
      let bytes = new Uint8Array(
        await (await ok(fetch(f.url, { headers: auth }))).arrayBuffer(),
      )
      if (await sha(bytes) != f.sha) throw new Error(`${app}/${f.path} sha`)
      local.push(fileOf(f.path, bytes))
    }
    let said = await push(rpc(at.bearer), local, { app, space: SPACE })
    // The release holds each one, with the same bytes, before its published
    // copy goes.
    let held = new Map(
      ((valueOf(
        await rpc(at.bearer)('tools/call', {
          name: 'app_files',
          arguments: { app, space: SPACE, op: 'list' },
        }) as Reply,
      )?.files ?? []) as { path: string; sha: string }[]).map((
        f,
      ) => [f.path, f.sha]),
    )
    let missing = published.filter((f) => held.get(f.path) != f.sha)
    if (missing.length) {
      throw new Error(`${app} release lacks ${missing.map((f) => f.path)}`)
    }
    for (let f of published) {
      await ok(fetch(door(app, f.path), { method: 'DELETE', headers: auth }))
    }
    console.log(JSON.stringify({
      app,
      published: published.length,
      released: said,
      unpublished: published.length,
      held: held.size,
    }))
  }
} finally {
  renewing(() => {})
}
