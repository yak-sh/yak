/** File snapshots and explicit image context. All bytes remain in external storage. */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Item } from '@yaks/model'
import { type Tool, ToolError } from '@yaks/session'
import { fileBlobs } from '@yaks/blob'
import { type ImageOptions, images } from './images.ts'
import { sessionCwd } from './workspace.ts'

const MAX = 20 * 1024 * 1024
const directory = (opts?: ImageOptions | false) =>
  (opts && opts.directory) || Deno.env.get('HARNESS_IMAGE_DIR') ||
  Deno.env.get('HOME') + '/.harness/images'

/** Supported vision formats; SVG and unrecognized bytes are never image inputs. */
export let imageType = (b: Uint8Array): string | undefined => {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] == v)) {
    return 'image/png'
  }
  if (b[0] == 255 && b[1] == 216 && b[2] == 255) return 'image/jpeg'
  if (
    new TextDecoder().decode(b.subarray(0, 4)) == 'RIFF' &&
    new TextDecoder().decode(b.subarray(8, 12)) == 'WEBP'
  ) return 'image/webp'
}

/** Graph authorization is applied before resolving an external address. */
export let artifactBytes = async (
  g: Graph,
  eid: string,
  opts?: ImageOptions | false,
) => {
  let [row] = await g.read('.entity.eid=' + JSON.stringify(eid))
  let a = row?.artifact as Comp | undefined
  if (
    !a || typeof a.address != 'string' || !/^[a-f0-9]{64}$/.test(a.address) ||
    typeof a.size != 'number' || a.size < 0 || a.size > MAX
  ) {
    throw new ToolError(
      'artifact',
      'Missing, unauthorized, or oversized artifact',
    )
  }
  let bytes = await fileBlobs(directory(opts)).get(a.address)
  if (!bytes || bytes.length != a.size) {
    throw new ToolError('artifact', 'Artifact bytes unavailable')
  }
  let hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  if (hash != a.address) {
    throw new ToolError('artifact', 'Artifact integrity check failed')
  }
  return { bytes, mediaType: String(a.media_type), revision: hash }
}

export let artifactTools = (
  g: Graph,
  opts: { cwd?: string; images?: ImageOptions | false } = {},
): Tool[] => [
  {
    name: 'artifact_import',
    description:
      'Snapshot a local file into external artifact storage (maximum 20 MiB). Relative paths use this session’s cwd. Does not attach or send it to the model.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    run: async (args, ctx) => {
      if (!ctx) throw new ToolError('artifact', 'Session context required')
      let path = String(args.path ?? '')
      if (!path) throw new ToolError('artifact', 'A file path is required')
      if (!path.startsWith('/')) {
        path = await sessionCwd(g, ctx.session, opts.cwd ?? Deno.cwd()) + '/' +
          path
      }
      let file: Deno.FsFile
      try {
        file = await Deno.open(path, { read: true })
      } catch {
        throw new ToolError('artifact', 'Cannot open file')
      }
      let bytes: Uint8Array
      try {
        let stat = await file.stat()
        if (!stat.isFile || stat.size > MAX) {
          throw new ToolError(
            'artifact',
            'Expected a regular file up to 20 MiB',
          )
        }
        bytes = new Uint8Array(stat.size)
        let at = 0
        while (at < bytes.length) {
          let n = await file.read(bytes.subarray(at))
          if (n == null) {
            throw new ToolError('artifact', 'File changed while reading')
          }
          at += n
        }
        if (await file.read(new Uint8Array(1)) != null) {
          throw new ToolError('artifact', 'File grew while reading')
        }
      } finally {
        file.close()
      }
      let artifact = await images({ directory: directory(opts.images) }).store(
        bytes,
        imageType(bytes) ?? 'application/octet-stream',
      )
      let eid = 'artifact:' + artifact.address
      await g.apply([{ entity: { eid }, artifact }])
      return JSON.stringify({ artifact: eid, ...artifact })
    },
  },
  ...(['user', 'model'] as const).map((audience): Tool => ({
    name: audience == 'user' ? 'artifact_attach' : 'image_view',
    description: audience == 'user'
      ? 'Attach a registered artifact to this conversation for the user. Images may render inline; this does not send image pixels to the model.'
      : 'Inspect a registered PNG, JPEG or WebP artifact as vision input on the next model turn. Stores only the reference; never returns base64 text.',
    parameters: {
      type: 'object',
      properties: { artifact: { type: 'string' } },
      required: ['artifact'],
    },
    run: async (args, ctx) => {
      if (!ctx) throw new ToolError('artifact', 'Session context required')
      let eid = String(args.artifact ?? '')
      let { bytes, mediaType, revision } = await artifactBytes(
        g,
        eid,
        opts.images,
      )
      if (audience == 'model' && imageType(bytes) != mediaType) {
        throw new ToolError('image', 'Unsupported or invalid image type')
      }
      // The existing call entry provides stable identity and ordering. Replays patch the same attachment.
      await g.apply([{
        entity: ctx.call.entity,
        attachment: { artifact: eid, audience, revision },
        content: {
          body:
            (audience == 'model' ? 'Inspect image: ' : 'Attached artifact: ') +
            eid,
        },
      }])
      return JSON.stringify({
        artifact: eid,
        media_type: mediaType,
        size: bytes.length,
        audience,
      })
    },
  })),
]

/** Add pixels only for successful inspection results in the request window. */
export let imageContext = async (
  g: Graph,
  window: Bundle[],
  entries: Bundle[],
  opts?: ImageOptions | false,
): Promise<Item[]> => {
  let items: Item[] = []
  let total = 0
  let byId = new Map(entries.map((b) => [b.entity.eid, b]))
  for (let entry of window) {
    let result = entry.result as Comp | undefined
    if (!result) continue
    let call = byId.get(String(result.call))
    let attachment = call?.attachment as Comp | undefined
    if (attachment?.audience != 'model') continue
    let eid = String(attachment.artifact)
    let { bytes, mediaType, revision } = await artifactBytes(g, eid, opts)
    if (attachment.revision != revision) {
      throw new ToolError('image', 'Image reference changed since admission')
    }
    total += bytes.length
    if (total > MAX) {
      throw new ToolError(
        'image',
        'Image context exceeds 20 MiB; start a new session',
      )
    }
    if (imageType(bytes) != mediaType) {
      throw new ToolError('image', 'Unsupported or invalid image type')
    }
    items.push({
      kind: 'image',
      bytes,
      mediaType,
      label: 'Image requested by tool call ' +
        String((call?.call as Comp)?.id) + ': ' + eid,
    })
  }
  return items
}
