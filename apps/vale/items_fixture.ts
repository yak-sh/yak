// Tests install the same item designs a new app store receives from its seed.
import { useItems } from './items.ts'
import arms from './seed/items/arms.json' with { type: 'json' }
import items from './seed/items/items.json' with { type: 'json' }
import materials from './seed/items/materials.json' with { type: 'json' }

export let rows = [...items, ...arms, ...materials]

export let seedItems = () => useItems(rows)
