/** The module names the Preact renderer supplies to an app. @module */

import manifest from './package.json' with { type: 'json' }

/** Package aliases for a view selected to run on Preact. */
export let aliases: Record<string, string> = manifest.yaksRenderer.aliases
