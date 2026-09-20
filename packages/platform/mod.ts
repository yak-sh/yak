/**
 * What a hosting platform keeps about the apps it serves: the `space` a
 * customer owns, the `app` inside it, each `deploy` of that app and what was
 * `published`, the `hostname` pointed at it, who `installed` it, the `plan`
 * being paid for and the `meter` reading that bills it, a `signin` in flight and
 * a `report` about what broke.
 *
 * Components only — the Worker that serves them is `workers/yak`.
 */

export { platformDoc } from './vocab.ts'
