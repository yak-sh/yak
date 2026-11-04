// What a box keeps of what its provider posts: a text that arrived becomes a
// `text` entity, STOP takes back the sender's consent, and a later failure
// of a text that left bounces it. Pure: it answers bundles from what a read
// found, and the caller applies them.

import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { consentEid } from './mod.ts'
import { type Arrival, keyword, type Outcome } from './text.ts'

/** The eid of a text that arrived, derived from the provider's id for it, so
 * a webhook posted twice keeps one. */
export let arrivalEid = (id: string): string => derivedEid(`text|${id}`)

/**
 * The bundles that keep a text that arrived from the person at `person`
 * (null when no one here has its number): the text itself, and the removal
 * of their consent when it says STOP.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { consentEid, kept } from '@yaks/phone'
 * let stop = { id: 'm1', from: '+12695550142', to: '+12695550100',
 *   text: 'STOP', at: '2026-11-04T00:00:00Z', rcs: false, media: [] }
 * equal(kept(stop, 'ana')[1], { entity: { eid: consentEid('ana') }, sms_consent: null })
 * ```
 */
export let kept = (arrival: Arrival, person: string | null): Bundle[] => [
  {
    entity: { eid: arrivalEid(arrival.id) },
    doc: { body: arrival.text },
    text: {
      from: arrival.from,
      to: arrival.to,
      at: arrival.at,
      message_id: arrival.id,
      rcs: arrival.rcs,
    },
  },
  ...(person && keyword(arrival.text) == 'stop'
    ? [{ entity: { eid: consentEid(person) }, sms_consent: null }]
    : []),
]

/** What a later failure of the text `sent` (the entity with that
 * `text.message_id`) writes onto it: a bounce, or nothing when it arrived. */
export let settled = (outcome: Outcome, sent: string): Bundle[] =>
  outcome.failed
    ? [{
      entity: { eid: sent },
      bounced: { at: new Date().toISOString(), reason: outcome.failed.reason },
    }]
    : []
