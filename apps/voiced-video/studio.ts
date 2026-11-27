// The studio: the two steps of the workflow that need a browser and a video
// encoder. It answers the app's open `take` tasks (a shot to film) and
// `film` tasks (a cut to render), through the `yak` CLI's admin tools:
//
// - a take: the shot's page opened in Cloudflare's browser (`yak admin
//   browse --record`), its steps filmed as frames, each named for when it
//   was shown, encoded as an MP4 and kept at the app's ./api/blob;
// - a film: each shot's take held or trimmed to its time in the cut, the
//   voiced lines laid at theirs, captions burned in, kept as one MP4.
//
// No browser runs here; ffmpeg does (on PATH, or FFMPEG).
//
//   deno run -A apps/voiced-video/studio.ts jeff/voiced-video [--once]

import { frameAt } from '@yaks/platform/browser-visit'

type Row = Record<string, Record<string, unknown>> & { entity: { eid: string } }
type Comp = Record<string, unknown>

let [where] = Deno.args.filter((a) => !a.startsWith('--'))
let once = Deno.args.includes('--once')
let FFMPEG = Deno.env.get('FFMPEG') ?? 'ffmpeg'
let HOME = new URL('../../.scratch/studio/', import.meta.url).pathname
let EVERY = 15_000
// Cloudflare's Browser Rendering beyond the plan's hours, a browser hour.
let BROWSER_HOUR = 0.09

let run = async (cmd: string, args: string[]) => {
  let out = await new Deno.Command(cmd, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  })
    .output()
  let text = new TextDecoder().decode(out.stdout)
  if (!out.success) {
    throw new Error(
      `${cmd} ${args.slice(0, 3).join(' ')}: ${
        new TextDecoder().decode(out.stderr).slice(-2000) || text.slice(-2000)
      }`,
    )
  }
  return text
}
let yak = (...args: string[]) => run('yak', ['admin', ...args])
let query = async (q: string): Promise<Row[]> =>
  JSON.parse(await yak('query', where, q)).result
let apply = (bundles: unknown[]) => yak('apply', where, JSON.stringify(bundles))
// A file kept at the app's ./api/blob: its eid, and a copy kept here, so
// what the studio made is never read back.
let upload = async (path: string, mime: string) => {
  let said = await yak('upload', where, path, '--mime', mime)
  let eid = / eid (\S+),/.exec(said)?.[1]
  if (!eid) throw new Error(`upload said no eid: ${said.slice(0, 300)}`)
  await Deno.mkdir(`${HOME}blobs`, { recursive: true })
  await Deno.copyFile(path, `${HOME}blobs/${eid}`)
  return eid
}
// A blob of the app's, kept here once read.
let fetched = async (eid: string) => {
  let path = `${HOME}blobs/${eid}`
  try {
    await Deno.stat(path)
  } catch {
    await Deno.mkdir(`${HOME}blobs`, { recursive: true })
    await yak('download', where, eid, '--to', path)
  }
  return path
}
let ref = (v: unknown) => typeof v == 'string' ? v : (v as Comp)?.eid as string
let ffmpeg = (args: string[]) => run(FFMPEG, ['-hide_banner', '-y', ...args])

/** The concat list that shows each frame until the next, the last until
 * `ms`; with no frames, `still` for that long. */
export let frameList = (frames: string[], ms: number, still: string) => {
  let shown = frames.map((f) => ({ f, at: frameAt(f) ?? 0 }))
    .toSorted((a, b) => a.at - b.at)
  if (!shown.length) shown = [{ f: still, at: 0 }]
  let lines = shown.flatMap(({ f, at }, i) => {
    let until = shown[i + 1]?.at ?? Math.max(ms, at + 40)
    return [`file '${f}'`, `duration ${((until - at) / 1000).toFixed(3)}`]
  })
  // The concat demuxer takes the last duration only when its file repeats.
  return [...lines, `file '${shown.at(-1)!.f}'`, ''].join('\n')
}

let fit = (w: number, h: number) =>
  `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p`

