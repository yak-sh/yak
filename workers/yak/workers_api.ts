// The account API endpoint used to upload app workers and their resources.
// A probe points it at its Cloudflare stand-in; production uses Cloudflare.
import type { Env } from './env.ts'

export let accountUrl = (env: Env, path: string) =>
  `${env.WORKERS_API ?? 'https://api.cloudflare.com/client/v4'}` +
  `/accounts/${env.CF_ACCOUNT}${path}`
