// This example server strips TypeScript per file, as the application does, so
// the page uses plain ESM without a bundle step. Only this worktree's selected
// packages and two vendored Preact modules are served, on a loopback listener.

import { transform } from 'sucrase'

let root = new URL('../../../', import.meta.url)
let packages = /^\/packages\/(preact|render|match|vocab|query|sql|id)\//
let vendor = /^\/src\/vendor\/(preact|hooks)\.module\.js$/
let types: Record<string, string> = {
  ts: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
}

/** Serve one example request without opening a listener. */
export let serve = async (request: Request): Promise<Response> => {
  if (request.method != 'GET' && request.method != 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }
  let path: string
  try {
    path = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad path', { status: 400 })
  }
  if (path == '/') path = '/packages/preact/example/index.html'
  let file = new URL(`.${path}`, root)
  let ext = file.pathname.split('.').at(-1)!
  let route = file.pathname.slice(root.pathname.length - 1)
  if (
    !file.href.startsWith(root.href) ||
    !(packages.test(route) || vendor.test(route)) || !types[ext]
  ) {
    return new Response('Not found', { status: 404 })
  }
  try {
    // A symlink must not widen the static root beyond the worktree.
    let target = await Deno.realPath(file)
    let base = await Deno.realPath(root)
    if (!target.startsWith(`${base}/`)) {
      return new Response('Not found', { status: 404 })
    }
    let body = await Deno.readTextFile(file)
    if (ext == 'ts') body = transform(body, { transforms: ['typescript'] }).code
    return new Response(request.method == 'HEAD' ? null : body, {
      headers: { 'content-type': types[ext] },
    })
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.IsADirectory
    ) {
      return new Response('Not found', { status: 404 })
    }
    throw error
  }
}

if (import.meta.main) Deno.serve({ hostname: '127.0.0.1', port: 8000 }, serve)
