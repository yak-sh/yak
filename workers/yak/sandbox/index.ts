// yak-sandbox's entry: the builder's workbench (../sandbox.ts), a Cloudflare
// Container behind @cloudflare/sandbox's Durable Object. The SDK is code
// compiled when an isolate starts, so it lives in this Worker's upload, where
// only the isolates that run a sandbox compile it, and not in the kernel's.
//
// The kernel reaches the object through its WORKBENCH binding, a Durable Object
// namespace naming this script (../wrangler.toml). A container's HTTPS to this
// platform and its spaces comes back to the kernel's `SandboxOutbound`
// (../index.ts), which swaps the container's placeholder for its grant's token
// with the secret only the kernel holds (../sandbox.ts `swapped`). Everything
// else leaves the container directly.
import { env } from 'cloudflare:workers'
import * as sdk from '@cloudflare/sandbox'
import { apex, type Host } from '@yaks/platform/host'
import { filesystem, recovery } from './recovery.ts'

type Env = Host & {
  KERNEL: {
    send(req: Request, container: string): Promise<Response>
    fault(message: string, container: string): Promise<void>
  }
  BLOBS: Parameters<typeof recovery>[2]
}

export class Workbench extends sdk.Sandbox<Env> {
  override interceptHttps = true
  private files = recovery(
    filesystem({
      getState: () => super.getState(),
      exec: (command) => super.exec(command, { timeout: 240_000 }),
    }),
    this.ctx.storage,
    this.env.BLOBS,
    String(this.ctx.id),
  )
  constructor(...made: ConstructorParameters<typeof sdk.Sandbox<Env>>) {
    super(...made)
    Object.assign(this, { allowedHostsOverride: undefined })
  }
  static {
    // Prototype methods remain RPC methods. Every workspace operation and
    // shutdown shares one queue, including a call arriving during idle stop.
    for (
      let method of [
        'exec',
        'startProcess',
        'getProcess',
        'killProcess',
        'getProcessLogs',
        'mkdir',
        'writeFile',
        'readFile',
      ]
    ) {
      let invoke = Reflect.get(sdk.Sandbox.prototype, method) as (
        ...args: unknown[]
      ) => Promise<unknown>
      Object.defineProperty(this.prototype, method, {
        value: function (this: Workbench, ...args: unknown[]) {
          return this.files.use(() => invoke.apply(this, args))
        },
      })
    }
  }
  prepare() {
    return this.files.use(() => Promise.resolve())
  }
  override async destroy() {
    await this.files.stop(() => super.destroy())
  }
  override async onActivityExpired() {
    try {
      await this.files.stop(() => super.onActivityExpired())
    } catch (error) {
      await this.env.KERNEL.fault(String(error), String(this.ctx.id))
      throw error
    }
  }
}

// The inherited setter registers by class name; an own static field would
// skip that registration. The hosts are the deployment's (APEX).
let platform = (req: Request, env: Env, out: { containerId: string }) =>
  env.KERNEL.send(req, out.containerId)
let at = apex(env as Env)
Workbench.outboundByHost = { [at]: platform, [`*.${at}`]: platform }

export let ContainerProxy = sdk.ContainerProxy

export default {
  fetch: () => new Response(null, { status: 404 }),
}
