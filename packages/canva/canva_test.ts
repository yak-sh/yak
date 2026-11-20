// The Canva tools against a scripted Canva: what each asks, and what its
// answer says.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { CallError } from '@yaks/tools/errors'
import { tools } from './mod.ts'

type Json = Record<string, unknown>

// A Canva answering each request by its method and path, keeping what it was
// sent.
let canva = (routes: Record<string, (body: Json) => [number, Json]>) => {
  let sent: [string, Json | undefined][] = []
  let send = async (req: Request) => {
    let url = new URL(req.url)
    let key = `${req.method} ${url.pathname.slice('/rest/v1'.length)}`
    let body = req.method == 'POST' ? await req.json() : undefined
    sent.push([`${key}${url.search}`, body])
    let route = routes[key]
    if (!route) return Response.json({ message: 'no route' }, { status: 404 })
    let [status, json] = route(body ?? {})
    return Response.json(json, { status })
  }
  let run = async (name: string, args: Json) =>
    JSON.parse(String(
      await tools(send, { wait: () => Promise.resolve(), most: 3000 })
        .find((t) => t.name == name)!.run(args),
    ))
  return { run, sent }
}

let DESIGN = {
  id: 'D1',
  title: 'Pitch',
  urls: {
    edit_url: 'https://canva.example/e',
    view_url: 'https://canva.example/v',
  },
  page_count: 3,
  updated_at: 1_763_600_000,
}
let SAID = {
  id: 'D1',
  title: 'Pitch',
  edit: 'https://canva.example/e',
  view: 'https://canva.example/v',
  pages: 3,
  updated: new Date(1_763_600_000_000).toISOString(),
}

test('finding designs asks with their words and order, and answers the next page', async () => {
  let c = canva({
    'GET /designs': () => [200, { items: [DESIGN], continuation: 'next' }],
  })
  assertEquals(
    await c.run('canva_designs', { words: 'pitch', order: 'recent' }),
    {
      designs: [SAID],
      more: 'next',
    },
  )
  assertEquals(
    c.sent[0][0],
    'GET /designs?query=pitch&sort_by=modified_descending&limit=25',
  )
})

test('a design reads with its autofill fields, and none where Canva has none', async () => {
  let fields = canva({
    'GET /designs/D1': () => [200, { design: DESIGN }],
    'GET /designs/D1/dataset':
      () => [200, { dataset: { name: { type: 'text' } } }],
  })
  assertEquals(await fields.run('canva_design', { design: 'D1' }), {
    design: SAID,
    fields: { name: 'text' },
  })
  let none = canva({ 'GET /designs/D1': () => [200, { design: DESIGN }] })
  assertEquals((await none.run('canva_design', { design: 'D1' })).fields, {})
})

test('a design is made of a preset or a size, and needs one', async () => {
  let c = canva({ 'POST /designs': () => [200, { design: DESIGN }] })
  await c.run('canva_create', { kind: 'presentation', title: 'Pitch' })
  await c.run('canva_create', { width: 1080, height: 1080 })
  assertEquals(c.sent.map(([, b]) => b), [
    { design_type: { type: 'preset', name: 'presentation' }, title: 'Pitch' },
    { design_type: { type: 'custom', width: 1080, height: 1080 } },
  ])
  for (let args of [{}, { kind: 'poster' }, { width: 100 }]) {
    await assertRejects(() => c.run('canva_create', args), CallError)
  }
})

test('a fill sends words and images by field, new or in place', async () => {
  let c = canva({
    'POST /autofills': () => [200, { job: { id: 'J', status: 'in_progress' } }],
    'GET /autofills/J': () => [200, {
      job: { id: 'J', status: 'success', result: { design: DESIGN } },
    }],
  })
  let fields = { name: 'Ada', photo: { image: 'A1' } }
  assertEquals(
    await c.run('canva_fill', { template: 'T', title: 'Card', fields }),
    { design: SAID },
  )
  await c.run('canva_fill', { design: 'D1', in_place: true, fields })
  let data = {
    name: { type: 'text', text: 'Ada' },
    photo: { type: 'image', asset_id: 'A1' },
  }
  assertEquals(c.sent.filter(([k]) => k.startsWith('POST')).map(([, b]) => b), [
    {
      type: 'create_from_brand_template',
      brand_template_id: 'T',
      title: 'Card',
      data,
    },
    { type: 'update_design', design_id: 'D1', data },
  ])
  await assertRejects(() => c.run('canva_fill', { fields }), CallError)
})

test('a job still running answers itself, and asking with it finishes it', async () => {
  let done = false
  let c = canva({
    'POST /exports': () => [200, { job: { id: 'X', status: 'in_progress' } }],
    'GET /exports/X': () => [200, {
      job: done
        ? { id: 'X', status: 'success', urls: ['https://dl.example/1.pdf'] }
        : { id: 'X', status: 'in_progress' },
    }],
  })
  let later = await c.run('canva_export', { design: 'D1', format: 'pdf' })
  assertEquals([later.status, later.job], ['in_progress', 'X'])
  done = true
  assertEquals(
    await c.run('canva_export', { design: 'D1', format: 'pdf', job: 'X' }),
    { files: ['https://dl.example/1.pdf'] },
  )
  assertEquals(c.sent.filter(([k]) => k == 'POST /exports').length, 1)
})

test('a failed job, and Canva refusing, are said; Canva failing is thrown as ours', async () => {
  let failed = canva({
    'POST /resizes': () => [200, {
      job: {
        id: 'R',
        status: 'failed',
        error: { code: 'x', message: 'Too big' },
      },
    }],
  })
  await assertRejects(
    () => failed.run('canva_resize', { design: 'D1', width: 9000, height: 40 }),
    CallError,
    'Too big',
  )
  let refused = canva({
    'GET /designs': () => [403, { message: 'Missing scope' }],
  })
  let e = await assertRejects(() => refused.run('canva_designs', {}), CallError)
  assertEquals([e.code, e.message], [
    'connection',
    'Canva refused: Missing scope',
  ])
  let down = canva({ 'GET /designs': () => [502, {}] })
  let thrown = await assertRejects(() => down.run('canva_designs', {}))
  assertEquals(thrown instanceof CallError, false)
})
