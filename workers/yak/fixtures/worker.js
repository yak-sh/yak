// A fixture APP's own server code — an app someone deployed, not ours: the
// smallest worker.js that is more than one file. It imports the wasm module
// beside it, which the runtime hands over as a WebAssembly.Module
// (https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/),
// and answers `/api/add?a=2&b=3` with what the module computed.
//
// Two tests read this exact file: the one that asserts the multipart body the
// upload sends, and the one that runs these modules under workerd. Deno never
// typechecks it — it is Cloudflare's flavour of a module graph, not ours
// (deno.json excludes this directory).
import wasm from './add.wasm'

// Instantiated at the top level, so a request pays nothing for it. The module
// arrives compiled, so this is a link and not a compile.
let { exports } = new WebAssembly.Instance(wasm, {})

export default {
  fetch(req) {
    let url = new URL(req.url)
    // Anything else is the platform's to serve — an app's worker answers 404
    // to pass (dispatch.ts `ran`).
    if (!url.pathname.endsWith('/api/add')) {
      return new Response('not found', { status: 404 })
    }
    let a = Number(url.searchParams.get('a'))
    let b = Number(url.searchParams.get('b'))
    return new Response(String(exports.add(a, b)))
  },
}
