// Opening a database is not erect's work, so the example's connection opens
// here, once a runtime. Every load of the example borrows it (the budget's
// re-measure loads each file twice in one runtime), so the example leaves it
// as it found it: empty, and open.
import { open } from '@yaks/sqlite/db'

export let catalogueExample = open(':memory:')
