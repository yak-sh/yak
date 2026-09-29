// An artifact's face, directly or through an attachment. The bytes never ride
// the graph: GET /blob/<address> serves them from the store beside the db.
import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { block, el } from '@yaks/ui'

let Img = el('img', 'Media')
let Audio = el('audio', 'Media')
let Video = el('video', 'Media')
let File = block('a', 'MediaFile', { Name: 'span', Size: 'span' })
let { Name, Size } = File

// Human byte size — 812 B, 340 KB, 1.2 MB.
let size = (n?: number | null) =>
  !n
    ? ''
    : n < 1024
    ? `${n} B`
    : n < 1024 ** 2
    ? `${Math.round(n / 1024)} KB`
    : `${(n / 1024 ** 2).toFixed(1)} MB`

export let Media = ({ e }: { e: Ent }) => {
  let b = e.attachment ? ent(e.attachment.artifact) : e
  let address = b.artifact?.address ?? e.attachment?.artifact
  let src = `/blob/${address}`
  let mime = b.artifact?.media_type ?? e.attachment?.media_type
  return mime?.startsWith('image/')
    ? (
      <Img
        src={src}
        alt={e.attachment?.name ?? 'image'}
        width={b.image?.w ?? undefined}
        height={b.image?.h ?? undefined}
      />
    )
    : mime?.startsWith('audio/')
    ? <Audio src={src} controls preload='metadata' />
    : mime?.startsWith('video/')
    ? <Video src={src} controls preload='metadata' />
    : (
      <File href={src} download={e.attachment?.name ?? 'file'}>
        <Name>{e.attachment?.name ?? 'download'}</Name>
        <Size>{size(b.artifact?.size)}</Size>
      </File>
    )
}
