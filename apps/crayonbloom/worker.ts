import { collection } from './collection.ts'
import { gallery } from './gallery.ts'
import { story } from './story.ts'
import { printable, printableRequest, sheet } from './printable.ts'
import { atelier } from './atelier.ts'
import { type Binding, guard, identifier, Refusal, store, who } from './db.ts'
import { generation, put, puzzle, settings } from './generation.ts'
import { printer, printing } from './printing.ts'
import { publicPage } from './public.ts'
import { legacyPage } from './legacy.ts'
import type { Book } from './model.ts'
import { stylesheet } from './look/look.ts'
import { placed } from './pages/chrome.ts'
import { galleryPage } from './pages/gallery.ts'
import { home } from './pages/home.ts'

export type Env = { APP: Binding; STORE: Binding; FILES: Binding }
let path = (request: Request) => new URL(request.url).pathname
let reply = (value: unknown) =>
  Response.json(value, { headers: { 'cache-control': 'private, no-store' } })
let file = (env: Env, name: string) => env.FILES.fetch('/' + name)
let schedule = async (
  db: ReturnType<typeof store>,
  id: string,
  pending: boolean,
) => {
  if (!pending) {
    await db.apply([{ entity: { eid: id }, call: null, wake: null }])
    return
  }
  let [tool] = await db.query('.tool.name=coloring_step')
  if (!tool) {
    throw new Error('The saved artwork continuation command is missing.')
  }
  await db.apply([{
    entity: { eid: id },
    call: { to: tool.entity.eid, args: { book: id } },
    wake: { at: new Date(Date.now() + 1000).toISOString(), every: '30s' },
  }])
}
// What the pages load besides themselves: the look's fonts, the art the home
// page shows, the marks, and the studio's shell and script.
let STATIC =
  /^\/(look\/fonts\/[\w-]+\.ttf|art\/[\w/-]+\.(png|webp)|(icon|favicon)\.svg|studio\.ts)$/
