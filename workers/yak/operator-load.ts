// Generated from the configs and their packages' exports. Do not edit.
import type { Facets, Load, VocabFacet } from '@yaks/host'
import * as eager0_0 from '@yaks/alias/vocab'
import * as eager0_1 from '@yaks/anthropic/vocab'
import * as eager0_2 from '@yaks/blob/vocab'
import * as eager0_3 from '@yaks/context/vocab'
import * as eager0_4 from '@yaks/doc/vocab'
import * as eager0_5 from '@yaks/draft/vocab'
import * as eager0_6 from '@yaks/edge/vocab'
import * as eager0_7 from '@yaks/effects/vocab'
import * as eager0_8 from '@yaks/goal/vocab'
import * as eager0_9 from '@yaks/kernel/vocab'
import * as eager0_10 from '@yaks/key/vocab'
import * as eager0_11 from '@yaks/mail/vocab'
import * as eager0_12 from '@yaks/memory/vocab'
import * as eager0_13 from '@yaks/model/vocab'
import * as eager0_14 from '@yaks/notify/vocab'
import * as eager0_15 from '@yaks/openai/vocab'
import * as eager0_16 from '@yaks/persona/vocab'
import * as eager0_17 from '@yaks/phone/vocab'
import * as eager0_18 from '@yaks/platform/vocab'
import * as eager0_19 from '@yaks/project/vocab'
import * as eager0_20 from '@yaks/provenance/vocab'
import * as eager0_21 from '@yaks/session/vocab'
import * as eager0_22 from '@yaks/task/vocab'
import * as eager0_23 from '@yaks/tools/vocab'
import * as eager0_24 from '@yaks/topic/vocab'
import * as eager0_25 from '@yaks/trial/vocab'
import * as eager0_26 from '@yaks/wake/vocab'
import * as eager0_27 from './facets/operator-vocab.ts'
/** Each plugin's words, by plugin. */
export let vocabFacets: Record<string, VocabFacet> = {
  '@yaks/alias': eager0_0,
  '@yaks/anthropic': eager0_1,
  '@yaks/blob': eager0_2,
  '@yaks/context': eager0_3,
  '@yaks/doc': eager0_4,
  '@yaks/draft': eager0_5,
  '@yaks/edge': eager0_6,
  '@yaks/effects': eager0_7,
  '@yaks/goal': eager0_8,
  '@yaks/kernel': eager0_9,
  '@yaks/key': eager0_10,
  '@yaks/mail': eager0_11,
  '@yaks/memory': eager0_12,
  '@yaks/model': eager0_13,
  '@yaks/notify': eager0_14,
  '@yaks/openai': eager0_15,
  '@yaks/persona': eager0_16,
  '@yaks/phone': eager0_17,
  '@yaks/platform': eager0_18,
  '@yaks/project': eager0_19,
  '@yaks/provenance': eager0_20,
  '@yaks/session': eager0_21,
  '@yaks/task': eager0_22,
  '@yaks/tools': eager0_23,
  '@yaks/topic': eager0_24,
  '@yaks/trial': eager0_25,
  '@yaks/wake': eager0_26,
  'yak/operator': eager0_27,
}
let facets: Record<string, () => Promise<unknown>> = {
  '@yaks/alias/graph': () => import('@yaks/alias/graph'),
  '@yaks/blob/graph': () => import('@yaks/blob/graph'),
  '@yaks/draft/graph': () => import('@yaks/draft/graph'),
  '@yaks/id/graph': () => import('@yaks/id/graph'),
  '@yaks/key/graph': () => import('@yaks/key/graph'),
  '@yaks/session/graph': () => import('@yaks/session/graph'),
  '@yaks/topic/graph': () => import('@yaks/topic/graph'),
  '@yaks/wake/graph': () => import('@yaks/wake/graph'),
  'yak/operator/graph': () => import('./facets/operator-graph.ts'),
}
/** A plugin's facet, its words at once and anything else when first asked. */
export let load: Load = async (plugin, facet) => {
  if (facet == 'vocab') return vocabFacets[plugin] ?? null
  let take = facets[`${plugin}/${facet}`]
  return take ? await take() as Facets[typeof facet] : null
}
