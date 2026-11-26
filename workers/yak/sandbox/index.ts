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
import { outgoing } from '@yaks/platform/app-outbound'
import { apex, type Host } from '@yaks/platform/host'
import { admitted, SLEEP, TIMEOUT } from '@yaks/sandbox/cloudflare'
import {
  ARCHIVE_PATH,
  filesystem,
  recovery,
  RECOVERY_HOST,
  snapshot,
} from '@yaks/sandbox/recovery'
import { moved } from '@yaks/durable-object/resets'
import { rehandshake } from '@yaks/workerd/upgrade'

type Env = Host & {
  KERNEL: {
    fetch(req: Request): Promise<Response>
    send(req: Request, container: string): Promise<Response>
    fault(message: string, container: string): Promise<void>
  }
  BLOBS: Parameters<typeof recovery>[2] & Parameters<typeof snapshot>[0]
}

let streamed = async function* (stream: Promise<ReadableStream<Uint8Array>>) {
  for await (let chunk of sdk.streamFile(await stream)) {
    yield typeof chunk == 'string' ? new TextEncoder().encode(chunk) : chunk
  }
}

export class Workbench extends sdk.Sandbox<Env> {
  override interceptHttps = true
  override sleepAfter = SLEEP
  private files = recovery(
    filesystem({
      live: () => this.ctx.container?.running === true,
      start: () =>
        admitted(() =>
          super.startAndWaitForPorts({
            cancellationOptions: {
              instanceGetTimeoutMS: 30_000,
              portReadyTimeoutMS: 120_000,
            },
          })
        ),
      exec: (command) => super.exec(command, { timeout: TIMEOUT }),
    }, () => streamed(super.readFileStream(ARCHIVE_PATH))),
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
          return this.use(() => invoke.apply(this, args))
        },
      })
    }
  }
  private use<T>(act: () => Promise<T>) {
    return this.files.use(async () => {
      try {
        return await act()
      } finally {
        this.renewActivityTimeout()
      }
    })
  }
  prepare() {
    return this.use(() => Promise.resolve())
  }
  override async destroy() {
    await this.files.stop(() => super.destroy())
  }
  purge() {
    return this.files.purge(() => super.destroy())
  }
  override async onStop(...args: Parameters<sdk.Sandbox<Env>['onStop']>) {
    this.files.reset()
    await super.onStop(...args)
  }
  // A deploy or move that resets the object mid-snapshot fails this alarm, and
  // the runtime retries it on the new instance, whose activity has expired, so
  // it saves again. A save writes a new archive and moves the head only once
  // that archive is whole, so a cut one is never the head; a moved instance's
  // failure is the retry working, not a fault (@yaks/durable-object `moved`).
  override async onActivityExpired() {
    try {
      await this.files.idle(
        async () =>
          (await super.listProcesses()).some(({ status }) =>
            status == 'starting' || status == 'running'
          ),
        () => super.destroy(),
      )
    } catch (error) {
      if (!moved(error)) {
        await this.env.KERNEL.fault(String(error), String(this.ctx.id))
      }
      throw error
    }
  }
}

// The inherited setter registers by class name; an own static field would
// skip that registration. The hosts are the deployment's (APEX).
let platform = (req: Request, env: Env, out: { containerId: string }) =>
  outgoing(req, out.containerId, env.KERNEL).then(rehandshake)
let restore = (req: Request, env: Env, out: { containerId: string }) =>
  snapshot(env.BLOBS, out.containerId, req)
let at = apex(env as Env)
Workbench.outboundByHost = {
  [at]: platform,
  [`*.${at}`]: platform,
  [RECOVERY_HOST]: restore,
}

export let ContainerProxy = sdk.ContainerProxy

export default {
  fetch: () => new Response(null, { status: 404 }),
}
