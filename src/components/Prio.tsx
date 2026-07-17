import { el } from './ui.tsx'

let Badge = el('span', 'Prio')

// The priority badge: P0 burns, P1 glows, P2 is the quiet default, P3+
// fades. The label shows the TRUE value (fractional board-order values
// like 1.5 included); only the colour tier is clamped to 0–3. Like the
// Dot, the badge is paint — a host that wants a control hangs it on here.
export let Prio = ({ p, ...rest }: { p: number; [x: string]: unknown }) => (
  <Badge mod={String(Math.min(Math.max(Math.round(p), 0), 3))} {...rest}>
    P{p}
  </Badge>
)
