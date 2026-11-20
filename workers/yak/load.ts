// Generated from the configs and their packages' exports. Do not edit.
import type { Facets, Load, VocabFacet } from '@yaks/host'
import type { ProviderFacet } from '@yaks/model'
import * as eager0_0 from '@yaks/admin/vocab'
import * as eager0_1 from '@yaks/alias/vocab'
import * as eager0_2 from '@yaks/anthropic/vocab'
import * as eager0_3 from '@yaks/api/vocab'
import * as eager0_4 from '@yaks/archetype/vocab'
import * as eager0_5 from '@yaks/blob/vocab'
import * as eager0_6 from '@yaks/builders/vocab'
import * as eager0_7 from '@yaks/canvas/vocab'
import * as eager0_8 from '@yaks/chat/vocab'
import * as eager0_9 from '@yaks/claude/vocab'
import * as eager0_10 from '@yaks/code/vocab'
import * as eager0_11 from '@yaks/connections/vocab'
import * as eager0_12 from '@yaks/context/vocab'
import * as eager0_13 from '@yaks/design/vocab'
import * as eager0_14 from '@yaks/doc/vocab'
import * as eager0_15 from '@yaks/draft/vocab'
import * as eager0_16 from '@yaks/dreaming/vocab'
import * as eager0_17 from '@yaks/edge/vocab'
import * as eager0_18 from '@yaks/effects/vocab'
import * as eager0_19 from '@yaks/egress/vocab'
import * as eager0_20 from '@yaks/embedding/vocab'
import * as eager0_21 from '@yaks/events/vocab'
import * as eager0_22 from '@yaks/file/vocab'
import * as eager0_23 from '@yaks/filter/vocab'
import * as eager0_24 from '@yaks/forms/vocab'
import * as eager0_25 from '@yaks/game/vocab'
import * as eager0_26 from '@yaks/git/vocab'
import * as eager0_27 from '@yaks/goal/vocab'
import * as eager0_28 from '@yaks/graph/vocab'
import * as eager0_29 from '@yaks/harness/vocab'
import * as eager0_30 from '@yaks/heal/vocab'
import * as eager0_31 from '@yaks/hook/vocab'
import * as eager0_32 from '@yaks/id/vocab'
import * as eager0_33 from '@yaks/inbox/vocab'
import * as eager0_34 from '@yaks/journal/vocab'
import * as eager0_35 from '@yaks/kernel/vocab'
import * as eager0_36 from '@yaks/key/vocab'
import * as eager0_37 from '@yaks/lens/vocab'
import * as eager0_38 from '@yaks/machine/vocab'
import * as eager0_39 from '@yaks/mail/vocab'
import * as eager0_40 from '@yaks/mcp-client/vocab'
import * as eager0_41 from '@yaks/member/vocab'
import * as eager0_42 from '@yaks/memory/vocab'
import * as eager0_43 from '@yaks/model/vocab'
import * as eager0_44 from '@yaks/notify/vocab'
import * as eager0_45 from '@yaks/openai/vocab'
import * as eager0_46 from '@yaks/openrouter/vocab'
import * as eager0_47 from '@yaks/page/vocab'
import * as eager0_48 from '@yaks/people/vocab'
import * as eager0_49 from '@yaks/persona/vocab'
import * as eager0_50 from '@yaks/phone/vocab'
import * as eager0_51 from '@yaks/platform/vocab'
import * as eager0_52 from '@yaks/process/vocab'
import * as eager0_53 from '@yaks/project/vocab'
import * as eager0_54 from '@yaks/provenance/vocab'
import * as eager0_55 from '@yaks/push/vocab'
import * as eager0_56 from '@yaks/rtc/vocab'
import * as eager0_57 from '@yaks/sandbox/vocab'
import * as eager0_58 from '@yaks/secrets/vocab'
import * as eager0_59 from '@yaks/session/vocab'
import * as eager0_60 from '@yaks/spawn/vocab'
import * as eager0_61 from '@yaks/speech/vocab'
import * as eager0_62 from '@yaks/spend/vocab'
import * as eager0_63 from '@yaks/sqlite/vocab'
import * as eager0_64 from '@yaks/task/vocab'
import * as eager0_65 from '@yaks/timing/vocab'
import * as eager0_66 from '@yaks/tmux/vocab'
import * as eager0_67 from '@yaks/tools/vocab'
import * as eager0_68 from '@yaks/topic/vocab'
import * as eager0_69 from '@yaks/tracker/vocab'
import * as eager0_70 from '@yaks/trial/vocab'
import * as eager0_71 from '@yaks/tunnel/vocab'
import * as eager0_72 from '@yaks/ux/vocab'
import * as eager0_73 from '@yaks/visualize/vocab'
import * as eager0_74 from '@yaks/vocab/vocab'
import * as eager0_75 from '@yaks/wake/vocab'
import * as eager0_76 from '@yaks/platform/app-vocab'
import * as eager0_77 from '@yaks/platform/attribution-vocab'
import * as eager0_78 from '@yaks/platform/directory-vocab'
import * as eager0_79 from './facets/git-vocab.ts'
import * as eager0_80 from '@yaks/platform/meter-vocab'
import * as eager0_81 from '@yaks/platform/models-vocab'
import * as eager0_82 from '@yaks/platform/outreach-vocab'
import * as eager0_83 from '@yaks/platform/refusals-vocab'
import * as eager0_84 from '@yaks/platform/trash-vocab'
import * as eager1_0 from '@yaks/anthropic/provider'
import * as eager1_1 from '@yaks/openai/provider'
import * as eager1_2 from '@yaks/openrouter/provider'
import * as eager1_3 from '@yaks/workers-ai/provider'
import * as eager2_0 from '@yaks/workers-ai/graph'
/** Each plugin's words, by plugin. */
export let vocabFacets: Record<string, VocabFacet> = {
  '@yaks/admin': eager0_0,
  '@yaks/alias': eager0_1,
  '@yaks/anthropic': eager0_2,
  '@yaks/api': eager0_3,
  '@yaks/archetype': eager0_4,
  '@yaks/blob': eager0_5,
  '@yaks/builders': eager0_6,
  '@yaks/canvas': eager0_7,
  '@yaks/chat': eager0_8,
  '@yaks/claude': eager0_9,
  '@yaks/code': eager0_10,
  '@yaks/connections': eager0_11,
  '@yaks/context': eager0_12,
  '@yaks/design': eager0_13,
  '@yaks/doc': eager0_14,
  '@yaks/draft': eager0_15,
  '@yaks/dreaming': eager0_16,
  '@yaks/edge': eager0_17,
  '@yaks/effects': eager0_18,
  '@yaks/egress': eager0_19,
  '@yaks/embedding': eager0_20,
  '@yaks/events': eager0_21,
  '@yaks/file': eager0_22,
  '@yaks/filter': eager0_23,
  '@yaks/forms': eager0_24,
  '@yaks/game': eager0_25,
  '@yaks/git': eager0_26,
  '@yaks/goal': eager0_27,
  '@yaks/graph': eager0_28,
  '@yaks/harness': eager0_29,
  '@yaks/heal': eager0_30,
  '@yaks/hook': eager0_31,
  '@yaks/id': eager0_32,
  '@yaks/inbox': eager0_33,
  '@yaks/journal': eager0_34,
  '@yaks/kernel': eager0_35,
  '@yaks/key': eager0_36,
  '@yaks/lens': eager0_37,
  '@yaks/machine': eager0_38,
  '@yaks/mail': eager0_39,
  '@yaks/mcp-client': eager0_40,
  '@yaks/member': eager0_41,
  '@yaks/memory': eager0_42,
  '@yaks/model': eager0_43,
  '@yaks/notify': eager0_44,
  '@yaks/openai': eager0_45,
  '@yaks/openrouter': eager0_46,
  '@yaks/page': eager0_47,
  '@yaks/people': eager0_48,
  '@yaks/persona': eager0_49,
  '@yaks/phone': eager0_50,
  '@yaks/platform': eager0_51,
  '@yaks/process': eager0_52,
  '@yaks/project': eager0_53,
  '@yaks/provenance': eager0_54,
  '@yaks/push': eager0_55,
  '@yaks/rtc': eager0_56,
  '@yaks/sandbox': eager0_57,
  '@yaks/secrets': eager0_58,
  '@yaks/session': eager0_59,
  '@yaks/spawn': eager0_60,
  '@yaks/speech': eager0_61,
  '@yaks/spend': eager0_62,
  '@yaks/sqlite': eager0_63,
  '@yaks/task': eager0_64,
  '@yaks/timing': eager0_65,
  '@yaks/tmux': eager0_66,
  '@yaks/tools': eager0_67,
  '@yaks/topic': eager0_68,
  '@yaks/tracker': eager0_69,
  '@yaks/trial': eager0_70,
  '@yaks/tunnel': eager0_71,
  '@yaks/ux': eager0_72,
  '@yaks/visualize': eager0_73,
  '@yaks/vocab': eager0_74,
  '@yaks/wake': eager0_75,
  'yak/app': eager0_76,
  'yak/attribution': eager0_77,
  'yak/directory': eager0_78,
  'yak/git': eager0_79,
  'yak/meter': eager0_80,
  'yak/models': eager0_81,
  'yak/outreach': eager0_82,
  'yak/refusals': eager0_83,
  'yak/trash': eager0_84,
}
/** The providers config.ts `providing` and `serving` name, by plugin. */
export let providerFacets: Record<string, ProviderFacet> = {
  '@yaks/anthropic': eager1_0,
  '@yaks/openai': eager1_1,
  '@yaks/openrouter': eager1_2,
  '@yaks/workers-ai': eager1_3,
}
/** The graph facets config.ts `embedding` names, by plugin. */
export let lenderFacets: Record<string, Facets['graph']> = {
  '@yaks/workers-ai': eager2_0,
}
let facets: Record<string, () => Promise<unknown>> = {
  '@yaks/alias/graph': () => import('@yaks/alias/graph'),
  '@yaks/archetype/graph': () => import('@yaks/archetype/graph'),
  '@yaks/blob/graph': () => import('@yaks/blob/graph'),
  '@yaks/builders/graph': () => import('@yaks/builders/graph'),
  '@yaks/builders/effects': () => import('@yaks/builders/effects'),
  '@yaks/builders/tools': () => import('@yaks/builders/tools'),
  '@yaks/chat/effects': () => import('@yaks/chat/effects'),
  '@yaks/cloudflare-mail/graph': () => import('@yaks/cloudflare-mail/graph'),
  '@yaks/connections/graph': () => import('@yaks/connections/graph'),
  '@yaks/connections/effects': () => import('@yaks/connections/effects'),
  '@yaks/connections/tools': () => import('@yaks/connections/tools'),
  '@yaks/doc/graph': () => import('@yaks/doc/graph'),
  '@yaks/draft/graph': () => import('@yaks/draft/graph'),
  '@yaks/edge/graph': () => import('@yaks/edge/graph'),
  '@yaks/egress/graph': () => import('@yaks/egress/graph'),
  '@yaks/forms/graph': () => import('@yaks/forms/graph'),
  '@yaks/forms/effects': () => import('@yaks/forms/effects'),
  '@yaks/id/graph': () => import('@yaks/id/graph'),
  '@yaks/journal/graph': () => import('@yaks/journal/graph'),
  '@yaks/key/graph': () => import('@yaks/key/graph'),
  '@yaks/mail/graph': () => import('@yaks/mail/graph'),
  '@yaks/mail/effects': () => import('@yaks/mail/effects'),
  '@yaks/mail/tools': () => import('@yaks/mail/tools'),
  '@yaks/member/graph': () => import('@yaks/member/graph'),
  '@yaks/memory/graph': () => import('@yaks/memory/graph'),
  '@yaks/memory/tools': () => import('@yaks/memory/tools'),
  '@yaks/model/graph': () => import('@yaks/model/graph'),
  '@yaks/people/graph': () => import('@yaks/people/graph'),
  '@yaks/phone/effects': () => import('@yaks/phone/effects'),
  '@yaks/pinnacle/graph': () => import('@yaks/pinnacle/graph'),
  '@yaks/resend/graph': () => import('@yaks/resend/graph'),
  '@yaks/rtc/effects': () => import('@yaks/rtc/effects'),
  '@yaks/secrets/graph': () => import('@yaks/secrets/graph'),
  '@yaks/session/graph': () => import('@yaks/session/graph'),
  '@yaks/stripe/graph': () => import('@yaks/stripe/graph'),
  '@yaks/telnyx/graph': () => import('@yaks/telnyx/graph'),
  '@yaks/topic/graph': () => import('@yaks/topic/graph'),
  '@yaks/tunnel/effects': () => import('@yaks/tunnel/effects'),
  '@yaks/voipms/graph': () => import('@yaks/voipms/graph'),
  '@yaks/wake/graph': () => import('@yaks/wake/graph'),
  'yak/admit/graph': () => import('@yaks/platform/admit-graph'),
  'yak/app/graph': () => import('@yaks/platform/app-graph'),
  'yak/app/effects': () => import('./facets/app-effects.ts'),
  'yak/attribution/effects': () => import('./facets/attribution-effects.ts'),
  'yak/authorship/graph': () => import('@yaks/platform/authorship-graph'),
  'yak/describe/graph': () => import('@yaks/platform/describe-graph'),
  'yak/directory/graph': () => import('./facets/directory-graph.ts'),
  'yak/directory/effects': () => import('./facets/directory-effects.ts'),
  'yak/embed/graph': () => import('@yaks/platform/embed-graph'),
  'yak/git/graph': () => import('@yaks/platform/git-graph'),
  'yak/git/effects': () => import('./facets/git-effects.ts'),
  'yak/kills/graph': () => import('@yaks/platform/kills-graph'),
  'yak/lenses/graph': () => import('@yaks/platform/lenses-graph'),
  'yak/lexicon/graph': () => import('@yaks/platform/lexicon-graph'),
  'yak/log/graph': () => import('@yaks/platform/log-graph'),
  'yak/lower/graph': () => import('@yaks/platform/lower-graph'),
  'yak/meter/graph': () => import('@yaks/platform/meter-graph'),
  'yak/models/effects': () => import('./facets/models-effects.ts'),
  'yak/outreach/effects': () => import('./facets/outreach-effects.ts'),
  'yak/pages/graph': () => import('./facets/pages-graph.ts'),
  'yak/publishing/graph': () => import('@yaks/platform/publishing-graph'),
  'yak/refusals/effects': () => import('./facets/refusals-effects.ts'),
  'yak/remake/graph': () => import('@yaks/platform/remake-graph'),
  'yak/rouse/graph': () => import('@yaks/platform/rouse-graph'),
  'yak/signin/graph': () => import('./facets/signin-graph.ts'),
  'yak/trash/graph': () => import('@yaks/platform/trash-graph'),
  'yak/trash/effects': () => import('./facets/trash-effects.ts'),
  'yak/weigh/graph': () => import('@yaks/platform/weigh-graph'),
  'yak/wrap/graph': () => import('@yaks/platform/wrap-graph'),
}
/** A plugin's facet, its words at once and anything else when first asked. */
export let load: Load = async (plugin, facet) => {
  if (facet == 'vocab') return vocabFacets[plugin] ?? null
  let take = facets[`${plugin}/${facet}`]
  return take ? await take() as Facets[typeof facet] : null
}
