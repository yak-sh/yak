import {
  connect,
  CONNECTION,
  credential,
  type Ctx,
  fieldsOf,
  keyed,
  keysOf,
  known,
  need,
  USES,
} from '@yaks/connections'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line } from '@yaks/query'
import { CallError } from '@yaks/tools/errors'
import { PLATFORM_STORE } from './names.ts'

let openai = { integration: 'openai-api', hosts: ['api.openai.com'] }
let imports: Record<string, { integration: string; hosts: string[] }> = {
  OPENAI_API_KEY: openai,
  OPENAI_MODELS_KEY: openai,
  OPENAI_OPERATOR_API_KEY: openai,
  OPENAI_VOICE_KEY: openai,
  ANTHROPIC_API_KEY: { integration: 'anthropic', hosts: ['api.anthropic.com'] },
  DEEPGRAM_API_KEY: { integration: 'deepgram', hosts: [] },
  ELEVENLABS_API_KEY: {
    integration: 'elevenlabs',
    hosts: ['api.elevenlabs.io'],
  },
  RESEND_TOKEN: { integration: 'resend-yaks-app', hosts: ['api.resend.com'] },
  RESEND_PLATFORM_TOKEN: {
    integration: 'resend-bot-yak-sh',
    hosts: ['api.resend.com'],
  },
  TELNYX_API_KEY: { integration: 'telnyx-platform', hosts: ['api.telnyx.com'] },
}

let comp = (row: Bundle, name: string) => (row[name] ?? {}) as Comp

type Source = {
  worker: (binding: string) => string | undefined
  mint?: () => Promise<string>
}

type Imported = {
  binding: string
  connection: Eid
  status: 'connected' | 'imported'
  workerMatches?: boolean
}

let target = async (
  c: Ctx,
  app: Eid,
  owner: Eid,
  binding: string,
  integration: string,
) => {
  let links = await c.graph.read(
    line`.edge.from=${app}&.${USES}.binding=${binding}&*`,
  )
  if (!links.length) {
    let rows = await c.graph.apply(
      await need(c.graph.read, {
        app,
        owner,
        binding,
        integration,
        separate: true,
      }),
    )
    return rows.find((b) => b[CONNECTION])!
  }
  let [link] = links
  let use = comp(link, USES)
  let to = String(comp(link, 'edge').to)
  let [row] = await c.graph.read(line`.entity.eid=${to}&.${CONNECTION}&*`)
  if (
    links.length != 1 || use.each || use.lender || use.lends || use.direct ||
    !row || comp(row, CONNECTION).owner != owner ||
    comp(row, CONNECTION).integration != integration
  ) {
    throw new CallError(
      'binding',
      'Choose the platform’s own provider connection for this binding',
    )
  }
  return row
}

/** Import one provider credential and confirm it through the platform's
 * serving read. The result carries only the binding, connection and status. */
export let importCredential = (
  c: Ctx,
  binding: string,
  source: Source,
): Promise<Imported> => {
  if (
    !Object.hasOwn(imports, binding) ||
    source.mint && imports[binding] != openai
  ) {
    throw new CallError(
      'binding',
      'Choose a supported platform provider binding',
    )
  }
  return c.vault.lock(
    derivedEid(`platform credential import ${binding}`),
    async () => {
      let { integration, hosts } = imports[binding]
      let [app] = await c.graph.read(line`.app.store=${PLATFORM_STORE}&*`)
      if (!app) {
        throw new CallError(
          'platform',
          'The platform app is unavailable',
        )
      }
      let owner = String(comp(app, 'app').space)
      let i = await known(c.graph.read, integration)
      if (
        !i || !keyed(i) || fieldsOf(i).length != 1 ||
        i.hosts.join() != hosts.join() || i.owner && i.owner != owner
      ) {
        throw new CallError(
          'integration',
          `Set up the ${integration} integration for the platform first`,
        )
      }

      let row = await target(c, app.entity.eid, owner, binding, integration)
      let connection = row.entity.eid
      let worker = source.mint ? undefined : source.worker(binding)
      let status = comp(row, CONNECTION).status
      if (
        status !== 'needed' && status !== 'connected' && status !== 'broken'
      ) {
        throw new Error('Unknown platform connection status')
      }
      let serving = async () => (await keysOf(c, app.entity.eid))[binding]
      let current = status == 'connected'
        ? await credential(c, connection)
        : undefined
      if (current) {
        if (await serving() != current) {
          throw new CallError(
            'binding',
            'The connected key is not serving this platform binding',
          )
        }
        return {
          binding,
          connection,
          status: 'connected',
          ...(worker && { workerMatches: current == worker }),
        }
      }
      if (row.provisional) {
        throw new CallError(
          'pending',
          'The connection is still saving. Retry the import shortly.',
        )
      }
      let key = source.mint ? await source.mint() : worker
      if (!key) {
        throw new CallError(
          'source',
          'The Worker has no key for this provider binding',
        )
      }
      await connect(c, connection, {
        key,
        expect: status,
      })
      if (await serving() != key) {
        throw new CallError(
          'pending',
          'The key is not serving from the connection yet. Retry the import shortly.',
        )
      }
      return {
        binding,
        connection,
        status: 'imported',
        ...(worker && { workerMatches: true }),
      }
    },
  )
}
