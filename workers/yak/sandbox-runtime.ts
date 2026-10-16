// The real SDK classes and their module-local outbound registry. Only a
// Sandbox DO incarnation or the outbound proxy loads this module: the proxy
// may run in an isolate that has never constructed a Sandbox.
import { env } from 'cloudflare:workers'
import * as sdk from '@cloudflare/sandbox'
import type { Env } from './env.ts'
import { apex } from './host.ts'
import { swapped } from './sandbox.ts'

export class Sandbox extends sdk.Sandbox<Env> {
  override interceptHttps = true
  constructor(...made: ConstructorParameters<typeof sdk.Sandbox<Env>>) {
    super(...made)
    Object.assign(this, { allowedHostsOverride: undefined })
  }
}

// The inherited setter registers by class name; an own static field would
// skip that registration. Keep the SDK class name and the existing hosts.
let platform = (req: Request, env: Env, out: { containerId: string }) =>
  swapped(env, out.containerId, req)
Sandbox.outboundByHost = { [apex(env)]: platform, [`*.${apex(env)}`]: platform }

export let ContainerProxy = sdk.ContainerProxy
