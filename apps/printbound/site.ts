// The site's door: every page a visitor reads and the files those pages
// name. The home page, the guides and the policies are drawn here from the
// kit's parts (site/); the studio's page is a file the frame is set into.
// The app is private, so a visitor has only what this door hands over.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { appBase } from './request.ts'
import { styleLinks, stylesheets } from './look/links.ts'
import { Bottom, Top } from './site/frame.ts'
import { Home } from './site/home.ts'
import { Guide, read } from './site/doc.ts'
import pictureBook from './pages/make-a-picture-book-in-chatgpt.md' with {
  type: 'text',
}
import chatgptBook from './pages/print-your-chatgpt-book.md' with {
  type: 'text',
}
import aiImages from './pages/can-you-print-ai-images.md' with { type: 'text' }
import terms from './pages/terms.md' with { type: 'text' }
import refund from './pages/refund.md' with { type: 'text' }
import privacy from './pages/privacy.md' with { type: 'text' }
import contact from './pages/contact.md' with { type: 'text' }

type Files = { fetch(path: string): Promise<Response> }

// The guide's Markdown is part of the same release as its renderer.
let guides = {
  'make-a-picture-book-in-chatgpt': pictureBook,
  'print-your-chatgpt-book': chatgptBook,
  'can-you-print-ai-images': aiImages,
  terms,
  refund,
  privacy,
  contact,
}

export let GUIDES = Object.keys(guides)

// A file handed over as it is kept, by the address it answers at.
let KEPT: Record<string, string> = {
  'favicon.svg': 'favicon.svg',
  'icon.png': 'icon.png',
  'og.png': 'og.png',
  'copy.js': 'copy.js',
  'studio.ts': 'studio.ts',
  'recovery.js': 'recovery.js',
  'spellbound.md': 'public/spellbound.md',
}
// One that names the app's own address, written in as it is handed over.
let ADDRESSED: Record<string, string> = {
  'llms.txt': 'text/plain',
  'sitemap.xml': 'application/xml',
  'robots.txt': 'text/plain',
}
// The fonts and pictures, and the platform's packages a compiled script reads.
let SHELVES = /^(fonts|img|__packages)\/[\w@.-]+(\/[\w@.-]+)*$/

let HTML = { 'content-type': 'text/html; charset=utf-8' }

let page = (html: string) =>
  new Response('<!doctype html>\n' + html, { headers: HTML })

let answers: Record<
  string,
  (files: Files, base: string) => Response | Promise<Response>
> = {
  '': (_files, base) => page(renderToString(h(Home, { base }))),
  // The studio's page is a file, so the platform compiles its script; the
  // stylesheet links, bar and foot are set where it marks them.
  studio: async (files, base) => {
    let file = await files.fetch('/studio.html')
    if (!file.ok) return file
    return new Response(
      (await file.text())
        .replace(
          '<!--stylesheets-->',
          renderToString(styleLinks((path) => new URL(path, base).href)),
        )
        .replace(
          '<!--mast-->',
          renderToString(h(Top, { base, studio: true })),
        )
        .replace('<!--foot-->', renderToString(h(Bottom, { base }))),
      { headers: HTML },
    )
  },
  ...Object.fromEntries(
    Object.entries(guides).map(([path, source]) => [
      path,
      (_files: Files, base: string) =>
        page(renderToString(h(Guide, { base, doc: read(source), path }))),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(ADDRESSED).map(([name, type]) => [
      name,
      async (files: Files, base: string) => {
        let file = await files.fetch('/public/' + name)
        if (!file.ok) return file
        return new Response(
          (await file.text()).replaceAll('__APP_BASE__', base),
          { headers: { 'content-type': type + '; charset=utf-8' } },
        )
      },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(KEPT).map(([name, path]) => [
      name,
      (files: Files) => files.fetch('/' + path),
    ]),
  ),
}

/** What the site answers a visitor, or null where the address is none of
 * its pages or files. The request is one `relative` made (request.ts). */
export let site = async (
  request: Request,
  env: { FILES: Files },
): Promise<Response | null> => {
  if (!['GET', 'HEAD'].includes(request.method)) return null
  // A doubled slash (`//terms`) names the same page.
  let path = new URL(request.url).pathname.replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '').replace(/\.html$/, '')
  let answer = Object.hasOwn(answers, path)
    ? await answers[path](env.FILES, appBase(request).href)
    : stylesheets.includes(path) || SHELVES.test(path) && !path.includes('..')
    ? await env.FILES.fetch('/' + path)
    : null
  return answer && request.method == 'HEAD'
    ? new Response(null, answer)
    : answer
}
