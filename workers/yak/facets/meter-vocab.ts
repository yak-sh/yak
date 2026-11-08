// The directory's meter declarations.
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  $defs: {
    model_reservation: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        space: { type: 'string', ref: 'space', death: 'cascade' },
        month: { type: 'string' },
        dollars: { type: 'number' },
        what: { type: 'string', enum: ['models', 'realtime', 'texts'] },
        // What the dollars buy, for the admin's spend by source (meter.ts
        // `SOURCES`): a model provider, voice, texts or the browser.
        source: { type: 'string' },
        visitor: { type: 'boolean' },
      },
    },
    // The model calls one visitor has asked a space's apps for on `day`
    // (model-spend.ts `reserved`), against meter.ts `visitorCalls`.
    visitor_calls: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        space: { type: 'string', ref: 'space', death: 'cascade' },
        day: { type: 'string' },
        calls: { type: 'number' },
      },
    },
    // The newcomers' spaces opened on `day` (newcomer.ts `counted`): one row
    // for everybody and one per address they came from, against newcomer.ts
    // `DAILY` and `PER_SOURCE`.
    newcomer_builds: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        day: { type: 'string' },
        builds: { type: 'number' },
      },
    },
    account_usage: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        month: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
        requests: { type: 'number' },
        rows_read: { type: 'number' },
        duration: { type: 'number' },
        workers: { type: 'number' },
        cpu: { type: 'number' },
      },
    },
    account_alert: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        month: { type: 'string' },
        requests: { type: 'string' },
        rows_read: { type: 'string' },
        duration: { type: 'string' },
        workers: { type: 'string' },
        cpu: { type: 'string' },
        rate: { type: 'string' },
      },
    },
  },
}]
