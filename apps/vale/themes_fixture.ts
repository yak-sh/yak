// Tests install the same region themes a new app store receives from its seed.
import { useThemes } from './levels.ts'
import seeded from './seed/themes.json' with { type: 'json' }

export let rows = seeded
export let seedThemes = () => useThemes(rows)
