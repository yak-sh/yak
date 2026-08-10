import { type JSX } from 'preact'

// The icon library: hand-vendored Lucide glyphs (lucide.dev, ISC), 24×24
// stroke paths recolored by currentColor. Small and curated on purpose —
// adding an icon is adding a row here, not adding a dependency.
let glyphs: Record<string, JSX.Element> = {
  'alarm-clock': (
    <>
      <circle cx='12' cy='13' r='8' />
      <path d='M12 9v4l2 2' />
      <path d='M5 3 2 6' />
      <path d='m22 6-3-3' />
      <path d='M6.38 18.7 4 21' />
      <path d='M17.64 18.67 20 21' />
    </>
  ),
  'square-check': (
    <>
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <path d='m9 12 2 2 4-4' />
    </>
  ),
  lightbulb: (
    <>
      <path d='M9 18h6' />
      <path d='M10 22h4' />
      <path d='M15.09 14c.18-.57.66-1 1.14-1.5A6 6 0 1 0 7.77 12.5c.48.5.96.93 1.14 1.5' />
    </>
  ),
  stamp: (
    <>
      <path d='M5 22h14' />
      <path d='M19.27 13.73 17.5 12a2.5 2.5 0 0 1-.7-1.94V7a4 4 0 0 0-8 0v3.06A2.5 2.5 0 0 1 8.1 12l-1.77 1.73A2 2 0 0 0 5.73 17h12.54a2 2 0 0 0 1-3.27Z' />
    </>
  ),
  inbox: (
    <>
      <path d='M22 12h-6l-2 3h-4l-2-3H2' />
      <path d='M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' />
    </>
  ),
  table: (
    <>
      <path d='M12 3v18' />
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <path d='M3 9h18' />
      <path d='M3 15h18' />
    </>
  ),
  map: (
    <>
      <path d='M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z' />
      <path d='M15 5.764v15' />
      <path d='M9 3.236v15' />
    </>
  ),
  list: (
    <>
      <path d='M3 12h.01' />
      <path d='M3 18h.01' />
      <path d='M3 6h.01' />
      <path d='M8 12h13' />
      <path d='M8 18h13' />
      <path d='M8 6h13' />
    </>
  ),
  'layout-dashboard': (
    <>
      <rect width='7' height='9' x='3' y='3' rx='1' />
      <rect width='7' height='5' x='14' y='3' rx='1' />
      <rect width='7' height='9' x='14' y='12' rx='1' />
      <rect width='7' height='5' x='3' y='16' rx='1' />
    </>
  ),
  'columns-3': (
    <>
      <rect width='18' height='18' x='3' y='3' rx='2' />
      <path d='M9 3v18' />
      <path d='M15 3v18' />
    </>
  ),
  kanban: (
    <>
      <path d='M6 5v11' />
      <path d='M12 5v6' />
      <path d='M18 5v14' />
    </>
  ),
  'file-text': (
    <>
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M10 9H8' />
      <path d='M16 13H8' />
      <path d='M16 17H8' />
    </>
  ),
  globe: (
    <>
      <circle cx='12' cy='12' r='10' />
      <path d='M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' />
      <path d='M2 12h20' />
    </>
  ),
  hash: (
    <>
      <line x1='4' x2='20' y1='9' y2='9' />
      <line x1='4' x2='20' y1='15' y2='15' />
      <line x1='10' x2='8' y1='3' y2='21' />
      <line x1='16' x2='14' y1='3' y2='21' />
    </>
  ),
  braces: (
    <>
      <path d='M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1' />
      <path d='M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1' />
    </>
  ),
  bug: (
    <>
      <path d='m8 2 1.88 1.88' />
      <path d='M14.12 3.88 16 2' />
      <path d='M9 7.13v-1a3.003 3.003 0 1 1 6 0v1' />
      <path d='M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6' />
      <path d='M12 20v-9' />
      <path d='M6.53 9C4.6 8.8 3 7.1 3 5' />
      <path d='M6 13H2' />
      <path d='M3 21c0-2.1 1.7-3.8 3.8-4' />
      <path d='M20.97 5c0 2.1-1.6 3.8-3.5 4' />
      <path d='M22 13h-4' />
      <path d='M17.2 17c2.1.2 3.8 1.9 3.8 4' />
    </>
  ),
  drama: (
    <>
      <path d='M10 11h.01' />
      <path d='M14 6h.01' />
      <path d='M18 6h.01' />
      <path d='M6.5 13.1h.01' />
      <path d='M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3' />
      <path d='M17.4 9.9c-.8.8-2 .8-2.8 0' />
      <path d='M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7' />
      <path d='M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4' />
    </>
  ),
  search: (
    <>
      <circle cx='11' cy='11' r='8' />
      <path d='m21 21-4.3-4.3' />
    </>
  ),
  shapes: (
    <>
      <path d='M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z' />
      <rect x='3' y='14' width='7' height='7' rx='1' />
      <circle cx='17.5' cy='17.5' r='3.5' />
    </>
  ),
  'ellipsis-vertical': (
    <>
      <circle cx='12' cy='12' r='1' />
      <circle cx='12' cy='5' r='1' />
      <circle cx='12' cy='19' r='1' />
    </>
  ),
  bot: (
    <>
      <path d='M12 8V4H8' />
      <rect width='16' height='12' x='4' y='8' rx='2' />
      <path d='M2 14h2' />
      <path d='M20 14h2' />
      <path d='M15 13v2' />
      <path d='M9 13v2' />
    </>
  ),
}

export let Icon = (
  { name, size = 14 }: { name: string; size?: number },
) => (
  <svg
    class='Icon'
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    stroke-width='2'
    stroke-linecap='round'
    stroke-linejoin='round'
    aria-hidden='true'
  >
    {glyphs[name] ?? glyphs['file-text']}
  </svg>
)
