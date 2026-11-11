// @yaks/claude as a provider a config names (@yaks/model `ProviderFacet`):
// `claude`, one signed-in `claude -p` per model step, each started before
// the step it answers (mod.ts `claude`).
// The plugin's options are the command it runs (`command`, `args`). The plan
// limits its replies carry are of the account the CLI signs in with in the
// host's environment.

import {
  accountEid,
  accountHome,
  deferredModel,
  type Lent,
  type Model,
} from '@yaks/model'
import type { Options } from './mod.ts'
import { claudeDoc } from './vocab.ts'

/** `claude`, the local Claude Code CLI. */
export let providers = (
  lent: Lent,
  options: Options = {},
): Record<string, Model> => {
  let dir = accountHome('claude', lent.env)
  let account = dir ? accountEid(dir) : undefined
  return {
    claude: deferredModel(
      () =>
        import('./mod.ts').then(({ claude }) =>
          claude({ account, ...options })
        ),
      {
        vocab: claudeDoc,
        info: true,
        mark: (reply) => ({
          claude: {
            response_id: reply.id,
            session_id: (reply as typeof reply & { claudeSession?: string })
              .claudeSession,
          },
        }),
      },
    ),
  }
}
