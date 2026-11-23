/** @jsxImportSource preact */
// The sky behind the home page's hero: dusk when the page is light, night
// when it is dark, over the same three ranges of hills and the same wavy
// line he sits on, with grass under the line that fades into the page.
//
// Everything is drawn here, from seeds, in his units: a 128th of his slot,
// his middle at x 0, the ground under his hooves at y 0, up negative. The
// far scene is drawn in viewBox -3000 -800 6000 860 and the turf in
// -3000 -60 6000 300; public/sky.js measures where he sits and lays both out
// around him (style.css `.Sky`), draws and flies the birds, sends the
// shooting stars, moves each layer up the window by less the farther back it
// is as the page scrolls (DEPTH), and answers a touch on the sun, the moon
// and the stars.
import type { ComponentChildren, JSX } from 'preact'

/** How far the line he sits on is above the bottom of his hooves, in his
 * units: far enough that the tip of his tail touches it. */
export const SINK = 8

/** The birds that cross the dusk now and then: how many in a flock at most,
 * the seconds between flocks, and how high they fly above the line. */
export const BIRDS = '7 35 70 170 260'

/** The seconds between the night's shooting stars. */
export const SHOOT = '20 45'

const FROM = -3000, TO = 3000

/** A seeded random number between 0 and 1 (mulberry32). */
export let rand = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

let n1 = (v: number) => (Math.round(v * 10) / 10).toString()

type Line = (x: number) => number

/** A rolling line: long swells and a pencil's small wander. `lean` sets him
 * halfway up the longest swell (1 with the ground rising to his right);
 * `pin` moves the line so it passes through `base` under him. */
export let roll = (
  { seed, base = 0, amp = 20, lens = [2300, 1300, 700], lean = 0, pin = false }:
    {
      seed: number
      base?: number
      amp?: number
      lens?: number[]
      lean?: number
      pin?: boolean
    },
): Line => {
  let r = rand(seed)
  let parts = lens.map((len, i) => ({
    len,
    a: amp / (1 + i * .9),
    ph: i > 0 || !lean ? r() * 2 * Math.PI : lean > 0 ? Math.PI : 0,
  }))
  for (let len of [173, 97, 61]) {
    parts.push({ len, a: .7 * (.4 + .6 * r()), ph: r() * 2 * Math.PI })
  }
  let f = (x: number) =>
    parts.reduce(
      (y, p) => y + p.a * Math.sin(2 * Math.PI * x / p.len + p.ph),
      0,
    )
  let off = pin ? f(0) : 0
  return (x) => base + f(x) - off
}

