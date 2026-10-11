// Retained until the platform roster is named directly (D-121573 item 9).
// App stores compose @yaks/builders; published.ts translates the connector's
// old builder arguments and answers.
import type { Plugin } from './plugin.ts'

export let buildersPlugin: Plugin = { name: 'builders' }
