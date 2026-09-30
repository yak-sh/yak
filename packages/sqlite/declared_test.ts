// Declared rules, end to end over this adapter: the script every storage
// adapter runs (./declared.ts).

import { rules } from './declared.ts'
import { store } from './testing.ts'

rules(store)
