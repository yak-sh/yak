// Resolve explicitly model-facing references from the executing app's bytes.
// A digest from another app grants no access outside this app's blob prefix.
import {
  type Artifact,
  artifactBytes,
  mediaTypeOf,
  objectBlobs,
} from '@yaks/blob'
import type { Bundle, Comp } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { type Item, type Model, modelReads } from '@yaks/model'
import type { Deps } from '@yaks/session'
import { blobPrefix } from './blob-key.ts'
import { directoryOf } from './directory.ts'
import type { Stored } from './graph.ts'

export let modelInputs =
  (at: Stored): NonNullable<Deps['contextItems']> =>
  async (
    window: Bundle[],
    _entries: Bundle[],
    current: { model: Model; name: string },
  ): Promise<Map<string, Item[]>> => {
    let wanted = window.filter((row) =>
      (row.attachment as Comp | undefined)?.audience == 'model'
    )
    let out = new Map<string, Item[]>()
    if (!wanted.length) return out
    let reads = await modelReads(current.model, current.name)
    let found = at.context ??
      (at.env.STORE ? await directoryOf(at.env.STORE).appAt(at.app!) : null)
    if (!found || !at.env.BLOBS) throw new Error('This app has no blob store')
    let blobs = objectBlobs(at.env.BLOBS, blobPrefix(found.space, found.app))
    let rows = await at.graph.get(
      wanted.map((row) =>
        String(
          (row.attachment as Comp).artifact ?? (row.attachment as Comp).blob,
        )
      ),
      ['artifact', 'blob'],
    )
    let artifacts = new Map(
      rows.map((row) => [row.entity.eid, row]),
    )
    let total = 0
    for (let row of wanted) {
      let attachment = row.attachment as Comp
      let source = artifacts.get(String(attachment.artifact ?? attachment.blob))
      let artifact = source?.artifact as Artifact | undefined
      if (!artifact && source?.blob) {
        artifact = {
          address: source.entity.eid,
          size: Number((source.blob as Comp).bytes),
          media_type: '',
        }
      }
      let limit = artifact?.media_type ? reads[artifact.media_type] : Math.max(
        0,
        ...Object.entries(reads).filter(([type]) => type.startsWith('image/'))
          .map(([, max]) => max),
      )
      if (
        !artifact || !limit ||
        artifact.media_type && !artifact.media_type.startsWith('image/') ||
        !/^[a-f0-9]{64}$/.test(artifact.address) ||
        !Number.isSafeInteger(artifact.size) || artifact.size < 1 ||
        artifact.size > limit
      ) {
        throw new Refused('Missing, unsupported or oversized reference image')
      }
      total += artifact.size
      if (total > 20 * 1024 * 1024) {
        throw new Refused('Reference images exceed 20 MiB')
      }
      let bytes = await artifactBytes(blobs, artifact)
      if (!bytes) {
        throw new Refused('Reference image is unavailable in this app')
      }
      let mediaType = mediaTypeOf(bytes)
      if (
        !mediaType || !reads[mediaType] || bytes.length > reads[mediaType] ||
        artifact.media_type && mediaType != artifact.media_type
      ) {
        throw new Refused('Unsupported reference image')
      }
      out.set(row.entity.eid, [{
        kind: 'image',
        bytes,
        mediaType,
        label: String(
          (row.content as Comp | undefined)?.body ?? attachment.name ??
            'Reference image',
        ),
      }])
    }
    return out
  }
