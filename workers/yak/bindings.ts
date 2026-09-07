// A resource belongs to the app's immutable store handle. The directory keeps
// the intent before Cloudflare is called, so a lost reply can be found by name
// on retry and a failed deploy never strands storage without an owner.
import type { App } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { sha256 } from './versions.ts'
import { type Bound, type Config, requests } from './wrangler_app.ts'

export type Binding = Bound & { eid: string; app: string }
type Request = ReturnType<typeof requests>[number]
type Product = Bound['type']

export let SCOPES =
  'Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Vectorize Edit'

let scopes: Record<Product, string> = {
  d1: 'D1 Edit',
  r2_bucket: 'R2 Edit (Workers R2 Storage Edit)',
  vectorize: 'Vectorize Edit',
}

// The suffix distinguishes names that lowercase or truncate to the same text.
// The readable part still puts this resource beside its app in the dashboard.
export let resourceName = async (store: string, name: string) => {
  let key = (await sha256(new TextEncoder().encode(`${store}\0${name}`)))
    .slice(0, 10)
  let label = `${store}-${name}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 52).replace(/-+$/g, '')
  return `${label || 'app'}-${key}`
}

export let bindings = async (env: Env, app: Pick<App, 'eid'>) =>
  (await meta(env).query(`.binding.app=${app.eid}`)).map((r) => ({
    ...(r.binding as Omit<Binding, 'eid'>),
    eid: r.entity.eid,
  })).sort((a, b) =>
    a.name.localeCompare(b.name) || a.type.localeCompare(b.type)
  )

let paths: Record<Product, string> = {
  d1: '/d1/database',
  r2_bucket: '/r2/buckets',
  vectorize: '/vectorize/v2/indexes',
}

let api = async (
  env: Env,
  type: Product,
  method: string,
  path = '',
  body?: unknown,
): Promise<unknown> => {
  if (!env.CF_WORKERS_TOKEN) {
    throw new Error(`CF_WORKERS_TOKEN is missing; token scopes: ${SCOPES}`)
  }
  let r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT}` +
      paths[type] + path,
    {
      method,
      headers: {
        authorization: `Bearer ${env.CF_WORKERS_TOKEN}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  )
  if (r.status == 404 && (method == 'GET' || method == 'DELETE')) {
    await r.body?.cancel()
    return null
  }
  let out = await r.json().catch(() => null) as {
    success?: boolean
    result?: unknown
    errors?: { code?: number; message?: string }[]
  } | null
  if (r.ok && out?.success) return out.result
  let why = out?.errors?.map((e) => e.message ?? '').join('; ') ||
    `HTTP ${r.status}`
  // Only error messages leave this seam, and even a reflected credential may
  // not become part of a deploy report or the platform's error log.
  why = why.replaceAll(env.CF_WORKERS_TOKEN, '[redacted]').replace(
    /[\r\n]+/g,
    ' ',
  )
  let denied = [401, 403].includes(r.status) ||
    /authenticat|authoriz|permission|access denied/i.test(why)
  throw new Error(
    `cloudflare ${type}: ${why}` +
      (denied
        ? ` — CF_WORKERS_TOKEN needs ${scopes[type]}; token scopes: ${SCOPES}`
        : ''),
  )
}

let found = async (env: Env, b: Bound): Promise<string> => {
  if (b.type == 'd1') {
    let rows = await api(
      env,
      b.type,
      'GET',
      `?name=${encodeURIComponent(b.resource)}`,
    ) as { name: string; uuid: string }[] | null
    return rows?.find((r) => r.name == b.resource)?.uuid ?? ''
  }
  let row = await api(env, b.type, 'GET', `/${encodeURIComponent(b.resource)}`)
  return row ? b.resource : ''
}

let made = async (env: Env, b: Bound, want: Request) => {
  let config = want.preset
    ? { preset: want.preset }
    : { dimensions: want.dimensions, metric: want.metric }
  if (
    b.type == 'vectorize' && !want.preset && !(want.dimensions && want.metric)
  ) {
    throw new Error(
      `vectorize.${b.name}: first creation needs dimensions and metric, or preset, ` +
        'on this vectorize entry in wrangler.jsonc',
    )
  }
  let out = await api(env, b.type, 'POST', '', {
    name: b.resource,
    ...(b.type == 'vectorize' ? { config } : {}),
  }) as { uuid?: string; name?: string }
  let id = b.type == 'd1' ? out?.uuid : out?.name
  if (!id) {
    throw new Error(`cloudflare ${b.type}: creation returned no resource id`)
  }
  return id
}

let matches = (a: Bound, b: Pick<Bound, 'name' | 'type'>) =>
  a.name == b.name && a.type == b.type

export let provision = async (
  env: Env,
  app: Pick<App, 'eid'>,
  store: string,
  config: Config,
) => {
  let held = await bindings(env, app)
  let bound: Binding[] = []
  for (let want of requests(config)) {
    if (
      want.type == 'vectorize' && !want.preset &&
      !(want.dimensions && want.metric) &&
      !held.some((b) => matches(b, want))
    ) {
      throw new Error(
        `vectorize.${want.name}: first creation needs dimensions and metric, or preset, on this vectorize entry in wrangler.jsonc`,
      )
    }
  }
  for (let want of requests(config)) {
    let b = held.find((b) => matches(b, want))
    if (!b) {
      let resource = await resourceName(store, want.name)
      let row = {
        app: app.eid,
        name: want.name,
        type: want.type,
        id: '',
        resource,
      }
      try {
        let [saved] = await meta(env).apply([
          { entity: { eid: '$binding' }, binding: row },
        ], KERNEL)
        b = { ...row, eid: saved.entity.eid }
      } catch (e) {
        // Two releases may ask together; the graph's unique key decides who
        // wrote the intent, and both then address the same Cloudflare name.
        b = (await bindings(env, app)).find((b) => matches(b, want))
        if (!b) throw e
      }
    }
    if (!b.id) {
      let id = await found(env, b)
      if (!id) {
        try {
          id = await made(env, b, want)
        } catch (e) {
          // A racing create or a lost response is recoverable by its exact
          // reserved name. A refusal with no resource keeps the original why.
          id = await found(env, b).catch(() => '')
          if (!id) throw e
        }
      }
      try {
        await meta(env).apply([
          { entity: { eid: b.eid }, binding: { id } },
        ], KERNEL)
      } catch (e) {
        // Permanent deletion can finish while creation is in flight. The
        // successful create still owes cleanup when its owning row is gone.
        if (!(await bindings(env, app)).some((row) => row.eid == b!.eid)) {
          await discard(env, { ...b, id })
        }
        throw e
      }
      b = { ...b, id }
    }
    bound.push(b)
  }
  return bound
}

export let bindingLines = (bound: Bound[]) =>
  bound.map((b) =>
    `binding: ${b.name} (${b.type}) — ${b.resource}${
      b.id ? '' : '; creation pending'
    }`
  )

export let retained = (held: Bound[], config: Config) =>
  held.filter((b) => !requests(config).some((w) => matches(b, w)))
    .map((b) =>
      `kept: ${b.name} (${b.type}) — ${b.resource}; unbound, data retained until app_delete permanently erases the app`
    )

// Re-reading the first page makes a retry independent of a cursor whose
// objects the previous attempt already deleted. The final bucket DELETE is
// Cloudflare's proof that no objects remain.
let emptyBucket = async (env: Env, resource: string) => {
  let path = `/${encodeURIComponent(resource)}/objects`
  while (true) {
    let rows = await api(env, 'r2_bucket', 'GET', `${path}?per_page=1000`)
    if (rows === null) return
    if (!Array.isArray(rows) || rows.some((r) => typeof r?.key != 'string')) {
      throw new Error(
        `cloudflare r2_bucket: unreadable object list for ${resource}`,
      )
    }
    if (!rows.length) return
    for (let { key } of rows as { key: string }[]) {
      // fetch normalizes dot path segments before sending them. Refusing
      // preserves ownership instead of deleting a different object or route.
      if (key.split('/').some((s) => s == '.' || s == '..')) {
        throw new Error(
          `R2 ${resource}: remove object ${
            JSON.stringify(key)
          } through the R2 dashboard before app_delete; its dot path cannot be addressed by this API`,
        )
      }
      await api(
        env,
        'r2_bucket',
        'DELETE',
        `${path}/${key.split('/').map(encodeURIComponent).join('/')}`,
      )
    }
  }
}

// The directory record dies only after the remote delete succeeds. Retrying
// a partly finished app deletion is therefore safe, including an empty intent.
export let discard = async (env: Env, b: Bound) => {
  let id = b.id || await found(env, b)
  if (!id) return
  if (b.type == 'r2_bucket') await emptyBucket(env, b.resource)
  await api(env, b.type, 'DELETE', `/${encodeURIComponent(id)}`)
}

export let deleteBindings = async (env: Env, app: App) => {
  let held = await bindings(env, app)
  for (let b of held) {
    await discard(env, b)
    await meta(env).apply([
      { entity: { eid: b.eid }, tombstone: {} },
    ], KERNEL)
  }
}
