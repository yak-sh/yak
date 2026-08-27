// An attached file's face (T-12781). The bytes never ride the graph — the
// card points at GET /blob/<sha>, served from the store beside the db. An
// image shows inline (its own w/h reserve the box, so nothing reflows when it
// loads); anything else is a download link with its name and size.
import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { block, el } from '../ui.tsx'

let Img = el('img', 'Media')
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
  let a = e.attachment!
  let b = ent(a.blob)
  let src = `/blob/${a.blob}`
  return a.mime?.startsWith('image/')
    ? (
      <Img
        src={src}
        alt={a.name ?? ''}
        width={b.image?.w ?? undefined}
        height={b.image?.h ?? undefined}
      />
    )
    : (
      <File href={src} download={a.name ?? undefined}>
        <Name>{a.name ?? 'file'}</Name>
        <Size>{size(b.blob?.bytes)}</Size>
      </File>
    )
}
