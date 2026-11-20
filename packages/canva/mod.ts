// A person's Canva, in an Operator's hands, through Canva's REST API (the
// Connect API). The person signs in through @yaks/connections' `canva`
// integration; every request here leaves through `send`, which adds their
// credential on the way (@yaks/connections `call`), so no token is held here.
//
// The REST API reads, makes, copies, resizes, fills in and exports designs. It
// cannot change the text, images or layout inside an existing design: only the
// fields a design or brand template marks for autofill take new values, and a
// resize makes a copy. Everything else is done in Canva's editor, at the
// design's edit link. Each tool's description says so where it matters.

import type { Tool } from '@yaks/session'
import { CallError } from '@yaks/tools/errors'

/** Where Canva's REST API answers. */
export let API = 'https://api.canva.com/rest/v1'

/** Sends one request to Canva as the person who signed in. */
export type Send = (req: Request) => Promise<Response>

/** How long a job is waited on, and how. */
export type Patience = {
  /** milliseconds between asking after a job (default 1000) */
  every?: number
  /** milliseconds a job is waited on before the caller is told to ask again
   * (default 40000) */
  most?: number
  wait?: (ms: number) => Promise<void>
}

type Json = Record<string, unknown>

let str = (v: unknown) => typeof v == 'string' ? v.trim() : ''
let num = (v: unknown) => typeof v == 'number' && isFinite(v) ? v : undefined

// ---- the pure part: what is asked of Canva, and what its answers say ----

/** A design as the Operator reads it. */
export type Design = {
  id: string
  title?: string
  edit?: string
  view?: string
  pages?: number
  updated?: string
  thumbnail?: string
}

/** One of Canva's designs, as a `Design`. */
export let designOf = (d: Json): Design => {
  let urls = (d.urls ?? {}) as Json
  let at = num(d.updated_at)
  return clean({
    id: str(d.id),
    title: str(d.title) || undefined,
    edit: str(urls.edit_url) || undefined,
    view: str(urls.view_url) || undefined,
    pages: num(d.page_count),
    updated: at ? new Date(at * 1000).toISOString() : undefined,
    thumbnail: str((d.thumbnail as Json | undefined)?.url) || undefined,
  })
}

let clean = <T extends Json>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T

/** Canva's preset design types. */
export let PRESETS = ['doc', 'presentation', 'whiteboard', 'email']

/** The design type a call asks for: a preset by name, or a size in pixels. */
export let typeOf = (args: Json): Json | undefined => {
  let kind = str(args.kind)
  if (kind) {
    if (!PRESETS.includes(kind)) {
      throw new CallError(
        'arguments',
        `kind is one of ${
          PRESETS.join(', ')
        }; give width and height for any other size.`,
      )
    }
    return { type: 'preset', name: kind }
  }
  let width = num(args.width), height = num(args.height)
  if (width == undefined && height == undefined) return undefined
  if (!width || !height) {
    throw new CallError('arguments', 'Give both width and height, in pixels.')
  }
  return { type: 'custom', width, height }
}

/** What a fill gives each field: words, or an asset already in Canva. */
export let dataOf = (fields: unknown): Json => {
  if (!fields || typeof fields != 'object' || Array.isArray(fields)) {
    throw new CallError(
      'arguments',
      'fields names each field to fill, with its words or { "image": asset id }.',
    )
  }
  return Object.fromEntries(
    Object.entries(fields as Json).map(([k, v]) => {
      if (typeof v == 'string' || typeof v == 'number') {
        return [k, { type: 'text', text: String(v) }]
      }
      let image = str((v as Json | null)?.image)
      if (image) return [k, { type: 'image', asset_id: image }]
      throw new CallError(
        'arguments',
        `The field ${k} takes words, or { "image": asset id }.`,
      )
    }),
  )
}

/** What a design or brand template's autofill fields take, by name. */
export let fieldsOf = (dataset: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((dataset ?? {}) as Record<string, Json>).map((
      [k, v],
    ) => [k, str(v?.type)]),
  )

