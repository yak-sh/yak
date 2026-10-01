// The command reads the serving process, not a freshly composed graph.

import type { CliCommand } from '@yaks/cli/host'
import type { Capture } from './capture.ts'
import type { Snapshot } from './snapshot.ts'

let anatomy = (value: Snapshot): string => {
  let { selection, coverage } = value
  let lines = [`anatomy: ${value.anatomy.host} (snapshot ${value.takenAt})`]
  if (selection) {
    lines.push(
      `nodes: ${selection.shown} shown, ${selection.matched} matched, ` +
        `${selection.total} total${selection.truncated ? ' (truncated)' : ''}`,
    )
  }
  for (let [group, parts] of Object.entries(value.anatomy)) {
    if (group == 'edges' || !Array.isArray(parts) || !parts.length) continue
    lines.push(
      `${group}: ${parts.length}; ` +
        `declared ${parts.filter((p) => p.declared).length}, ` +
        `loaded ${parts.filter((p) => p.loaded).length}, ` +
        `bound ${parts.filter((p) => p.bound).length}`,
    )
  }
  lines.push(`edges: ${value.anatomy.edges.length}`)
  lines.push(
    `coverage: ${coverage.scope}; activity ${coverage.activity}; ` +
      `recording ${coverage.recording}`,
  )
  let unknown = Object.entries(coverage.observed)
    .filter(([, observed]) => !observed).map(([group]) => group)
  if (unknown.length) lines.push(`unobserved: ${unknown.join(', ')}`)
  return lines.join('\n')
}

let activity = (value: Capture): string => {
  let lines = [
    `activity: ${value.epoch}; ${value.events.length} events; omitted records ${value.gap}`,
    `coverage: ${value.coverage}; recording is subscriber-only`,
  ]
  let recent = value.events.slice(-8)
  if (recent.length < value.events.length) {
    lines.push(
      `latest ${recent.length} events (use --json for the full capture)`,
    )
  }
  for (let event of recent) {
    lines.push(
      `${event.seq} ${event.stage} ${event.kind}:${event.name} span ${event.id}` +
        (event.parent ? ` parent ${event.parent}` : '') +
        (event.duration == null ? '' : ` ${event.duration}ms`) +
        (event.outcome ? ` ${event.outcome}` : ''),
    )
  }
  if (!recent.length) lines.push('no recorded events in this capture')
  return lines.join('\n')
}

/** The CLI door into the same served snapshots used by the page. */
export let commands: CliCommand[] = [{
  name: 'visualize',
  description:
    'Read the serving platform’s anatomy or bounded causal activity. ' +
    'The page is /visualize; these snapshots carry explicit coverage.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      what: {
        type: 'string',
        enum: ['anatomy', 'activity'],
        default: 'anatomy',
        description: 'which served snapshot to read',
      },
      group: {
        type: 'string',
        enum: [
          'packages',
          'roles',
          'facets',
          'comps',
          'tools',
          'commands',
          'effects',
          'rules',
          'hooks',
          'routes',
          'views',
          'inspectViews',
          'tui',
          'kits',
          'themes',
          'skills',
          'secrets',
        ],
        description: 'one anatomy group; omitted means all groups',
      },
      search: {
        type: 'string',
        description: 'plain-text anatomy search, not a graph query',
      },
      id: {
        type: 'string',
        description: 'an exact anatomy part id, not a stored entity id',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 5000,
        description:
          'maximum nodes (default 1000, max 5000) or activity events ' +
          '(default and max 256)',
      },
      wait: {
        type: 'integer',
        minimum: 0,
        maximum: 2000,
        default: 0,
        description:
          'activity capture milliseconds; zero reads available history',
      },
      json: {
        type: 'boolean',
        description: 'print the exact returned JSON snapshot or capture',
      },
      url: {
        type: 'string',
        description: 'HTTP(S) origin of yak serve; defaults to native config',
      },
    },
  },
  options: { positional: ['what'] },
  run: async (args, host, context) => {
    try {
      let what = args.what ?? 'anatomy'
      if (what != 'anatomy' && what != 'activity') {
        throw new Error('choose anatomy or activity')
      }
      if (
        what == 'activity' && ['group', 'search', 'id'].some((k) => k in args)
      ) {
        throw new Error('--group, --search and --id apply only to anatomy')
      }
      if (what == 'anatomy' && args.wait != null && args.wait != 0) {
        throw new Error('--wait applies only to activity')
      }
      let base = args.url
      if (typeof base != 'string') {
        let { PORT } = await import('@yaks/api/tools')
        let { hostname, port = PORT } = host.config
        base = `http://${
          !hostname || hostname == '0.0.0.0' ? '127.0.0.1' : hostname
        }:${port}`
      }
      let origin = new URL(base as string)
      if (!['http:', 'https:'].includes(origin.protocol)) {
        throw new Error('--url must be an HTTP(S) origin')
      }
      if (origin.username || origin.password) {
        throw new Error('--url must not contain credentials')
      }
      let url = new URL(`/visualize/${what}`, origin)
      let keys = what == 'anatomy'
        ? ['group', 'search', 'id', 'limit']
        : ['limit', 'wait']
      for (let key of keys) {
        let value = args[key]
        if (typeof value == 'string' || typeof value == 'number') {
          url.searchParams.set(key, String(value))
        }
      }
      // A selected origin's credential, never the unrelated default MCP host's.
      // x-via is provenance only. Redirects cannot forward either header.
      let { tokenFor, doorUrl } = await import('@yaks/cli')
      let key = new URL(doorUrl(context.host)).origin == origin.origin
        ? context.host
        : origin.host
      let token = tokenFor(key, context.state)
      let headers = new Headers({ accept: 'application/json' })
      if (token) headers.set('authorization', `Bearer ${token}`)
      if (context.via) headers.set('x-via', context.via)
      let response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        cache: 'no-store',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      }
      let value = await response.json()
      context.out(
        context.json || args.json
          ? JSON.stringify(value)
          : what == 'anatomy'
          ? anatomy(value as Snapshot)
          : activity(value as Capture),
      )
      return 0
    } catch (error) {
      context.note(
        `visualize: ${error instanceof Error ? error.message : String(error)}`,
      )
      return 1
    }
  },
}]
