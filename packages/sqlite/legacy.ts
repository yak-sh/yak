// TODO(T-135463): replace this driver with node:sqlite. Until then it is
// @db/sqlite's, copied without its prebuilt download (./ffi/mod.ts).
export { Database, Statement } from './ffi/mod.ts'
