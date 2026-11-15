/**
 * What a hosting platform keeps about the apps it serves: the `space` a
 * customer owns, the `app` inside it, each `deploy` of that app and what was
 * `published`, the `hostname` pointed at it, who `installed` it, the `plan`
 * being paid for and the `meter` usage it is billed on, a `signin` in progress,
 * a `report` of where somebody stood when something went wrong, and the
 * `support` a feedback thread and its messages came from.
 *
 * Declarations and pure release comparisons. An app store's own words and
 * serving plugins are at their own exports (README.md, "An app store's
 * plugins"); the Worker that serves them is `workers/yak`.
 */

export { platformDoc } from './vocab.ts'

export * from './release.ts'