// One shot filmed: its frames encoded as take.mp4 in its own directory.
let film = async (take: Row, shot: Row) => {
  let s = shot.panel as Comp
  let dir = `${HOME}takes/${take.entity.eid}`
  await Deno.remove(dir, { recursive: true }).catch(() => {})
  await Deno.mkdir(dir, { recursive: true })
  let [w, h] = [Number(s.width) || 1280, Number(s.height) || 720]
  let still = s.kind == 'still'
  let said = await yak(
    'browse',
    String(s.page),
    ...still ? [] : ['--record'],
    ...s.as == 'stranger' ? ['--stranger'] : ['--as', String(s.as)],
    '--width',
    String(w),
    '--height',
    String(h),
    '--touch=false',
    '--wait',
    '1500',
    '--steps',
    JSON.stringify(s.steps ?? []),
    '--to',
    dir,
  )
  let ms = still ? 3000 : Number(/record\s+(\d+) ms/.exec(said)?.[1] ?? 3000)
  let browser = Number(/HTTP \d+, ([\d.]+)s of browser/.exec(said)?.[1] ?? 0)
  let frames = [...Deno.readDirSync(dir)].map((e) => e.name)
    .filter((n) => frameAt(n) != null).map((n) => `${dir}/${n}`)
  await Deno.writeTextFile(
    `${dir}/frames.txt`,
    frameList(still ? [] : frames, ms, `${dir}/end.png`),
  )
  await ffmpeg([
    ...['-f', 'concat', '-safe', '0', '-i', `${dir}/frames.txt`],
    ...['-vf', fit(w, h), '-c:v', 'libx264', '-preset', 'veryfast'],
    ...['-crf', '20', '-movflags', '+faststart', `${dir}/take.mp4`],
  ])
  return { path: `${dir}/take.mp4`, ms, browser, frames: frames.length }
}

/** The open takes worth filming, in order, and those a newer take of the
 * same panel supersedes (its panel changed before it was filmed). */
export let waiting = (rows: Row[]) => {
  let at = (t: Row) => String((t.created as Comp | undefined)?.at ?? '')
  let open = rows.filter((t) => !(t.take as Comp).film)
  let newest = new Map<string, Row>()
  for (let t of open) {
    let p = ref(t.take.panel), held = newest.get(p)
    if (!held || at(t) > at(held)) newest.set(p, t)
  }
  let film = open.filter((t) => newest.get(ref(t.take.panel)) == t)
    .toSorted((a, b) => Number(a.take.n) - Number(b.take.n))
  return { film, stale: open.filter((t) => !film.includes(t)) }
}

let takes = async () => {
  let { film: open, stale } = waiting(await query('.take&*&?created'))
  if (stale.length) {
    await apply(
      stale.map((t) => ({ entity: { eid: t.entity.eid }, tombstone: {} })),
    )
  }
  let last = 0
  let panel = async (take: Row) =>
    (await query(`.eid=${ref(take.take.panel)}&*`))[0]
  for (let take of open) {
    let shot = await panel(take)
    if (!shot) continue
    // Time for what an earlier shot started (an Operator's work) to finish.
    let after = Number((shot.panel as Comp).after ?? 0) * 1000
    let wait = last ? last + after - Date.now() : 0
    if (wait > 0) {
      console.log(`shot ${take.take.n}: waiting ${Math.round(wait / 1000)} s`)
      await new Promise((r) => setTimeout(r, wait))
      // Filmed as it stands now: the panel may have changed while it waited,
      // and a changed panel has a take of its own.
      let still = await query(`.eid=${take.entity.eid}`)
      shot = await panel(take)
      if (!still.length || !shot) continue
    }
    console.log(`shot ${take.take.n}: filming ${(shot.panel as Comp).page}`)
    let made = await film(take, shot)
    last = Date.now()
    let blob = await upload(made.path, 'video/mp4')
    // A shot filmed again replaces its earlier takes.
    let older = (await query(`.take.panel=${shot.entity.eid}`))
      .filter((t) => t.entity.eid != take.entity.eid)
    await apply([
      {
        entity: { eid: take.entity.eid },
        take: { film: blob, ms: made.ms, browser: made.browser },
        completed: {},
      },
      ...older.map((t) => ({ entity: { eid: t.entity.eid }, tombstone: {} })),
    ])
    console.log(
      `shot ${take.take.n}: ${made.frames} frames, ${made.ms} ms, ${made.browser} s of browser`,
    )
  }
}

