// Tests install the designs a new app store receives before a page begins.
import { seedBeasts } from './beasts_fixture.ts'
import { seedItems } from './items_fixture.ts'
import { seedAbilities } from './abilities_fixture.ts'
import { seedThemes } from './themes_fixture.ts'
import { seedBuildings } from './buildings_fixture.ts'

export let seedDesigns = () => {
  seedBeasts()
  seedItems()
  seedAbilities()
  seedThemes()
  seedBuildings()
}