/** A smooth path through y(x), as cubic curves. */
export let line = (f: Line, step = 25) => {
  let ps: [number, number][] = []
  for (let x = FROM; x <= TO + .01; x += step) ps.push([x, f(x)])
  let d = `M${n1(ps[0][0])} ${n1(ps[0][1])}`
  for (let i = 0; i < ps.length - 1; i++) {
    let p0 = ps[i - 1] ?? ps[i],
      p1 = ps[i],
      p2 = ps[i + 1],
      p3 = ps[i + 2] ?? p2
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${
      n1(p1[1] + (p2[1] - p0[1]) / 6)
    } ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${
      n1(p2[0])
    } ${n1(p2[1])}`
  }
  return d
}

/** The same line closed down to `bottom`, for a fill. */
export let under = (f: Line, bottom: number) =>
  `${line(f)}L${TO} ${bottom}L${FROM} ${bottom}Z`

/** A long thin wisp of lit cloud. */
let wisp = (x: number, y: number, w: number, h: number, far = false) => (
  <path
    class={far ? 'Sky_Wisp Sky_Wisp-far' : 'Sky_Wisp'}
    d={`M${x - w / 2} ${y}Q${x - w / 6} ${y - h} ${x + w / 2} ${y - h * .2}Q${
      x + w / 8
    } ${y + h * .5} ${x - w / 2} ${y}Z`}
  />
)

/** The moon's lit shape, 24 across its middle, its terminator `edge` from
 * its middle: -24 is a new moon, 0 a half and 24 a full one. Every phase is
 * the same four curves, so one eases into the next. */
export let moon = (edge: number) => {
  let c = n1(edge * 4 / 3)
  return `M0 24C-32 24 -32 -24 0 -24C${c} -24 ${c} 24 0 24Z`
}

/** The phases a touch on the moon turns it through, as its terminator:
 * a crescent, a half, gibbous, full, and back. */
export const PHASES = [-10, 0, 12, 24, 12, 0]

/** Where each thing a touch answers stands, in his units. */
export const SUN = { x: 455, y: -100, r: 42 }
export const MOON = { x: 520, y: -188, r: 24 }

/** How far back each layer of the scene is: the share of the scroll it
 * sinks by (sky.js), so it goes up the window by the rest. The line he sits
 * on and the grass go up with the page; the hills a little less, the farther
 * the less, so they rise over the dusk sky and its sun; and the night sky
 * hardly moves at all. */
export const DEPTH = {
  night: .95,
  dusk: .5,
  Farthest: .15,
  Farther: .1,
  Near: .05,
}

// the line he sits on, and the three ranges of hills behind it
let G = roll({ seed: 13, amp: 10, lens: [2300, 1200, 700], lean: 1, pin: true })
export const HILLS = [
  ['Farthest', roll({ seed: 51, base: -104, amp: 26, lens: [1900, 900, 480] })],
  ['Farther', roll({ seed: 53, base: -62, amp: 22, lens: [1700, 820, 430] })],
  ['Near', roll({ seed: 57, base: -27, amp: 13, lens: [1500, 700] })],
] as const

let LANDSCAPE = [
  [
    'Farthest',
    roll({ seed: 51, base: -166, amp: 48, lens: [2300, 1200, 550] }),
  ],
  ['Farther', roll({ seed: 53, base: -106, amp: 37, lens: [1980, 960, 520] })],
  ['Near', roll({ seed: 57, base: -48, amp: 22, lens: [1720, 800] })],
] as const

let Sol = (
  { overHero, children }: { overHero?: boolean; children?: ComponentChildren },
) => (
  <>
    <circle
      class='Sky_Glow'
      fill='url(#Sky-glow)'
      cx={SUN.x}
      cy={overHero ? SUN.y : 0}
      r={overHero ? 84 : 230}
    />
    {children}
    <circle class='Sky_Sun' cx={SUN.x} cy={SUN.y} r={overHero ? 27 : SUN.r} />
  </>
)

let Drift = () => (
  <g class='Sky_Drift'>
    {wisp(-330, -214, 300, 11, true)}
    {wisp(250, -128, 330, 12)}
    {wisp(840, -186, 460, 15, true)}
    {wisp(1160, -112, 380, 11)}
    {wisp(-900, -150, 420, 13)}
  </g>
)

let Luna = () => (
  <>
    <circle
      class='Sky_Halo'
      fill='url(#Sky-halo)'
      cx={MOON.x}
      cy={MOON.y}
      r='80'
    />
    <g transform={`translate(${MOON.x} ${MOON.y}) rotate(-28)`}>
      <path class='Sky_Moon' d={moon(PHASES[0])} />
    </g>
  </>
)

let HillPaints = () => (
  <>
    {LANDSCAPE.map(([name]) => (
      <linearGradient id={`Sky-hill-${name}`} x2='0' y2='1'>
        <stop class={`Sky_${name}Top`} />
        <stop offset='1' class={`Sky_${name}Foot`} />
      </linearGradient>
    ))}
  </>
)

let Motes = () => (
  <div class='Sky_Day Sky_Motes'>
    {[[2, -18], [15, 8], [32, -27], [51, 6], [62, -13], [83, 14], [96, -8]]
      .map(([x, y], i) => (
        <span
          class='Sky_Mote'
          style={{
            '--x-at': `${x}%`,
            '--y-at': y,
            '--time': `${11 + i % 4 * 2}s`,
            '--lead': `-${n1(i * 2.6)}s`,
          }}
        />
      ))}
  </div>
)

// the night's stars, a few of them blinking, and its fireflies along the line
let night = () => {
  let r = rand(404)
  let stars: JSX.Element[] = [], flies: JSX.Element[] = []
  for (let i = 0; i < 230; i++) {
    let x = -900 + 3200 * r(), y = -660 + 600 * r()
    let s = .6 + 1.1 * r() * r(), o = .35 + .6 * r()
    let blink = i % 9 == 0
    stars.push(
      <circle
        class={blink ? 'Sky_Star Sky_Star-blink' : 'Sky_Star'}
        style={blink ? `animation-delay:-${n1(r() * 5)}s` : undefined}
        cx={n1(x)}
        cy={n1(y)}
        r={n1(s)}
        opacity={n1(o)}
      />,
    )
  }
  for (let i = 0; i < 9; i++) {
    let x = 90 + 1100 * r(), y = -46 + 50 * r()
    flies.push(
      <circle
        class='Sky_Fly'
        cx={n1(x)}
        cy={n1(y)}
        r='4.5'
        fill='url(#Sky-fly)'
        style={`animation-delay:-${n1(r() * 9)}s;animation-duration:${
          n1(7 + r() * 6)
        }s`}
      />,
    )
  }
  return { stars, flies }
}

/** What a page whose hero has the wandering yak carries in its head: his
 * walk (public/wander.js) and the sky he walks under (public/sky.js). Every
 * such page lays the `Sky` first in its body (frame.tsx `Page` `before`), so
 * each home page (variant.ts) wears the same hero. */
export let Walk = () => (
  <>
    <script src='wander.js' defer />
    <script src='sky.js' defer />
  </>
)

/** The sky, laid behind the page from its top to the pencil line under the
 * hero. It is drawing only, so a screen reader passes over it. */
export let Sky = ({ landscape = false }: { landscape?: boolean } = {}) => {
  let { stars, flies } = night()
  let ground = under(G, 240)
  let hills = landscape ? LANDSCAPE : HILLS
  return (
    <div
      class='Sky'
      data-landscape={landscape ? '' : undefined}
      aria-hidden='true'
      data-sink={SINK}
      data-birds={BIRDS}
      data-shoot={SHOOT}
      data-phases={PHASES.map(moon).join('|')}
    >
      <div class='Sky_Air' data-depth={DEPTH.dusk} />
      {landscape && <div class='Sky_SunSlot' data-sun-at='' />}
      <svg class='Sky_Far' viewBox='-3000 -800 6000 860' focusable='false'>
        <defs>
          {landscape && <HillPaints />}
          <radialGradient id='Sky-glow'>
            <stop offset='0' class='Sky_Glow0' />
            <stop offset='.35' class='Sky_Glow1' />
            <stop offset='1' class='Sky_Glow2' />
          </radialGradient>
          <radialGradient id='Sky-halo'>
            <stop offset='0' class='Sky_Halo0' />
            <stop offset='1' class='Sky_Halo1' />
          </radialGradient>
          <linearGradient id='Sky-tail'>
            <stop offset='0' class='Sky_Tail0' />
            <stop offset='1' class='Sky_Tail1' />
          </linearGradient>
          <radialGradient id='Sky-fly'>
            <stop offset='0' class='Sky_Fly0' />
            <stop offset='.3' class='Sky_Fly1' />
            <stop offset='1' class='Sky_Fly2' />
          </radialGradient>
        </defs>
        <g class='Sky_Day' data-depth={DEPTH.dusk}>
          {landscape ? <Drift /> : (
            <Sol>
              <Drift />
            </Sol>
          )}
        </g>
        {landscape && (
          <g class='Sky_Day Sky_Sol'>
            <Sol overHero />
          </g>
        )}
        <g class='Sky_Night Sky_Deep' data-depth={DEPTH.night}>
          <g class='Sky_Stars'>{stars}</g>
          {!landscape && <Luna />}
        </g>
        {landscape && (
          <g class='Sky_Night Sky_Luna'>
            <Luna />
          </g>
        )}
        <g class='Sky_Hills'>
          {hills.map(([name, f]) => (
            <path
              class={`Sky_${name}`}
              data-depth={DEPTH[name]}
              style={landscape ? { fill: `url(#Sky-hill-${name})` } : undefined}
              d={under(f, 60)}
            />
          ))}
        </g>
        <g class='Sky_Night'>{flies}</g>
        <g class='Sky_Day Sky_Birds' />
      </svg>
      <div class='Sky_Grass'>
        <svg class='Sky_Turf' viewBox='-3000 -60 6000 300' focusable='false'>
          <defs>
            <linearGradient
              id='Sky-turf'
              gradientUnits='userSpaceOnUse'
              x1='0'
              y1='-10'
              x2='0'
              y2={landscape ? 80 : 190}
            >
              <stop offset='0' class='Sky_Turf0' />
              <stop offset='1' class='Sky_Turf1' />
            </linearGradient>
          </defs>
          <path class='Sky_Base' d={ground} />
          <path class='Sky_Ground' fill='url(#Sky-turf)' d={ground} />
          <path class='Sky_Line' d={line(G)} />
        </svg>
      </div>
      {landscape && <Motes />}
    </div>
  )
}
