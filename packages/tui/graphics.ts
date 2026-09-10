/** Opt-in Kitty graphics: PNG transport, bounded cache, explicit placement cleanup. */
import type { Line } from './paint.ts'
import type { ImageSource } from './Image.ts'

let png = (bytes: Uint8Array) =>
  [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] == b)
let base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let start = 0; start < bytes.length; start += 8192) {
    out += String.fromCharCode(...bytes.subarray(start, start + 8192))
  }
  return btoa(out)
}
export let graphics = (options: {
  enabled: boolean
  tmux?: boolean
  changed: () => void
}) => {
  type Picture = {
    id: number
    bytes?: Uint8Array
    sent?: boolean
    failed?: boolean
  }
  let cache = new Map<string, Picture>()
  let next = 1, closed = false, placements = ''
  let control = (params: string, data = '') => {
    let command = '\x1b_G' + params + (data ? ';' + data : '') + '\x1b\\'
    return options.tmux
      ? '\x1bPtmux;' + command.replaceAll('\x1b', '\x1b\x1b') + '\x1b\\'
      : command
  }
  let remove = (id: number) => control('a=d,d=I,i=' + id + ',q=2')
  let load = (source: ImageSource): Picture => {
    let found = cache.get(source.key)
    if (found) return found
    let picture: Picture = { id: next++ }
    cache.set(source.key, picture)
    Promise.resolve().then(source.load).then((bytes) => {
      if (bytes.length > 4 * 1024 * 1024 || bytes.length < 24 || !png(bytes)) {
        picture.failed = true
        return
      }
      let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      let width = view.getUint32(16), height = view.getUint32(20)
      if (!width || !height || width * height > 32 * 1024 * 1024) {
        picture.failed = true
        return
      }
      picture.bytes = bytes
    }).catch(() => {
      picture.failed = true
    }).finally(() => {
      if (!closed) options.changed()
    })
    return picture
  }
  return {
    reset: () => {
      placements = ''
    },
    close: () => {
      closed = true
      let out = [...cache.values()].map((p) => remove(p.id)).join('')
      cache.clear()
      return out
    },
    draw: (lines: Line[], textChanged = false): string => {
      if (!options.enabled || closed) return ''
      let visible: {
        source: ImageSource
        x: number
        y: number
        width: number
        rows: number
      }[] = []
      for (let y = 0; y < lines.length; y++) {
        let x = 0
        for (let seg of lines[y]) {
          let image = seg.image
          if (
            image?.row == 0 && seg.text.length == image.width &&
            image.width > 0 &&
            y + image.rows <= lines.length
          ) {
            // Never transmit partially clipped images: retain their text fallback.
            let full = Array.from(
              { length: image.rows },
              (_, row) =>
                lines[y + row].some((s) =>
                  s.image?.source.key == image.source.key &&
                  s.image.row == row && s.text.length == image.width
                ),
            ).every(Boolean)
            if (full) {
              visible.push({
                source: image.source,
                x,
                y,
                width: image.width,
                rows: image.rows,
              })
            }
          }
          x += seg.text.length
        }
      }
      let keys = new Set(visible.map((v) => v.source.key))
      let out = ''
      // Bound pending loads and retained bytes. Only visible images initiate I/O.
      for (let [key, p] of cache) {
        if (cache.size < 8) break
        if (!keys.has(key)) {
          out += remove(p.id)
          cache.delete(key)
        }
      }
      for (let v of visible) {
        if (cache.size < 8 || cache.has(v.source.key)) load(v.source)
      }
      let ready = visible.filter((v) => cache.get(v.source.key)?.bytes)
      let signature = JSON.stringify(
        ready.map((v) => [v.source.key, v.x, v.y, v.width, v.rows]),
      )
      if (signature == placements && !textChanged) return out
      // Delete only this backend's placements, leaving uploaded bytes reusable.
      for (let p of cache.values()) {
        if (p.sent) out += control('a=d,d=i,i=' + p.id + ',q=2')
      }
      for (let v of ready) {
        let p = cache.get(v.source.key)!
        if (!p.sent) {
          let encoded = base64(p.bytes!)
          for (let i = 0; i < encoded.length; i += 4096) {
            let more = i + 4096 < encoded.length ? 1 : 0
            out += control(
              (i == 0 ? 'a=t,f=100,t=d,i=' + p.id + ',q=2,' : '') + 'm=' + more,
              encoded.slice(i, i + 4096),
            )
          }
          p.sent = true
        }
        out += '\x1b7' + '\x1b[' + (v.y + 1) + ';' + (v.x + 1) + 'H' +
          control(
            'a=p,i=' + p.id + ',c=' + v.width + ',r=' + v.rows + ',C=1,q=2',
          ) + '\x1b8'
      }
      placements = signature
      return out
    },
  }
}
