// The digest's chart: bugs opened and fixed each day, the warnings that opened
// none, and the median time to fix of the day's fixes, drawn as a PNG a mail
// client shows. Its numbers ride in its address, so whoever draws it reads
// nothing and needs no ticket: the image is a pure function of the query
// string.

import { png } from '@yaks/blob/png'

/** One day of the chart: bugs opened (first seen or regressed) and fixed,
 * the warnings that opened none, and the median time to fix of that day's
 * fixes, in milliseconds. */
export type Day = {
  day: string
  opened: number
  fixed: number
  warned: number
  fix?: number
}

// The most days an address may carry, and the largest count it draws.
let MOST = 31, TOP = 9999

/// query([{ day: '2026-11-19', opened: 3, fixed: 1, warned: 5, fix: 240_000 }, { day: '2026-11-20', opened: 0, fixed: 2, warned: 0 }])
///   -> 'd=2026-11-19&o=3,0&f=1,2&t=4,&w=5,0'
/** A chart's days as the query string its image is drawn from: the first
 * day, then opened, fixed, minutes to fix and warnings, a day each. */
export let query = (days: Day[]): string =>
  new URLSearchParams({
    d: days[0]?.day ?? '',
    o: days.map((d) => d.opened).join(','),
    f: days.map((d) => d.fixed).join(','),
    t: days.map((d) => d.fix == undefined ? '' : Math.round(d.fix / 60_000))
      .join(','),
    w: days.map((d) => d.warned).join(','),
  }).toString().replace(/%2C/g, ',')

let after = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString()
    .slice(0, 10)

/// days(new URLSearchParams('d=2026-11-30&o=3,0&f=1,2&t=4,&w=5,0'))
///   -> [{ day: '2026-11-30', opened: 3, fixed: 1, warned: 5, fix: 240_000 }, { day: '2026-12-01', opened: 0, fixed: 2, warned: 0 }]
/// days(new URLSearchParams('d=2026-11-30&o=3&f=1&t='))
///   -> [{ day: '2026-11-30', opened: 3, fixed: 1, warned: 0 }]
/// days(new URLSearchParams('d=nope&o=1&f=1&t=')) -> undefined
/** The days a chart's query string carries, or undefined for one that is
 * not a chart's. An address from before warnings were counted draws none. */
export let days = (q: URLSearchParams): Day[] | undefined => {
  let first = q.get('d') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !Date.parse(first)) return
  let list = (k: string) => (q.get(k) ?? '').split(',')
  let [o, f, t] = [list('o'), list('f'), list('t')]
  let w = q.has('w') ? list('w') : o.map(() => '0')
  if (
    o.length > MOST || f.length != o.length || t.length != o.length ||
    w.length != o.length
  ) return
  let count = (s: string) => /^\d{1,4}$/.test(s) ? Number(s) : NaN
  let out = o.map((s, i): Day => ({
    day: after(first, i),
    opened: count(s),
    fixed: count(f[i]),
    warned: count(w[i]),
    ...t[i] ? { fix: count(t[i]) * 60_000 } : {},
  }))
  return out.every((d) =>
      d.opened <= TOP && d.fixed <= TOP && d.warned <= TOP &&
      !Number.isNaN(d.fix ?? 0)
    )
    ? out
    : undefined
}

/** The colours a chart is drawn in, which the letter's caption names. */
export let COLOURS = {
  opened: [209, 73, 91],
  fixed: [60, 154, 95],
  warned: [150, 160, 180],
  fix: [224, 161, 0],
} as const
let INK = [110, 110, 110], RULE = [215, 215, 215]

// Digits three pixels wide and five high, a row a number.
let GLYPHS = [
  '111101101101111',
  '010110010010111',
  '111001111100111',
  '111001111001111',
  '101101111001001',
  '111100111001111',
  '111100111101111',
  '111001001001001',
  '111101111101111',
  '111101111001111',
]

// Drawn twice the size it is laid out at, for a sharp image on a dense screen.
let W = 600, H = 200, S = 2, PAD = 8, BASE = H - 18, ROOF = 16

/** The chart of `days` as PNG bytes, 1200 by 400 pixels. */
export let chart = (days: Day[]): Promise<Uint8Array> => {
  let px = new Uint8Array(W * S * H * S * 4).fill(255)
  let dot = (x: number, y: number, c: readonly number[]) => {
    if (x < 0 || y < 0 || x >= W * S || y >= H * S) return
    px.set(c, (y * W * S + x) * 4)
  }
  let box = (
    x: number,
    y: number,
    w: number,
    h: number,
    c: readonly number[],
  ) => {
    for (let j = Math.round(y * S); j < Math.round((y + h) * S); j++) {
      for (let i = Math.round(x * S); i < Math.round((x + w) * S); i++) {
        dot(i, j, c)
      }
    }
  }
  // A number centred on x with its foot at y, at `k` laid-out units a pixel.
  let write = (n: number, x: number, y: number, k = 1.5) => {
    let s = String(n), w = s.length * 4 * k - k
    ;[...s].forEach((ch, at) =>
      [...GLYPHS[Number(ch)]].forEach((on, i) => {
        if (on == '1') {
          box(
            x - w / 2 + (at * 4 + i % 3) * k,
            y - (5 - (i / 3 | 0)) * k,
            k,
            k,
            INK,
          )
        }
      })
    )
  }
  let line = (
    a: [number, number],
    b: [number, number],
    c: readonly number[],
  ) => {
    let steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * S)
    for (let s = 0; s <= steps; s++) {
      let x = a[0] + (b[0] - a[0]) * s / steps,
        y = a[1] + (b[1] - a[1]) * s / steps
      box(x - 1, y - 1, 2, 2, c)
    }
  }
  let n = Math.max(days.length, 1), slot = (W - 2 * PAD) / n
  let most = Math.max(
    1,
    ...days.flatMap((d) => [d.opened, d.fixed, d.warned]),
  )
  let slowest = Math.max(1, ...days.map((d) => d.fix ?? 0))
  let tall = BASE - ROOF - 10
  box(PAD, BASE, W - 2 * PAD, 1, RULE)
  let points: ([number, number] | undefined)[] = days.map((d, i) => {
    let x = PAD + i * slot, bar = Math.max(2, slot * 0.28)
    let mid = x + slot / 2
    ;([
      ['opened', mid - 1.5 * bar],
      ['fixed', mid - 0.5 * bar],
      ['warned', mid + 0.5 * bar],
    ] as const).forEach(([k, left]) => {
      let h = d[k] / most * tall
      if (!d[k]) return
      box(left, BASE - h, bar, h, COLOURS[k])
      write(d[k], left + bar / 2, BASE - h - 3, 1)
    })
    write(Number(d.day.slice(8)), mid, H - 4)
    return d.fix == undefined ? undefined : [mid, BASE - d.fix / slowest * tall]
  })
  points.forEach((p, i) => {
    let next = points[i + 1]
    if (p && next) line(p, next, COLOURS.fix)
    if (p) box(p[0] - 2.5, p[1] - 2.5, 5, 5, COLOURS.fix)
  })
  return png(W * S, H * S, px)
}

/** Answer a request for a chart: the image its query string draws, kept by
 * any cache for good since the same address always draws the same image, or
 * 400 for an address that is not a chart's. */
export let serve = async (url: URL): Promise<Response> => {
  let drawn = days(url.searchParams)
  if (!drawn) return new Response('not a chart', { status: 400 })
  return new Response(await chart(drawn) as Uint8Array<ArrayBuffer>, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
