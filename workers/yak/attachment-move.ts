// Operator attachments kept before their graph rows: add their metadata in
// bounded alarm batches. Bytes stay where they are, and a retry finds the
// same entities. This is additive, so old code keeps reading the file lists.
import type { Comp } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import { link } from '@yaks/edge'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import type { File } from './operator-channels.ts'
import { attachmentOf, attachmentRows } from './operator-attachments.ts'
import { sourceId } from './operator-source.ts'
import type { OperatorStore } from './operator-store.ts'

export let ATTACHMENTS = 'operator:attachments'
let states = new WeakMap<object, string>()
let marked = (store: OperatorStore): Pick<Meta, 'get' | 'set'> =>
  store.marks ?? {
    get: () => states.get(store.g),
    set: (_, value) => {
      states.set(store.g, value)
    },
  }

type Pass = {
  source?: string
  sessions?: string
  cursor?: string
  blobs?: boolean
  space?: Space
}

let sized = async (env: Pick<Env, 'BLOBS'>, file: File): Promise<File> => {
  if (file.size != null) return file
  let head = await env.BLOBS.head(file.key)
  if (!head) throw new Error('Operator attachment is missing: ' + file.name)
  return { ...file, size: head.size }
}

/** One migration batch, at most fifty source rows or bucket objects. Returns
 * whether another alarm has work; the receipt advances only after writes land. */
export let attachmentBackfill = async (
  store: OperatorStore,
  env: Pick<Env, 'BLOBS' | 'STORE'>,
): Promise<boolean> => {
  let marks = marked(store)
  let saved = marks.get(ATTACHMENTS)
  if (saved == 'done') return false
  let pass: Pass = saved ? JSON.parse(saved) : {}
  if (!pass.space) {
    let [source] = await store.g.read(
      '(.operator_request.space|.operator_session.space)&.limit=1&*',
    )
    let eid = (source?.operator_request as Comp | undefined)?.space ??
      (source?.operator_session as Comp | undefined)?.space
    if (eid) {
      pass.space = await directoryOf(env.STORE).at(String(eid)) ?? undefined
    }
  }
  if (!pass.blobs && pass.sessions == null) {
    let rows = await store.g.read(
      `( .operator_request|.operator_files|.operator_session|.entry&.content.body~="Original message text: message.txt (attachment " )${
        pass.source ? `&.entity.eid>${pass.source}` : ''
      }&.order=entity.eid&.limit=50&*`,
    )
    for (let row of rows) {
      let source = (row.operator_request ?? row.operator_files ??
        row.operator_session ?? {}) as Comp
      if (!pass.space && source.space) {
        pass.space = await directoryOf(env.STORE).at(String(source.space)) ??
          undefined
      }
      // Session lists are accumulated copies; message-owned lists below
      // preserve the name and message of every occurrence instead.
      if (
        row.operator_session && !row.operator_request && !row.operator_files
      ) {
        continue
      }
      let files = (source.files ?? []) as File[]
      let original = sourceId(
        String((row.content as Comp | undefined)?.body ?? ''),
      )
      if (original && pass.space) {
        files = [...files, {
          name: 'message.txt',
          mime: 'text/plain',
          key: `${pass.space.store}/.operator/${original}`,
        }]
      }
      files = await Promise.all(files.map((file) => sized(env, file)))
      let message = String(source.request ?? row.entity.eid)
      let bundles = attachmentRows(message, files)
      if (bundles.length) await store.g.apply(bundles, { trusted: true })
    }
    if (rows.length == 50) pass.source = rows.at(-1)!.entity.eid
    else pass.sessions = ''
    marks.set(ATTACHMENTS, JSON.stringify(pass))
    return true
  }
  if (!pass.blobs) {
    let rows = await store.g.read(
      `.operator_session${
        pass.sessions ? `&.entity.eid>${pass.sessions}` : ''
      }&.order=entity.eid&.limit=50&*`,
    )
    for (let row of rows) {
      let files = ((row.operator_session as Comp).files ?? []) as File[]
      for (let [i, file] of files.entries()) {
        let sha = file.key.split('/').at(-1)!
        if (
          (await store.g.read(`.attachment.artifact=${sha}&.limit=1`)).length
        ) continue
        let bundles = attachmentRows(row.entity.eid, [await sized(env, file)])
        let eid = attachmentOf(row.entity.eid, i)
        let { message: _, ...attachment } = bundles[1].attachment as Comp
        bundles[1] = { entity: { eid }, attachment }
        await store.g.apply(
          [...bundles, link(row.entity.eid, 'contains', eid)],
          { trusted: true },
        )
      }
    }
    if (rows.length == 50) pass.sessions = rows.at(-1)!.entity.eid
    else pass.blobs = true
    marks.set(ATTACHMENTS, JSON.stringify(pass))
    return true
  }
  if (!pass.space) {
    marks.set(ATTACHMENTS, 'done')
    return false
  }
  let prefix = `${pass.space.store}/.operator/`
  let page = await env.BLOBS.list({ prefix, cursor: pass.cursor, limit: 50 })
  let objects = page.objects.filter((o) =>
    /^[0-9a-f]{64}$/.test(o.key.slice(prefix.length))
  )
  let ids = objects.map((o) => o.key.slice(prefix.length))
  let known = new Set(
    (await store.g.get(ids)).filter((b) => b.artifact).map((b) => b.entity.eid),
  )
  let bundles = objects.filter((o) => !known.has(o.key.slice(prefix.length)))
    .map((o) => {
      let sha = o.key.slice(prefix.length)
      return {
        entity: { eid: sha },
        artifact: {
          address: sha,
          size: o.size,
          media_type: 'application/octet-stream',
        },
      }
    })
  if (bundles.length) await store.g.apply(bundles, { trusted: true })
  marks.set(
    ATTACHMENTS,
    page.truncated ? JSON.stringify({ ...pass, cursor: page.cursor }) : 'done',
  )
  return page.truncated
}
