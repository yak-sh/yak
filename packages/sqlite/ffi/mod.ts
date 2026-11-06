// @db/sqlite 0.13.0 (https://github.com/denodrivers/sqlite3, Apache-2.0,
// ./LICENSE), copied: its source, less the prebuilt download. Upstream imports @denosaurs/plug to download a library whenever
// no `DENO_SQLITE_PATH` names one, and that import loads about 170 modules
// (two @std/path versions, @std/fs, @std/encoding) into every process that
// opens a database, before `yak serve` can listen. @yaks/sqlite always names
// its library (../sqlitepath.ts), so ./ffi.ts opens that one and nothing else.
//
// TODO(T-135463): delete this directory once @yaks/sqlite runs on
// node:sqlite, which in Deno 2.9.1 still refuses `loadExtension`
// ("not authorized"), and sqlite-vector is an extension.
export {
  type AggregateFunctionOptions,
  Database,
  type DatabaseOpenOptions,
  type FunctionOptions,
  isComplete,
  SQLITE_SOURCEID,
  SQLITE_VERSION,
  type Transaction,
} from './database.ts'
export { type BlobOpenOptions, SQLBlob } from './blob.ts'
export {
  type BindParameters,
  type BindValue,
  type RestBindParameters,
  Statement,
} from './statement.ts'
export { SqliteError } from './util.ts'