// ---- the effects: asking Canva ----

// One request to Canva, answered as JSON. Canva failing is ours to see;
// Canva refusing what was asked is the caller's to hear.
let asking = (send: Send) =>
async (
  path: string,
  body?: Json,
): Promise<Json> => {
  let res = await send(
    new Request(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
  )
  let got = await res.json().catch(() => ({})) as Json
  if (res.ok) return got
  let said = `Canva refused: ${str(got.message) || res.statusText}`
  if (res.status >= 500) throw new Error(said)
  throw new CallError(
    res.status == 401 || res.status == 403
      ? 'connection'
      : res.status == 429
      ? 'limit'
      : res.status == 404
      ? 'missing'
      : 'rejected',
    said,
  )
}

type Ask = ReturnType<typeof asking>

// A job Canva runs on its own time: started, or the one `job` names, asked
// after until it ends or patience runs out.
let awaited = async (
  ask: Ask,
  path: string,
  started: () => Promise<Json>,
  job: string,
  p: Patience,
): Promise<Json> => {
  let every = p.every ?? 1000, most = p.most ?? 40_000
  let wait = p.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  let got =
    (job ? await ask(`${path}/${encodeURIComponent(job)}`) : await started())
      .job as Json
  for (let spent = 0; got.status == 'in_progress'; spent += every) {
    if (spent >= most) {
      return {
        status: 'in_progress',
        job: got.id,
        next: 'Canva is still working on it; call again with this job.',
      }
    }
    await wait(every)
    got = (await ask(`${path}/${encodeURIComponent(str(got.id))}`)).job as Json
  }
  if (got.status == 'failed') {
    let error = (got.error ?? {}) as Json
    throw new CallError(
      'rejected',
      `Canva could not finish it: ${str(error.message) || str(error.code)}`,
    )
  }
  return got
}

let designParam = {
  type: 'string',
  description: "The design's id, from canva_designs.",
}
let jobParam = {
  type: 'string',
  description:
    'A job an earlier call said Canva was still working on: asks after it instead of starting another.',
}
let sizeParams = {
  kind: {
    type: 'string',
    enum: PRESETS,
    description: 'A preset design type.',
  },
  width: { type: 'number', description: 'Width in pixels, 40 to 8000.' },
  height: { type: 'number', description: 'Height in pixels, 40 to 8000.' },
}

// Whether a design answer is a whole design.
let designed = (o: Json) => o.design ? designOf(o.design as Json) : undefined

/** The tools a Canva connection offers: each sends through `send`. */
export let tools = (send: Send, patience: Patience = {}): Tool[] => {
  let ask = asking(send)
  let job = (path: string, args: Json, start: () => Promise<Json>) =>
    awaited(ask, path, start, str(args.job), patience)
  return [{
    name: 'canva_designs',
    title: 'Find their Canva designs',
    readOnly: true,
    step: { doing: 'Looking through Canva…', done: 'Looked through Canva' },
    description:
      "Find designs in the Canva account of the person you work for, and ones shared with them: by words, or the most recently changed. Each comes with its edit link, where they open it in Canva's editor.",
    parameters: {
      type: 'object',
      properties: {
        words: { type: 'string', description: 'Words to search for.' },
        whose: {
          type: 'string',
          enum: ['any', 'owned', 'shared'],
          description: 'Their own, shared with them, or both (default).',
        },
        order: {
          type: 'string',
          enum: ['relevance', 'recent', 'title'],
          description: 'How they are ordered (default relevance).',
        },
        more: {
          type: 'string',
          description: 'The `more` an earlier answer gave, for the next page.',
        },
      },
    },
    run: async (args) => {
      let q = new URLSearchParams(clean({
        query: str(args.words) || undefined,
        ownership: str(args.whose) || undefined,
        sort_by: ({
          recent: 'modified_descending',
          title: 'title_ascending',
          relevance: undefined,
        } as Record<string, string | undefined>)[str(args.order)],
        continuation: str(args.more) || undefined,
        limit: '25',
      }) as Record<string, string>)
      let got = await ask(`/designs?${q}`)
      return JSON.stringify(clean({
        designs: ((got.items ?? []) as Json[]).map(designOf),
        more: str(got.continuation) || undefined,
      }))
    },
  }, {
    name: 'canva_design',
    title: 'Read a Canva design',
    readOnly: true,
    step: { doing: 'Reading the design…', done: 'Read the design' },
    description:
      "Read one Canva design: its title, pages and links, and the fields it marks for autofill, which canva_fill can change. Canva's API cannot read or change anything else inside a design.",
    parameters: {
      type: 'object',
      properties: { design: designParam },
      required: ['design'],
    },
    run: async (args) => {
      let id = encodeURIComponent(str(args.design))
      let design = designed(await ask(`/designs/${id}`))
      let fields = await ask(`/designs/${id}/dataset`)
        .then((d) => fieldsOf(d.dataset))
        .catch((e) => {
          if (e instanceof CallError) return {}
          throw e
        })
      return JSON.stringify({ design, fields })
    },
  }, {
    name: 'canva_create',
    title: 'Make a Canva design',
    step: { doing: 'Making %{title}…', done: 'Made %{title}' },
    description:
      "Make a new, blank Canva design for the person you work for: a preset type, or a size in pixels, optionally with one of their images in it. Canva's API cannot add text or elements; they do that at its edit link. Canva deletes a blank design nobody edits within 7 days.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What it is called.' },
        ...sizeParams,
        image: {
          type: 'string',
          description: 'The id of an image asset already in their Canva.',
        },
      },
    },
    run: async (args) => {
      let type = typeOf(args)
      let image = str(args.image)
      if (!type && !image) {
        throw new CallError(
          'arguments',
          'Give a kind, a width and height, or an image.',
        )
      }
      return JSON.stringify({
        design: designed(
          await ask(
            '/designs',
            clean({
              design_type: type,
              asset_id: image || undefined,
              title: str(args.title) || undefined,
            }),
          ),
        ),
      })
    },
  }, {
    name: 'canva_copy',
    title: 'Copy a Canva design',
    step: { doing: 'Copying the design…', done: 'Copied the design' },
    description:
      'Make a copy of a Canva design, whole or only some of its pages.',
    parameters: {
      type: 'object',
      properties: {
        design: designParam,
        pages: {
          type: 'array',
          items: { type: 'number' },
          description: 'The pages to copy, numbered from 1; all by default.',
        },
      },
      required: ['design'],
    },
    run: async (args) => {
      let pages = Array.isArray(args.pages) ? args.pages.map(Number) : []
      return JSON.stringify({
        design: designed(
          await ask(
            '/designs',
            clean({
              type: 'design',
              design_id: str(args.design),
              page_numbers: pages.length ? pages : undefined,
            }),
          ),
        ),
      })
    },
  }, {
    name: 'canva_resize',
    title: 'Resize a Canva design',
    step: { doing: 'Resizing the design…', done: 'Resized the design' },
    description:
      "Make a resized copy of a Canva design, as a preset type or a size in pixels; the original stays as it was. Canva's API never resizes in place, and needs a plan with premium features (such as Canva Pro). Docs and emails cannot be resized.",
    parameters: {
      type: 'object',
      properties: { design: designParam, ...sizeParams, job: jobParam },
      required: ['design'],
    },
    run: async (args) => {
      let got = await job('/resizes', args, () => {
        let type = typeOf(args)
        if (!type) {
          throw new CallError(
            'arguments',
            'Give a kind, or a width and height.',
          )
        }
        return ask('/resizes', {
          design_id: str(args.design),
          design_type: type,
        })
      })
      let result = got.result as Json | undefined
      return JSON.stringify(
        result ? { design: designed(result) } : got,
      )
    },
  }, {
    name: 'canva_templates',
    title: 'Find their brand templates',
    readOnly: true,
    step: { doing: 'Looking for templates…', done: 'Looked for templates' },
    description:
      'Find the brand templates in the Canva account of the person you work for, each with the fields canva_fill fills in. Brand templates need a Canva plan that has them.',
    parameters: {
      type: 'object',
      properties: {
        words: { type: 'string', description: 'Words to search for.' },
        more: {
          type: 'string',
          description: 'The `more` an earlier answer gave, for the next page.',
        },
      },
    },
    run: async (args) => {
      let q = new URLSearchParams(clean({
        query: str(args.words) || undefined,
        continuation: str(args.more) || undefined,
      }) as Record<string, string>)
      let got = await ask(`/brand-templates?${q}`)
      let templates = await Promise.all(
        ((got.items ?? []) as Json[]).map(async (t) => {
          let id = str(t.id)
          let fields = await ask(
            `/brand-templates/${encodeURIComponent(id)}/dataset`,
          ).then((d) => fieldsOf(d.dataset))
          return clean({ id, title: str(t.title) || undefined, fields })
        }),
      )
      return JSON.stringify(clean({
        templates,
        more: str(got.continuation) || undefined,
      }))
    },
  }, {
    name: 'canva_fill',
    title: 'Fill in a Canva design',
    step: { doing: 'Filling in the design…', done: 'Filled in the design' },
    description:
      "Fill in the autofill fields of a brand template or a design, making a new design, or changing the design itself when in_place is true. This is the only way Canva's API changes what is inside a design: a field the design does not mark for autofill (canva_design lists them) cannot be changed here, nor can other text on a slide or page; for that, give them the edit link.",
    parameters: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: "A brand template's id, from canva_templates.",
        },
        design: {
          type: 'string',
          description: "A design's id, when filling a design in.",
        },
        in_place: {
          type: 'boolean',
          description:
            'Change the design itself rather than making a new one (only with design).',
        },
        title: { type: 'string', description: "The new design's title." },
        fields: {
          type: 'object',
          description:
            'Each field by name: its words, or { "image": the id of an image asset in their Canva }.',
        },
        job: jobParam,
      },
    },
    run: async (args) => {
      let got = await job('/autofills', args, () => {
        let template = str(args.template), design = str(args.design)
        if (!!template == !!design) {
          throw new CallError('arguments', 'Give a template or a design.')
        }
        let data = dataOf(args.fields)
        let title = str(args.title) || undefined
        return ask(
          '/autofills',
          template
            ? {
              type: 'create_from_brand_template',
              brand_template_id: template,
              title,
              data,
            }
            : args.in_place
            ? { type: 'update_design', design_id: design, data }
            : { type: 'create_from_design', design_id: design, title, data },
        )
      })
      let result = got.result as Json | undefined
      return JSON.stringify(result ? { design: designed(result) } : got)
    },
  }, {
    name: 'canva_export',
    title: 'Export a Canva design',
    step: { doing: 'Exporting the design…', done: 'Exported the design' },
    description:
      'Export a Canva design as a file: PDF, PNG, JPG, PowerPoint, GIF or MP4. It answers download links, which work for 24 hours.',
    parameters: {
      type: 'object',
      properties: {
        design: designParam,
        format: {
          type: 'string',
          enum: ['pdf', 'png', 'jpg', 'pptx', 'gif', 'mp4'],
        },
        pages: {
          type: 'array',
          items: { type: 'number' },
          description: 'The pages to export, numbered from 1; all by default.',
        },
        job: jobParam,
      },
      required: ['design', 'format'],
    },
    run: async (args) => {
      let got = await job('/exports', args, () => {
        let type = str(args.format)
        let pages = Array.isArray(args.pages) ? args.pages.map(Number) : []
        return ask('/exports', {
          design_id: str(args.design),
          format: clean({
            type,
            pages: pages.length ? pages : undefined,
            ...type == 'jpg' ? { quality: 90 } : {},
            ...type == 'mp4' ? { quality: 'horizontal_1080p' } : {},
          }),
        })
      })
      return JSON.stringify(
        got.status == 'success' ? { files: got.urls ?? [] } : got,
      )
    },
  }]
}
