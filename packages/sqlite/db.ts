// The embedded driver itself — @db/sqlite, opened against a library that
// works. This is the one door onto it: `import { Database } from
// '@yaks/sqlite/db'`, never from '@db/sqlite' directly, so ./sqlitepath.ts has
// already named the system library by the time the FFI initializes. Importing
// the driver straight is a segfault on Linux with nothing on stderr
// (src/store/sqlitepath_test.ts holds that line for the whole repo).
//
// ./mod.ts stays free of it on purpose: the adapter there speaks to any
// `Driver`, and only a host that wants an in-process database needs this.

import './sqlitepath.ts'

export * from '@db/sqlite'
export { sqlitePath } from './sqlitepath.ts'
