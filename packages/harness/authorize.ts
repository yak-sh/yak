// One authorization control for the terminal app and the CLI. The attempt is
// private to this process; a completed grant lives in the connection's vault.

import { identityEid } from '@yaks/graph'
import { install, known } from '@yaks/connections'
import { graphMCP } from './mcp_registry.ts'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import { REDIRECT, type SignIns, signins } from './signin.ts'
import type { Harness } from './store.ts'

let OPENAI = identityEid('provider', ['openai'])
let OPENROUTER = identityEid('provider', ['openrouter'])
let PROVIDERS = [
  {
    label: 'OpenAI (model provider)',
    owner: OPENAI,
    integration: 'openai',
    redirect: 'http://127.0.0.1:1455/auth/callback',
  },
  {
    label: 'OpenRouter (model provider)',
    owner: OPENROUTER,
    integration: 'openrouter',
    redirect: REDIRECT,
  },
]

export type Authorization = {
  run: (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ) => Promise<MCPAuthReply>
  signin: SignIns
  mcp: ReturnType<typeof graphMCP>
  close: () => Promise<void>
}

export let authorize = (h: Pick<Harness, 'g' | 'vault'>): Authorization => {
  let signin = signins(h)
  let mcp = graphMCP(h, signin)
  let run = async (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ): Promise<MCPAuthReply> => {
    if (action == 'list') {
      let reply = await mcp.control(action)
      let router = await h.g.read(`.eid=${OPENROUTER}&.provider`)
      return {
        ...reply,
        servers: [
          ...reply.servers ?? [],
          PROVIDERS[0].label,
          ...router.length ? [PROVIDERS[1].label] : [],
        ],
      }
    }
    let provider = PROVIDERS.find((p) => p.label == name)
    if (!provider) return mcp.control(action, name, callback)
    if (action == 'cancel') {
      signin.cancel(provider.owner)
      return { message: 'Authorization cancelled' }
    }
    if (action == 'begin') {
      // A CLI command may reach this graph before its integration-install
      // effect runs. Apply the same seed change before asking for its link.
      if (!await known(h.g.read, provider.integration)) {
        let seed = await install(h.g.read)
        if (seed.length) await h.g.apply(seed, { trusted: true })
      }
      // A CLI sign-in can start before a model or session seeded this provider.
      if (provider.owner == OPENAI) {
        await h.g.apply([{
          entity: { eid: OPENAI },
          provider: { name: 'openai' },
        }])
      }
      return signin.begin(
        provider.owner,
        provider.integration,
        provider.redirect,
      )
    }
    await signin.complete(provider.owner, provider.integration, callback ?? '')
    return {
      message: provider.integration == 'openrouter'
        ? 'OpenRouter connected. Select an OpenRouter model explicitly to use it.'
        : 'OpenAI connected.',
    }
  }
  return {
    run,
    signin,
    mcp,
    close: async () => {
      signin.cancel()
      await mcp.close()
    },
  }
}
