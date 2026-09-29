// Tests install the same ability designs a new app store receives from seed.
import { useAbilities } from './abilities.ts'
import rows from './seed/abilities/abilities.json' with { type: 'json' }

export { rows }
export let seedAbilities = () => useAbilities(rows)
