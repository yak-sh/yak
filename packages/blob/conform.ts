/// <reference types="npm:@cloudflare/workers-types@^4" />
// The Cloudflare gate (not published — see deno.json). `objectBlobs` takes a
// bucket written STRUCTURALLY, so the shipped source imports nothing and
// `deno check` reads it with no Cloudflare package installed. This file is
// where that hand-written shape is held against the runtime's own: it is
// checked with `@cloudflare/workers-types` in scope, so the bucket here is the
// R2 binding wrangler declares.
//
// Nothing runs. The line below is an assignment the type-checker either allows
// or refuses, which is the whole assertion.
//
// It is checked on its own (`deno task check:workers`) and excluded from the
// repo-wide one, because those runtime types are global: in scope, a
// `Response.json()` answers `unknown` and every other file in the repo would be
// checked against a Worker it does not run in.

import { objectBlobs } from './object.ts'
import type { Blobs } from './store.ts'

/** An R2 bucket is a blob store, with no adapter in between. */
export let r2Blobs = (bucket: R2Bucket): Blobs => objectBlobs(bucket)
