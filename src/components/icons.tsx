import { type JSX } from 'preact'

// The icon library: hand-vendored Lucide glyphs (lucide.dev, ISC), 24×24
// stroke paths recolored by currentColor. Small and curated on purpose —
// adding an icon is adding a row here, not adding a dependency.
let glyphs: Record<string, JSX.Element> = {
  'square-check': (
    <>
      <rect x='3' y='3' width='18' height='18' rx='2' />
      <path d='m9 12 2 2 4-4' />
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
