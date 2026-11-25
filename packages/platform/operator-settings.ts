/**
 * What a space's Operator settings page (./operator-settings-view.ts) is
 * drawn from, as the tab's page graph holds it (D-475 step 4), and what it
 * writes there:
 *
 * - `operatorSettings{space, …}`: the Operator's name and how it speaks, off
 *   its persona in the space's store, which answers `operatorSettings(space)`
 *   live (yaks.app's operator-api.ts). A write of it names the space and the
 *   settings it changes, and the page graph's door takes it to that store.
 * - `alerting{channel, by, browsers}` and `texting{number, at}`: how the
 *   person is told things away from the page, and the number they agreed to
 *   texts at, which the directory answers as reads of them (./person-lines.ts).
 * - `allowPush{subscription}`, `agreeTexts{space, number, agreed, code}` and
 *   `stopTexts{}`: acts the door does as the person.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'

/** How a person may choose to be told something away from the page. */
export type Channel = 'push' | 'text' | 'email' | 'updates'

/** The Operator's settings: its name, and how it speaks on a call, by the
 * ids @yaks/speech offers; null is the platform's own. */
export type Settings = {
  name?: string | null
  voice?: string | null
  voice_speed?: string | null
  voice_model?: string | null
  voice_backend?: string | null
}

/** How the person is told something away from the page: the way they chose,
 * if any, the way an alert goes now, and how many browsers they allowed
 * notifications on. */
export type Alerting = {
  channel?: Channel | null
  by: Channel
  browsers: number
}

/** The number the person agreed to texts at, and when. */
export type Texting = { number: string; at: string }

let SETTINGS = '.operatorSettings.space='

/** The line of the Operator's settings in the space `eid`. */
export let operatorSettings = (eid: string): string => SETTINGS + eid

/** The space an `operatorSettings` line asks about, or undefined for another
 * line. */
export let settingsSpace = (line: string): string | undefined =>
  line.startsWith(SETTINGS) ? line.slice(SETTINGS.length) : undefined

/** The person's alerts. */
export let ALERTING = '.alerting'

/** The number the person agreed to texts at; none, and they did not. */
export let TEXTING = '.texting'

/** Whether the directory answers `line` as a read of the person. */
export let reachedLine = (line: string): boolean =>
  line == ALERTING || line == TEXTING

let strings = { type: 'string' }
let nullable = { type: ['string', 'null'] }

export let operatorSettingsWords: VocabDoc = {
  $defs: {
    operatorSettings: {
      component: true,
      type: 'object',
      properties: {
        space: strings,
        name: nullable,
        voice: nullable,
        voice_speed: nullable,
        voice_model: nullable,
        voice_backend: nullable,
      },
      required: ['space'],
    },
    alerting: {
      component: true,
      type: 'object',
      properties: {
        channel: nullable,
        by: strings,
        browsers: { type: 'integer' },
      },
    },
    texting: {
      component: true,
      type: 'object',
      properties: { number: strings, at: strings },
      required: ['number', 'at'],
    },
    allowPush: {
      component: true,
      type: 'object',
      properties: { subscription: { type: 'object' } },
      required: ['subscription'],
    },
    agreeTexts: {
      component: true,
      type: 'object',
      properties: {
        space: strings,
        number: strings,
        agreed: { type: 'boolean' },
        code: strings,
      },
      required: ['space'],
    },
    stopTexts: { component: true, type: 'object', properties: {} },
  },
}

/** The eid of the Operator's settings in the space `space`. */
export let settingsEid = (space: string): string =>
  derivedEid(`operatorSettings|${space}`)

/** The eid of `person`'s alerts. */
export let alertingEid = (person: string): string =>
  derivedEid(`alerting|${person}`)

/** The Operator's settings in the space `space`, as a row. */
export let settingsRow = (space: string, settings: Settings): Bundle => ({
  entity: { eid: settingsEid(space) },
  operatorSettings: { ...settings, space },
})

/** `person`'s alerts, as a row. */
export let alertingRow = (person: string, alerting: Alerting): Bundle => ({
  entity: { eid: alertingEid(person) },
  alerting,
})

/** The number `person` agreed to texts at, as rows: none where they did
 * not. */
export let textingRows = (person: string, texting: Texting | null): Bundle[] =>
  texting
    ? [{
      entity: { eid: derivedEid(`texting|${person}`) },
      texting: { number: texting.number, at: texting.at },
    }]
    : []

/** The settings `rows` hold, if any. */
export let settingsOf = (rows: Bundle[]): Settings | undefined => {
  let row = rows.find((r) => r.operatorSettings)?.operatorSettings as
    | (Settings & { space: string })
    | undefined
  if (!row) return undefined
  let { space: _, ...settings } = row
  return settings
}

/** The alerts `rows` hold, if any. */
export let alertingOf = (rows: Bundle[]): Alerting | undefined =>
  rows.find((r) => r.alerting)?.alerting as Alerting | undefined

/** The texting `rows` hold, or null where they hold none. */
export let textingOf = (rows: Bundle[]): Texting | null =>
  (rows.find((r) => r.texting)?.texting as Texting | undefined) ?? null

/** The space and the settings a write of `bundles` changes, when it is one
 * Operator's settings, else undefined. */
export let settingsWrite = (
  bundles: Bundle[],
): { space: string; set: Settings } | undefined => {
  let [b, ...rest] = bundles
  let said = b?.operatorSettings as (Settings & { space?: string }) | undefined
  if (rest.length || !said?.space) return undefined
  let { space, ...set } = said
  return { space, set }
}

/** Whether `bundles` are acts the door does as the person on the settings
 * page: their alerts, a browser allowed, texts agreed to or stopped. */
export let reachedWrites = (bundles: Bundle[]): boolean =>
  bundles.length > 0 &&
  bundles.every((b) =>
    'alerting' in b || 'allowPush' in b || 'agreeTexts' in b ||
    'stopTexts' in b
  )