/** Captions for the cut's clips, as SRT. */
export let srt = (clips: Comp[]) => {
  let t = (ms: number) => {
    let d = new Date(Math.max(0, ms)).toISOString()
    return `${d.slice(11, 19)},${d.slice(20, 23)}`
  }
  return clips.map((c, i) =>
    `${i + 1}\n${t(Number(c.at))} --> ${
      t(Number(c.at) + Number(c.ms))
    }\n${c.text}\n`
  ).join('\n')
}

// The cut rendered: shots held or trimmed to their time, lines laid at
// theirs, captions burned in.
let render = async (cut: Comp, out: string) => {
  let shots = cut.shots as Comp[],
    clips = (cut.clips as Comp[])
      .filter((c) => c.audio)
  let dir = out.replace(/[^/]+$/, '')
  await Deno.writeTextFile(`${dir}cut.srt`, srt(clips))
  let inputs: string[] = [], graph: string[] = []
  for (let [i, s] of shots.entries()) {
    inputs.push('-i', await fetched(String(s.film)))
    let pad = Math.max(0, (Number(s.ms) - Number(s.filmed)) / 1000) + 1
    graph.push(
      `[${i}:v]tpad=stop_mode=clone:stop_duration=${pad},trim=duration=${
        Number(s.ms) / 1000
      },setpts=PTS-STARTPTS[v${i}]`,
    )
  }
  for (let [j, c] of clips.entries()) {
    inputs.push('-i', await fetched(String(c.audio)))
    let at = Math.round(Number(c.at))
    graph.push(`[${shots.length + j}:a]adelay=${at}|${at}[a${j}]`)
  }
  let seconds = Number(cut.ms) / 1000
  graph.push(
    `${
      shots.map((_, i) => `[v${i}]`).join('')
    }concat=n=${shots.length}:v=1:a=0,subtitles=${dir}cut.srt:force_style='Fontsize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=6,Shadow=0,MarginV=28'[v]`,
    `${
      clips.map((_, j) => `[a${j}]`).join('')
    }amix=inputs=${clips.length}:normalize=0,apad,atrim=duration=${seconds}[a]`,
  )
  await ffmpeg([
    ...inputs,
    ...['-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]'],
    ...['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'],
    ...['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out],
  ])
}

let films = async () => {
  let open = (await query('.film&*')).filter((f) => !(f.film as Comp).file)
  for (let f of open) {
    let [cut] = await query(`.eid=${ref(f.film.cut)}&*`)
    if (!cut) continue
    let dir = `${HOME}films/${f.entity.eid}/`
    await Deno.mkdir(dir, { recursive: true })
    console.log(`film ${f.entity.eid}: rendering ${cut.cut.ms} ms`)
    await render(cut.cut as Comp, `${dir}film.mp4`)
    let file = await upload(`${dir}film.mp4`, 'video/mp4')
    await apply([{
      entity: { eid: f.entity.eid },
      film: { file, ms: Number(cut.cut.ms) },
      completed: {},
    }])
    let browser = (await query(`.take.video=${ref(f.film.video)}&*`))
      .reduce((s, t) => s + Number(t.take.browser ?? 0), 0)
    let voices = (await query(`.voicing.video=${ref(f.film.video)}&*`))
      .reduce((s, v) => s + Number(v.voicing.dollars ?? 0), 0)
    console.log(
      `film ${f.entity.eid}: kept as ${file}; voices $${voices.toFixed(4)}, ` +
        `${browser.toFixed(1)} s of browser ($${
          (browser / 3600 * BROWSER_HOUR).toFixed(4)
        } past the plan's hours)`,
    )
  }
}

if (import.meta.main) {
  if (!where) {
    console.error('usage: studio.ts <space/app> [--once]')
    Deno.exit(2)
  }
  while (true) {
    try {
      await takes()
      await films()
    } catch (e) {
      console.error(e instanceof Error ? e.message : e)
      if (once) Deno.exit(1)
    }
    if (once) break
    await new Promise((r) => setTimeout(r, EVERY))
  }
}
