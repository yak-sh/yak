// Tests install the designs a new app store receives before a page begins.
import { seedBeasts } from './beasts_fixture.ts'
import { seedItems } from './items_fixture.ts'
import { seedAbilities } from './abilities_fixture.ts'

export let seedDesigns = () => {
  seedBeasts()
  seedItems()
  seedAbilities()
}
