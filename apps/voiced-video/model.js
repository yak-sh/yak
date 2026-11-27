// What the workflow computes without effects: an MP3's length, the cut's
// timeline from the shots and voiced lines, and where one video stands.

/** A reference as a read speaks it: the eid, or `{eid, name}`. */
export let idOf = (v) => typeof v == 'string' ? v : v?.eid ?? null

// MPEG audio's tables: kbps by version and bitrate index (layer III), and
// samples a second by version and rate index.
let KBPS = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
let RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000] }
let RATES25 = [11025, 12000, 8000]

/** How long an MP3 runs, in ms, from its frames' headers: each layer III
 * frame says its bitrate and rate, and so its length and samples. */
export let mp3ms = (bytes) => {
  let at = 0
  // An ID3v2 tag first: ten bytes of header, its size in 7-bit bytes.
  if (bytes[0] == 0x49 && bytes[1] == 0x44 && bytes[2] == 0x33) {
    at = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9])
  }
  let seconds = 0
  while (at + 4 <= bytes.length) {
    if (bytes[at] != 0xff || (bytes[at + 1] & 0xe0) != 0xe0) {
      at++
      continue
    }
    let v = (bytes[at + 1] >> 3) & 3 // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
    let layer = (bytes[at + 1] >> 1) & 3 // 1: layer III
    let bi = bytes[at + 2] >> 4, ri = (bytes[at + 2] >> 2) & 3
    let pad = (bytes[at + 2] >> 1) & 1
    if (v == 1 || layer != 1 || bi == 0 || bi == 15 || ri == 3) {
      at++
      continue
    }
    let kbps = KBPS[v == 3 ? 1 : 2][bi]
    let rate = v == 3 ? RATES[1][ri] : v == 2 ? RATES[2][ri] : RATES25[ri]
    let samples = v == 3 ? 1152 : 576
    seconds += samples / rate
    at += Math.floor(samples / 8 * kbps * 1000 / rate) + pad
  }
  return Math.round(seconds * 1000)
}

// The cut's spacing, in ms: before a shot's first line, between lines, and
// after its last; and how long a shot with no lines is shown at most.
export let LEAD = 300, GAP = 350, TAIL = 700, BARE = 2500

let byN = (comp) => (a, b) => a[comp].n - b[comp].n

/** The cut: each shot in order, as long as the lines said over it need, its
 * lines said one after another; a line placed in no shot is said over the
 * last. A shot with no lines shows its take, `BARE` ms at most. */
export let timeline = ({ lines, shots, voicings, takes }) => {
  let said = new Map(voicings.map((v) => [idOf(v.voicing.line), v]))
  let filmed = new Map(
    takes.filter((t) => t.take.film).map((t) => [idOf(t.take.shot), t]),
  )
  let ordered = shots.toSorted(byN('shot'))
  let last = ordered.at(-1)?.shot.n
  let over = (n) =>
    lines.filter((l) => {
      let at = ordered.some((s) => s.shot.n == l.line.shot) ? l.line.shot : last
      return at == n
    }).toSorted(byN('line'))
  let at = 0
  let cutShots = [], clips = []
  for (let s of ordered) {
    let take = filmed.get(s.entity.eid)
    let start = at, t = at + LEAD
    let mine = over(s.shot.n)
    for (let l of mine) {
      let v = said.get(l.entity.eid)
      let ms = v?.voicing.ms ?? 0
      clips.push({
        n: l.line.n,
        who: v?.doc?.title ?? '',
        text: l.doc?.body ?? '',
        audio: v?.voicing.audio ?? null,
        at: t,
        ms,
      })
      t += ms + GAP
    }
    let ms = mine.length
      ? t - GAP + TAIL - start
      : Math.min(take?.take.ms ?? BARE, BARE)
    cutShots.push({
      n: s.shot.n,
      title: s.doc?.title ?? '',
      film: take?.take.film ?? null,
      at: start,
      ms,
      filmed: take?.take.ms ?? 0,
    })
    at = start + ms
  }
  return { ms: at, shots: cutShots, clips }
}

let of = (rows, comp, prop, eid) =>
  rows.filter((r) => r[comp] && idOf(r[comp][prop]) == eid)

/** One video: its roles, each with its auditions and the decision asking
 * for its voice; its lines, each with its voicing once said; its shots,
 * each with its take once filmed; its cut; its finished file; and what its
 * calls failed with. */
export let progress = (video, rows) => {
  let roles = of(rows, 'role', 'video', video).map((r) => {
    let ask = of(rows, 'cast', 'role', r.entity.eid).find((d) => d.decision)
    return {
      eid: r.entity.eid,
      name: r.doc?.title ?? '',
      about: r.role.about ?? '',
      auditions: of(rows, 'audition', 'role', r.entity.eid),
      ask: ask?.entity.eid ?? null,
      chosen: ask?.decided?.choice ?? null,
    }
  })
  let named = new Map(roles.map((r) => [r.eid, r.name]))
  let lines = of(rows, 'line', 'video', video).toSorted(byN('line')).map((
    l,
  ) => ({
    eid: l.entity.eid,
    n: l.line.n,
    shot: l.line.shot ?? null,
    who: named.get(idOf(l.line.role)) ?? '',
    text: l.doc?.body ?? '',
    audio: of(rows, 'voicing', 'line', l.entity.eid)[0]?.voicing.audio ?? null,
  }))
  let shots = of(rows, 'shot', 'video', video).toSorted(byN('shot')).map((
    s,
  ) => ({
    eid: s.entity.eid,
    ...s.shot,
    title: s.doc?.title ?? '',
    film: of(rows, 'take', 'shot', s.entity.eid).find((t) => t.take.film)
      ?.take.film ?? null,
  }))
  let cut = of(rows, 'cut', 'video', video)[0] ?? null
  let film = of(rows, 'film', 'video', video).find((f) => f.film.file) ?? null
  return {
    roles,
    lines,
    shots,
    cut: cut?.cut ?? null,
    film: film?.film ?? null,
  }
}

/** What the person is shown as the video's state, in one line. */
export let stage = ({ roles, lines, shots, cut, film }) => {
  if (film) return 'Finished.'
  if (cut) return 'Rendering the video…'
  if (!lines.length) return 'Writing the script…'
  if (!shots.length) return 'Planning the shots…'
  let waiting = roles.filter((r) => !r.chosen)
  if (waiting.some((r) => !r.ask)) return 'Auditioning voices…'
  if (waiting.length) {
    return `Choose a voice for ${waiting.map((r) => r.name).join(', ')}.`
  }
  let said = lines.filter((l) => l.audio).length
  if (said < lines.length) return `Voicing lines: ${said} of ${lines.length}.`
  let filmed = shots.filter((s) => s.film).length
  return `Filming shots: ${filmed} of ${shots.length}.`
}
