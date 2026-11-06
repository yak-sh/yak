// yak-sandbox's entry: the builder's workbench (../sandbox.ts), a Cloudflare
// Container behind @cloudflare/sandbox's Durable Object. The SDK is code
// compiled when an isolate starts, so it lives in this Worker's upload, where
// only the isolates that run a sandbox compile it, and not in the kernel's.
//
// The kernel reaches the object through its SANDBOX binding, a Durable Object
// namespace naming this script (../wrangler.toml). A container's HTTPS to this
// platform and its spaces comes back to the kernel's `SandboxOutbound`
// (../index.ts), which swaps the container's placeholder for its grant's token
// with the secret only the kernel holds (../sandbox.ts `swapped`). Everything
// else leaves the container directly.
import { env } from 'cloudflare:workers'
import * as sdk from '@cloudflare/sandbox'
import { apex, type Host } from '../host.ts'

type Env = Host & {
  KERNEL: { send(req: Request, container: string): Promise<Response> }
}

export class Sandbox extends sdk.Sandbox<Env> {
  override interceptHttps = true
  constructor(...made: ConstructorParameters<typeof sdk.Sandbox<Env>>) {
    super(...made)
    Object.assign(this, { allowedHostsOverride: undefined })
  }
}

// The inherited setter registers by class name; an own static field would
// skip that registration. The hosts are the deployment's (APEX).
let platform = (req: Request, env: Env, out: { containerId: string }) =>
  env.KERNEL.send(req, out.containerId)
let at = apex(env as Env)
Sandbox.outboundByHost = { [at]: platform, [`*.${at}`]: platform }

export let ContainerProxy = sdk.ContainerProxy

export default {
  fetch: () => new Response(null, { status: 404 }),
}
