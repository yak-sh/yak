/// <reference types="npm:@cloudflare/workers-types@^4" />
// The Cloudflare gate (not published — see deno.json). `objectBlobs` takes a
// bucket typed structurally, so the shipped source imports nothing and
// `deno check` reads it with no Cloudflare package installed. This file is
// where that hand-written type is checked against the runtime's own: it is
// compiled with `@cloudflare/workers-types` in scope, so the bucket here is the
// R2 binding wrangler declares.
//
// Nothing runs. The line below is an assignment the type-checker either accepts
// or rejects, which is the whole assertion.
//
// It is checked on its own (`deno task check:workers`) and excluded from the
// repo-wide check, because those runtime types are global: with them in scope
// `Response.json()` returns `unknown`, and every other file in the repo would
// be checked against a Worker it does not run in.

import { objectBlobs } from './object.ts'
import type { Blobs } from './store.ts'

/** An R2 bucket is a byte store, with no adapter in between. */
export let r2Blobs = (bucket: R2Bucket): Blobs => objectBlobs(bucket)
