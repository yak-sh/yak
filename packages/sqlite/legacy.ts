// TODO(T-135463): replace this driver with node:sqlite. Its JSR npm tarball
// has a checksum mismatch, so the existing Deno driver stays at this one
// boundary until that migration lands.
export { Database, Statement } from 'jsr:@db/sqlite@0.13.0'