// The look is the same for every request an isolate serves.
let look: Promise<string> | undefined
let styled = async (env: Env): Promise<Response> => {
  look ??= stylesheet(async (path) => {
    let response = await file(env, path)
    if (!response.ok) {
      throw new Error(`The stylesheet ${path} answered ${response.status}`)
    }
    return await response.text()
  })
  // A failed read is not kept: the next request reads again.
  look.catch(() => look = undefined)
  return new Response(await look, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
export let fetchApp = async (request: Request, env: Env): Promise<Response> => {
  let address = request.url, url = new URL(address)
  let mount = request.headers.get('x-yak-mount') ??
    `/${request.headers.get('x-yak-app') ?? ''}/`
  if (mount !== '/' && url.pathname === mount.replace(/\/$/, '')) {
    url.pathname = '/'
  } else if (url.pathname.startsWith(mount)) {
    url.pathname = '/' + url.pathname.slice(mount.length)
  }
  request = new Request(url, request)
  request.headers.set('x-yak-address', address)
  let db = store(env.APP), caller = who(request)
  let old = await legacyPage(
    request,
    db,
    {
      owner: caller.person ?? undefined,
      via: caller.via ?? undefined,
    },
    undefined,
    {
      asset: (blob) => env.APP.fetch('/pay/artifacts/' + blob),
      printable: async (art, title) =>
        sheet(env.APP, (await settings(db)).font, art, title),
    },
  )
  if (old) return old
  let published = await publicPage(request, env)
  if (published) return published
  let place = placed(address, url.pathname)
  if (['GET', 'HEAD'].includes(request.method)) {
    if (place.path == '/') return home(place)
    if (place.path == '/look.css') return await styled(env)
    if (place.path == '/studio') return file(env, 'studio.html')
    if (place.path == '/gallery') {
      return galleryPage(place, await gallery(db, env.APP).list())
    }
    if (STATIC.test(place.path)) return file(env, place.path.slice(1))
  }
  let action = path(request).split('/studio/')[1] ??
    (path(request).endsWith('/free_pages/resume') ? 'resume_free' : null)
  if (!action) return new Response('Not found', { status: 404 })
  try {
    if (action === 'gallery') return reply(await gallery(db, env.APP).list())
    if (action === 'gallery_file') {
      return await gallery(db, env.APP).file(
        identifier(url.searchParams.get('id')),
      )
    }
    if (action === 'drafts') {
      return await env.STORE.fetch('/drafts', {
        method: request.method,
        ...request.method === 'POST'
          ? {
            headers: { 'content-type': 'application/json' },
            body: await request.text(),
          }
          : {},
      })
    }
    let runtime = await settings(db)
    let engine = atelier(db, {
      generate: generation(db, env.APP, caller, runtime),
      puzzle: puzzle(env.APP, caller, runtime),
    })
    let press = printing(
      db,
      env.APP,
      printer(env.STORE, runtime.printer),
      runtime,
    )
    if (action === 'resume_free') {
      let saved = (await engine.shelf(caller)).find((b) =>
        b.coloring_book.mode === 'free'
      )
      let base = new URL(request.headers.get('x-yak-address') ?? request.url)
      base.pathname = base.pathname.replace(/free_pages\/resume$/, 'studio')
      base.hash = saved ? 'book/' + saved.entity.eid : 'new'
      return Response.redirect(base.toString(), 303)
    }
    if (action === 'settings') {
      let styles = await db.query('.coloring_style&?coloring_style&?doc')
      return reply({
        preview: runtime.preview,
        printer: runtime.printer,
        styles,
      })
    }
    if (action === 'collection') {
      return reply(await collection(db, engine).list(caller))
    }
    if (action === 'shelf') return reply(await engine.shelf(caller))
    if (action === 'book') {
      let book = await engine.owned(url.searchParams.get('id'), caller)
      return reply({ book, pages: await engine.pages(book) })
    }
    if (action === 'printable') {
      let book = await engine.owned(url.searchParams.get('id'), caller),
        page = (await engine.pages(book)).find((p) =>
          p.entity.eid === identifier(url.searchParams.get('page'))
        )
      if (!page) throw new Refusal('That page is not available.', 403)
      return await printableRequest(db, env.APP, book, page, place)
    }
    if (action === 'file') {
      let book = await engine.owned(url.searchParams.get('id'), caller)
      return await press.file(
        book,
        await engine.pages(book),
        identifier(url.searchParams.get('blob')),
      )
    }
    if (request.method !== 'POST') {
      throw new Refusal('Use the controls on this page.', 405)
    }
    let value: Record<string, unknown>
    try {
      value = await request.json()
    } catch {
      throw new Refusal('Send the form again.')
    }
    if (action === 'save') return reply(await engine.save(value, caller))
    if (action === 'printable_step') {
      if (!request.headers.get('x-yak-command-call')) {
        throw new Refusal('A saved continuation is required.', 403)
      }
      let [job] = await db.query(
        `.entity.eid=${identifier(value.job)}&?printable_job`,
      )
      let saved = job?.printable_job as {
        book: string
        page: string
        input: string
      } | undefined
      if (!saved) {
        throw new Refusal('This printable job is not available.', 403)
      }
      let [parent] = await db.query(
        `.entity.eid=${saved.book}&?coloring_book`,
      ) as Book[]
      if (!parent?.coloring_book) {
        throw new Refusal('This saved book is not available.', 403)
      }
      let owner = {
        person: parent.coloring_book.owner,
        via: parent.coloring_book.via,
      }
      let page = (await engine.pages(parent)).find((p) =>
        p.entity.eid === saved.page
      )
      if (!page?.artwork || page.artwork.hash !== saved.input) {
        await db.apply([{ entity: job.entity, call: null, wake: null }])
        return reply({ superseded: true })
      }
      let output = await printable(env.APP, runtime, parent, page)
      let bytes = new Uint8Array(await output.arrayBuffer())
      let stored = await put(env.APP, owner, bytes, 'application/pdf')
      await db.apply([{
        entity: page.entity,
        page_printable: { blob: stored.blob, input: saved.input },
        page_printable_job: null,
        $was: guard(page, ['artwork']),
      }, { entity: job.entity, call: null, wake: null }])
      return reply({ ok: true })
    }
    if (action === 'step') {
      if (!request.headers.get('x-yak-command-call')) {
        throw new Refusal('A saved continuation is required.', 403)
      }
      let [row] = await db.query(
        `.entity.eid=${identifier(value.book)}&?coloring_book`,
      ) as Book[]
      if (!row?.coloring_book) {
        throw new Refusal('This saved book is not available.', 403)
      }
      caller = { person: row.coloring_book.owner, via: row.coloring_book.via }
      engine = atelier(db, {
        generate: generation(db, env.APP, caller, runtime),
        puzzle: puzzle(env.APP, caller, runtime),
      })
      value.id = row.entity.eid
    }
    let book = await engine.owned(value.id, caller),
      pages = await engine.pages(book),
      result: unknown
    if (action === 'story') result = await story(db, runtime)(book)
    else if (action === 'outline') {
      result = await engine.outline(value.id, caller)
    } else if (action === 'edit') {
      result = await engine.edit(value.id, value.page, value, caller)
    } else if (action === 'move') {
      result = await engine.move(
        value.id,
        value.page,
        Number(value.delta),
        caller,
      )
    } else if (action === 'puzzle') {
      result = await engine.addPuzzle(value.id, String(value.activity), caller)
    } else if (action === 'retry_character') {
      if (book.page_drawing) {
        throw new Refusal('The character sheet is still drawing.')
      }
      await db.apply([{ entity: book.entity, page_failed: null }])
      result = { ok: true }
    } else if (action === 'retry') {
      result = await engine.retry(value.id, value.page, caller)
    } else if (action === 'draw') {
      await schedule(db, book.entity.eid, true)
      result = { book, pages, queued: true }
    } else if (action === 'step') {
      let progress = await engine.advance(value.id, caller)
      let unsettled = progress.pages.some((p) =>
        p.page_drawing || !p.artwork && !p.page_failed
      ) || !!progress.book.page_drawing
      await schedule(db, book.entity.eid, !progress.complete && unsettled)
      result = progress
    } else if (action === 'prepare') result = await press.prepare(book, pages)
    else if (action === 'preparation') {
      result = await press.preparation(book, pages)
    } else if (action === 'quote') {
      result = await press.quote(book, pages, value)
    } else if (action === 'purchase') {
      result = await press.purchase(book, pages)
    } else if (action === 'progress') result = await press.progress(book)
    else if (action === 'cancel') result = await press.cancel(book)
    else if (action === 'consent') {
      result = await engine.consent(value.id, value.agree === true, caller)
    } else if (action === 'assemble') {
      result = await collection(db, engine).assemble(book, value.pages, caller)
    } else return new Response('Not found', { status: 404 })
    return reply(result ?? { ok: true })
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { 'cache-control': 'private, no-store' },
    })
  }
}

export default { fetch: fetchApp }
