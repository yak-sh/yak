import * as system from '@yaks/process/system'
import { importing } from '@yaks/fp/imports'
// Account selection and delivery belong to the concrete host. Domain tools
// forward ordinary arguments and never handle credentials or MCP envelopes.
import type { Bundle } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { tokenFor } from './store.ts'
import { doorUrl, rpc } from './rpc.ts'
import { saidBy } from './roster.ts'
import type { Result } from './roster.ts'
import type { Host } from '@yaks/host'
import { located, person } from './config.ts'
import type { AccountOptions } from './accounts.ts'
import { adminForward, forwarded } from './account-forward.ts'

type Selection = {
  as?: string
  via?: string
  host?: string
  state?: string
  config?: string
  env?: AccountOptions['env']
  fetch?: typeof globalThis.fetch
  credential?: (
    host: string,
    as?: string,
    agent?: boolean,
  ) => Promise<string | null>
}

/** Authenticated JSON delivery shared by HTTP commands and graph tools. */
export let readJson = async (
  url: string | URL,
  options: Selection = {},
): Promise<unknown> => {
  let origin = new URL(url)
  if (
    !['http:', 'https:'].includes(origin.protocol) || origin.username ||
    origin.password
  ) {
    throw new CallError(
      'arguments',
      'Choose an HTTP(S) origin without credentials',
    )
  }
  let key =
    options.host && new URL(doorUrl(options.host)).origin == origin.origin
      ? options.host
      : origin.host
  let token = options.credential
    ? await options.credential(key, options.as, !!options.via)
    : await tokenFor(key, options.state, {
      config: options.config,
      as: options.as,
      env: options.env,
      agent: !!options.via,
    })
  let headers = new Headers({ accept: 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (options.via) headers.set('x-via', options.via)
  let destination = forwarded(origin.href, token, false, {
    headers,
    redirect: 'error',
    cache: 'no-store',
  })
  let response = await (options.fetch ?? globalThis.fetch)(
    destination.url,
    destination.init,
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
  }
  return await response.json()
}

export let remote = async (
  name: string,
  args: Record<string, unknown>,
  options: {
    as?: string
    via?: string
    url?: string
    mixedAuth?: boolean
    credential?: Selection['credential']
    state?: string
    config?: string
  } = {},
): Promise<Bundle[]> => {
  let origin = new URL(options.url ?? 'https://yaks.app')
  if (
    !['http:', 'https:'].includes(origin.protocol) || origin.username ||
    origin.password
  ) {
    throw new CallError(
      'arguments',
      'Choose an HTTP(S) origin without credentials',
    )
  }
  let door = new URL(doorUrl(origin.origin))
  if (options.mixedAuth) door.searchParams.set('auth', 'mixed')
  let ask = rpc({
    url: door.href,
    token: () =>
      options.credential
        ? options.credential(origin.origin, options.as, !!options.via)
        : tokenFor(origin.origin, options.state, {
          as: options.as,
          config: options.config,
          agent: !!options.via,
        }),
    via: options.via,
  })
  let reply = await ask('tools/call', { name, arguments: args }) as Result
  if (reply.isError) throw new CallError('remote', saidBy(reply).text)
  let result = (reply.structuredContent as { result?: unknown } | undefined)
    ?.result
  if (!Array.isArray(result)) throw new Error(`${name} returned no bundles`)
  return result as Bundle[]
}

/** Bind delivery to this host's owner and vault, including nondefault configs. */
export let delivery = (
  host: Pick<Host, 'graph' | 'config' | 'vault'>,
): Pick<Host, 'remote' | 'readJson'> => {
  let credential = async (
    name: string,
    as?: string,
    agent?: boolean,
  ): Promise<string | null> => {
    let explicit = system.env.get('YAKS_TOKEN')
    if (explicit) return explicit
    let url = new URL(doorUrl(name))
    if (url.origin == 'https://yaks.app') {
      let forwarded = adminForward(host.config, as, agent)
      if (forwarded) return forwarded
    }
    let owner = await person(host)
    if (!owner || !host.graph.vocab.comp('connection')) return null
    let { accountCredential } = await importing(
      import.meta.resolve(located('@yaks/connections')),
    )
    let integration = url.hostname == 'yaks.app' ? 'yaks.app' : url.href
    return (await accountCredential(host, owner, integration, as))?.bearer ??
      null
  }
  return {
    remote: (name, args, options) =>
      remote(name, args, { ...options, credential }),
    readJson: (url, options) => readJson(url, { ...options, credential }),
  }
}
