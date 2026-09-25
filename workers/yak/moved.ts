// TODO(T-38030): delete this file, and its line in index.ts, once every app
// secret set with the old `app_secret_set` has been moved.
//
// The one pass that moves a secret an app's worker read as `env.NAME` into a
// connection the app uses by that same name (connections.ts), so the worker
// reads it exactly as before. A `secret_text` binding cannot be read back
// through the account API, so the value is read the only way there is: by the
// app's own script. Its worker is uploaded once more with a module in front
// that answers this pass's one-time word with the value, asked through the
// namespace, and then deployed again as every deploy is (deploy_worker.ts),
// which binds the new connection in its place (connections.ts `rebind`). The
// app answers its visitors throughout.
//
// `POST /api/moved` at the apex, by an owner of the `yak` space (the gate
// sell.ts `fees` keeps): `space`, `app`, `name`, `integration`, `hosts`, and
// `direct` and `anyone` as `true` where the secret was read raw or served
// everybody. The value is never answered.
import { connect, INTEGRATION, need, USES } from '@yaks/connections'
import { edgeEid } from '@yaks/edge'
import { bindings } from './bindings.ts'
import { ctxOf } from './connections.ts'
import { configured, deployWorker } from './deploy_worker.ts'
import { type App, directory, META, storeName } from './directory.ts'
import * as dirPart from './directory.ts'
import { carried, scriptName, secrets, upload, WORKER } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { prefixOf } from './files.ts'
import { r2Objects } from './lib/objects.ts'
import { whoIs } from './session.ts'

let json = (status: number, message: string) =>
  Response.json({ error: message }, { status })

let PROBE = '__yak_moved.js'

// The value, from the app's own script, as the pass's module hands it back.
let probed = async (
  env: Env,
  app: App,
  store: string,
  read: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>,
  name: string,
): Promise<string> => {
  let { config } = await configured(read)
  let main = JSON.stringify('./' + (config.main ?? WORKER))
  let word = crypto.randomUUID()
  let source = `import app from ${main}
export * from ${main}
export default {
  fetch(req, env, ctx) {
    return req.headers.get('x-yak-moved') === ${JSON.stringify(word)}
      ? Response.json({ value: env[${JSON.stringify(name)}] ?? null })
      : app.fetch(req, env, ctx)
  },
}
`
  let bytes = new TextEncoder().encode(source)
  let modules = await carried(
    (path) => path == PROBE ? Promise.resolve(bytes) : read(path),
    PROBE,
  )
  let held = await bindings(env, app)
  await upload(env, store, modules, { ...config, main: PROBE }, held)
  // A new upload serves within a moment; until then the app answers as it did.
  for (let tries = 0; tries < 20; tries++) {
    let r = await env.DISPATCH!.get(scriptName(store), {}, {
      outbound: { CALLER: { app: app.eid, level: null } },
    }).fetch(
      new Request('https://moved.invalid/', {
        headers: { 'x-yak-moved': word },
      }),
    )
    let said = r.headers.get('content-type')?.includes('json')
      ? await r.json().catch(() => null) as { value?: unknown } | null
      : (await r.body?.cancel(), null)
    if (typeof said?.value == 'string' && said.value) return said.value
    await new Promise((ok) => setTimeout(ok, 1000))
  }
  throw new Error(`${store}: the pass's module never answered`)
}

export let moved = async (req: Request, env: Env): Promise<Response> => {
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let meta = await dir.space(META.space)
  if (!meta) return json(503, 'the directory has not seeded yet')
  let who = await whoIs(req, env.SESSION_SECRET, (p) => dir.role(meta, p))
  if (who.role != 'owner') return json(403, `an owner of ${meta.slug} only`)
  if (req.method != 'POST') return json(405, 'post the secret to move')
  let form = await req.formData()
  let field = (k: string) => String(form.get(k) ?? '').trim()
  let space = await dir.space(field('space'))
  let app = space && await dir.app(space, field('app'))
  if (!space || !app) return json(404, 'no such app')
  let store = storeName(space, app)
  let name = field('name')
  if (!(await secrets(env, store))?.includes(name)) {
    return json(404, `${store} has no secret ${name}`)
  }
  let blobs = r2Objects(env.BLOBS)
  let read = (path: string) =>
    blobs.read(`${prefixOf(space, app)}/${path.replace(/^\/+/, '')}`)
  let value = await probed(env, app, store, read, name)
  let c = ctxOf(env)
  let made = await c.graph.apply(
    await need(c.graph.read, {
      owner: space.eid,
      app: app.eid,
      integration: field('integration'),
      hosts: field('hosts').split(',').map((h) => h.trim()).filter(Boolean),
      binding: name,
      direct: field('direct') == 'true',
    }),
  )
  let eid = made.find((b) => !b.edge && !b[INTEGRATION])!.entity.eid
  await connect(c, eid, { key: value })
  if (field('anyone') == 'true') {
    await c.graph.apply([{
      entity: { eid: edgeEid(app.eid, USES, eid) },
      [USES]: { anyone: true },
    }])
  }
  let deployed = await deployWorker(env, app, store, read)
  return Response.json({ connection: eid, binding: name, said: deployed.lines })
}
