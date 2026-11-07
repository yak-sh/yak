/** Browse's terminal commands serve `web` in their own process: the graph
 * they open answers the terminal's HTTP and subscriptions on a loopback port
 * of its own, so no `yak serve` need run first, and other processes' commits
 * still arrive through the host's feed. `--app` browses a yaks.app store
 * instead; configured domains supply views. */
import type { CliCommand, Host } from '@yaks/cli/host'
import { subpath, used } from '@yaks/cli/config'

// This process's own web, on a port nobody else asked for.
let listen = async (host: Host) => {
  if (!host.handler) {
    throw new Error('browse has no handler — compose @yaks/api')
  }
  let { denoListen } = await import('@yaks/api')
  let at = Promise.withResolvers<string>()
  let server = denoListen({
    port: 0,
    hostname: '127.0.0.1',
    onListen: ({ hostname, port }) => at.resolve(`http://${hostname}:${port}`),
  }, host.handler)
  return {
    url: await at.promise,
    close: async () => {
      await server.shutdown()
      await server.finished
    },
  }
}

/** The app a person names, as the account door resolves it: `space/app` or
 * a slug, or the app's address on the host (`yourname.yaks.app/packing`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(named('https://yourname.yaks.app/packing/', 'yaks.app'), 'yourname/packing')
 * assertEquals(named('yourname/packing', 'yaks.app'), 'yourname/packing')
 * ```
 */
export let named = (app: string, host: string): string => {
  let at = app.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  let [domain, slug] = at.split('/')
  let space = domain.endsWith(`.${host}`) && domain.slice(0, -host.length - 1)
  return space && slug ? `${space}/${slug}` : at
}

// Only the app's own origin hears the token.
let signed =
  (origin: string, headers: Record<string, string>): typeof fetch =>
  (input, init) => {
    let url = new URL(input instanceof Request ? input.url : input)
    if (url.origin != origin) return fetch(input, init)
    let given = new Headers(init?.headers)
    for (let [k, v] of Object.entries(headers)) given.set(k, v)
    return fetch(input, { ...init, headers: given })
  }

let open: CliCommand = {
  name: 'open',
  description:
    'Open a yaks app built on the kits in this terminal, over its own rows: ' +
    'Tab walks its controls, Enter and Space press, q quits.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['app'],
    properties: {
      app: {
        type: 'string',
        description:
          'the app: space/app, a slug, or its address (yourname.yaks.app/packing)',
      },
    },
  },
  positional: ['app'],
  run: async (args, host, context) => {
    try {
      let { url, wire } = await (await import('./remote.ts')).remote(
        named(String(args.app), context.host),
        context.host,
        context.state,
        undefined,
        { config: context.config, as: context.as },
      )
      let page = url.replace(/api\/?$/, '')
      let go = signed(
        new URL(url).origin,
        wire.headers as Record<string, string>,
      )
      await (await import('./kit.ts')).open(page, url.replace(/\/$/, ''), go)
      return 0
    } catch (error) {
      await host.report?.(error, {
        tags: { step: 'terminal', command: 'yak open' },
      })
      context.note(error instanceof Error ? error.message : String(error))
      return 1
    }
  },
}

let browsers: CliCommand[] = ['browse', 'inspect'].map((name) => ({
  name,
  description: name == 'browse'
    ? 'Browse the graph in this terminal.'
    : 'Browse an Inspect page: the map, an id, or a query.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      app: { type: 'string', description: 'a yaks.app app: slug or space/app' },
      what: { type: 'string', description: 'id or query to open' },
    },
  },
  positional: ['what'],
  roles: ['web'],
  run: async (args, host, context) => {
    let own: Awaited<ReturnType<typeof listen>> | undefined
    try {
      let connection = typeof args.app == 'string'
        ? await (await import('./remote.ts')).remote(
          args.app,
          context.host,
          context.state,
          undefined,
          { config: context.config, as: context.as },
        )
        : { url: (own = await listen(host)).url, wire: {} }
      let { open } = await import('./terminal.ts')
      let { onFailure } = await import('./failure.ts')
      let restore = onFailure((error, place) => {
        void host.report?.(error, {
          tags: { step: 'render', place, command: `yak ${name}` },
        })
      })
      try {
        await open(connection.url, {
          what: String(args.what ?? ''),
          inspect: name == 'inspect',
          wire: connection.wire,
          facets: async () =>
            (await Promise.all(
              (host.config.plugins ?? []).map((p) =>
                subpath<import('./components/inspect.tsx').Facet>(
                  used(p),
                  'views',
                )
              ),
            )).filter((f) => f != null),
        })
      } finally {
        restore()
      }
      return 0
    } catch (error) {
      await host.report?.(error, {
        tags: { step: 'terminal', command: `yak ${name}` },
      })
      context.note(
        error instanceof Error ? error.stack ?? error.message : String(error),
      )
      return 1
    } finally {
      await own?.close()
    }
  },
}))

export let commands: CliCommand[] = [...browsers, open]
