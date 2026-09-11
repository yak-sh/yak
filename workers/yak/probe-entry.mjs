// Test-only entrypoint, bundled ONCE with the production kernel. The
// kernel still uses real workerd DO/SQLite, KV and R2 bindings. A lease changes
// only their physical names; all application addresses and request bytes stay
// the same. Nothing in the deployed worker imports this file.
import kernel, {
  Builder as KernelBuilder,
  Store as KernelStore,
  Wire as KernelWire,
} from './index.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
export { Files, Sandbox } from './index.ts'

const context = new AsyncLocalStorage()
const log = console.log.bind(console)
console.log = (...args) =>
  log(`[probe:${context.getStore()?.id ?? '-'}]`, ...args)
const header = 'x-yak-probe'
const read = (request) => JSON.parse(request.headers.get(header))

const environments = new Map()
function scoped(env, scope) {
  if (environments.has(scope.id)) return environments.get(scope.id)
  const prefix = `${scope.id}/`
  const value = JSON.stringify(scope)
  const result = {
    ...env,
    SESSION_SECRET: scope.secret,
    MAIL_DEV: '1',
    ...scope.vars,
  }
  for (const name of ['STORE', 'WIRE', 'BUILDER']) {
    const ns = env[name]
    result[name] = {
      idFromName: (name) => ns.idFromName(prefix + name),
      get: (id) => ({
        fetch: (request) => {
          const req = new Request(request)
          req.headers.set(header, value)
          return ns.get(id).fetch(req)
        },
      }),
    }
  }
  for (const name of ['OAUTH_KV', 'BLOBS', 'EXPORTS']) {
    const binding = env[name]
    if (!binding) continue
    result[name] = new Proxy(binding, {
      get(target, method) {
        if (
          ['get', 'getWithMetadata', 'head', 'put', 'delete'].includes(method)
        ) {
          return (key, ...args) =>
            target[method](
              Array.isArray(key) ? key.map((k) => prefix + k) : prefix + key,
              ...args,
            )
        }
        if (method === 'list') {
          return async (options = {}) => {
            const out = await target.list({
              ...options,
              prefix: prefix + (options.prefix ?? ''),
            })
            if (out.keys) {
              out.keys = out.keys.map((k) => ({
                ...k,
                name: k.name.slice(prefix.length),
              }))
            }
            if (out.objects) {
              out.objects = out.objects.map((k) => ({
                ...k,
                key: k.key.slice(prefix.length),
              }))
            }
            return out
          }
        }
        const member = target[method]
        return typeof member === 'function' ? member.bind(target) : member
      },
    })
  }
  environments.set(scope.id, result)
  return result
}

// Remember the namespace before constructing the real object, so hibernation
// and alarms recover the same bindings, without relying on isolate globals.
function object(Implementation) {
  return class {
    constructor(ctx, env) {
      this.ctx = ctx
      this.env = env
      ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS __probe (config TEXT NOT NULL)',
      )
      const rows = ctx.storage.sql.exec('SELECT config FROM __probe').toArray()
      if (rows.length) this.start(JSON.parse(rows[0].config))
    }
    start(scope) {
      this.scope = scope
      this.inner = context.run(
        scope,
        () => new Implementation(this.ctx, scoped(this.env, scope)),
      )
    }
    fetch(request) {
      const scope = read(request)
      if (!this.inner) {
        this.ctx.storage.sql.exec(
          'INSERT INTO __probe VALUES (?)',
          JSON.stringify(scope),
        )
        this.start(scope)
      }
      if (scope.id !== this.scope.id) {
        throw new Error('probe namespace mismatch')
      }
      const req = new Request(request)
      req.headers.delete(header)
      return context.run(this.scope, () => this.inner.fetch(req))
    }
    webSocketMessage(...args) {
      return context.run(
        this.scope,
        () => this.inner.webSocketMessage?.(...args),
      )
    }
    webSocketClose(...args) {
      return context.run(this.scope, () => this.inner.webSocketClose?.(...args))
    }
    webSocketError(...args) {
      return context.run(this.scope, () => this.inner.webSocketError?.(...args))
    }
    alarm(...args) {
      return context.run(this.scope, () => this.inner.alarm?.(...args))
    }
  }
}
export const Store = object(KernelStore)
export const Wire = object(KernelWire)
export const Builder = object(KernelBuilder)
export default {
  async fetch(request, env) {
    const scope = read(request)
    // Finish the HTTP upload before application code can reject it. workerd
    // may otherwise close the TCP socket while the proxy is still writing,
    // hiding an early 413/401 behind ECONNRESET instead of returning it.
    const req = new Request(
      request,
      request.body && !['GET', 'HEAD'].includes(request.method)
        ? { body: await request.arrayBuffer() }
        : undefined,
    )
    req.headers.delete(header)
    return context.run(scope, () => kernel.fetch(req, scoped(env, scope)))
  },
  email(message, env) {
    const scope = read(message)
    return context.run(scope, () => kernel.email(message, scoped(env, scope)))
  },
}
