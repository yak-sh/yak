// @yaks/claude as a provider a config names (@yaks/model `ProviderFacet`):
// `claude`, one signed-in `claude -p` per model turn, started on the first ask.
// The plugin's options are the command it runs (`command`, `args`).

import { deferredModel, type Lent, type Model } from '@yaks/model'
import type { Options } from './mod.ts'
import { claudeDoc } from './vocab.ts'

/** `claude`, the local Claude Code CLI. */
export let providers = (
  _lent: Lent,
  options: Options = {},
): Record<string, Model> => ({
  claude: deferredModel(
    () => import('./mod.ts').then(({ claude }) => claude(options)),
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
})
