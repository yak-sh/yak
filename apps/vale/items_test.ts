// No thing's look draws two faces the depth buffer cannot tell apart (mesh.ts
// `fights`): arms and armour of every tier, what is gathered, and loot, as
// each lies on the ground and flies to a hero (items.ts `meshed`).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { seedBeasts } from './beasts_fixture.ts'
import { recipes } from './craft.ts'
import { rack } from './gear.ts'
import { ITEMS, meshed, useItems } from './items.ts'
import { rows, seedItems } from './items_fixture.ts'
