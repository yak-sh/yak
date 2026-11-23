// The shared box can route platform requests through its private admin sign-in.
// This address is a transport selector. It is never sent to the platform.
import type { Config } from '@yaks/host'

export let FORWARDED = 'yak_admin_forward:'
export let ADMIN_ACCOUNT = 'admin@bot.yak.sh'

export let adminForward = (
  config: Pick<Config, 'plugins'>,
  as?: string,
  agent = false,
): string | undefined => {
  if (as ? !['admin', ADMIN_ACCOUNT].includes(as.toLowerCase()) : !agent) return
  let plugin = config.plugins?.find((p) =>
    typeof p != 'string' && p.use == '@yaks/admin'
  )
  let endpoint = typeof plugin == 'object' && plugin.with?.forward
  if (typeof endpoint == 'string') return FORWARDED + endpoint
}

export let forwarded = (
  url: string,
  credential: string | null | undefined,
  browser: boolean,
  init: RequestInit,
): { url: string; init: RequestInit } => {
  if (!credential?.startsWith(FORWARDED)) return { url, init }
  let headers = new Headers(init.headers)
  headers.delete('authorization')
  headers.delete('cookie')
  headers.set('x-yak-credential', browser ? 'session' : 'bearer')
  let target = new URL(credential.slice(FORWARDED.length))
  target.searchParams.set('url', url)
  return { url: target.href, init: { ...init, headers, redirect: 'manual' } }
}
