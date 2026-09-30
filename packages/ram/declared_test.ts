// Declared rules over the map: the same script @yaks/sqlite runs, so a rule
// answers alike wherever its graph is kept.

import { rules } from '../sqlite/declared.ts'
import { shop } from '../sqlite/testing.ts'
import { ram } from './mod.ts'

rules(() => ram(shop, { number: true }))
