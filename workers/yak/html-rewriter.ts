// The HTMLRewriter global the Workers runtime gives every Worker, in-process:
// the runtime's own lol-html, compiled to WebAssembly (html-rewriter-wasm, as
// Miniflare runs it), behind the Response-in, Response-out shape the runtime
// gives it. The bytes a handler does not touch pass through as they came, so
// a page's doctype, case and whitespace survive the way they do in
// production.
//
// Importing this installs it. The test runner preloads it into each runtime
// (bin/test-runtime.ts), so it stands before any file loads, as a runtime
// global does: the runner puts back the globals a file found, and one first
// installed by a file's test would be taken away after that file, leaving
// every later file without it. lol-html loads at the first rewrite, so a
// runtime that rewrites nothing never loads it.
import type { HTMLRewriter as LolHtml } from 'html-rewriter-wasm'

type Handlers = Parameters<LolHtml['on']>[1]
type DocumentHandlers = Parameters<LolHtml['onDocument']>[0]

class Rewriter {
  #on: [string, Handlers][] = []
  #documents: DocumentHandlers[] = []
  on(selector: string, handlers: Handlers) {
    this.#on.push([selector, handlers])
    return this
  }
  onDocument(handlers: DocumentHandlers) {
    this.#documents.push(handlers)
    return this
  }
  transform(res: Response) {
    let on = this.#on, documents = this.#documents
    let body = new ReadableStream<Uint8Array>({
      async start(c) {
        let { HTMLRewriter } = await import('html-rewriter-wasm')
        let html = new HTMLRewriter((chunk) => {
          if (chunk.length) c.enqueue(chunk.slice())
        })
        for (let [selector, handlers] of on) html.on(selector, handlers)
        for (let handlers of documents) html.onDocument(handlers)
        try {
          for await (let bytes of res.body ?? []) await html.write(bytes)
          await html.end()
        } finally {
          html.free()
        }
        c.close()
      },
    })
    return new Response(body, res)
  }
}

;(globalThis as { HTMLRewriter?: unknown }).HTMLRewriter ??= Rewriter
