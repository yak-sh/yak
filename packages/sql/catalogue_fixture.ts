// The example owns this connection; opening a database is not erect's work.
import { open } from '@yaks/sqlite/db'

export let catalogueExample = open(':memory:')
