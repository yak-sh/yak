/**
 * The stylesheet a drawing is meant to wear: thin strokes, small mono text,
 * and a pen that draws each new box and line in, one after another. Every
 * colour is a custom property a page sets on the drawing or above it:
 *
 * - `--diagram-line` strokes and text (default: currentColor)
 * - `--diagram-soft` names, components and reference lines
 * - `--diagram-fill` a box's inside (default: Canvas)
 * - `--diagram-glow` the pen while it draws, and a box in focus
 * - `--diagram-font` the text's font family
 * - `--diagram-pen` how long one stroke takes (default 0.5s)
 *
 * ```ts
 * import { css } from '@yaks/diagram'
 * import { assert } from '@std/assert'
 *
 * assert(css.includes('.Diagram_Node'))
 * ```
 */
export const css = `
.Diagram {
  --_line: var(--diagram-line, currentColor);
  --_soft: var(--diagram-soft, color-mix(in srgb, var(--_line) 60%, transparent));
  --_glow: var(--diagram-glow, var(--_line));
  --_pen: var(--diagram-pen, .5s);
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  font-family: var(--diagram-font, ui-monospace, monospace);
}
.Diagram_Fill { fill: var(--diagram-fill, Canvas); }
.Diagram_Stroke, .Diagram_Line {
  fill: none;
  stroke: var(--_line);
  stroke-width: 1.15;
  stroke-linejoin: round;
  stroke-dasharray: 1 1;
  stroke-dashoffset: 0;
}
.Diagram_Link-ref .Diagram_Line { stroke: var(--_soft); stroke-width: .9; }
.Diagram text { fill: var(--_line); font-size: 10px; }
.Diagram_Title { font-size: 12.5px; }
.Diagram_Comps, .Diagram_Name { fill: var(--_soft); font-size: 8.5px; }
.Diagram_Name { text-anchor: middle; }
.Diagram_Node { cursor: pointer; outline: none; }
.Diagram_Node:hover .Diagram_Stroke, .Diagram_Node:focus-visible .Diagram_Stroke {
  stroke: var(--_glow);
  stroke-width: 1.6;
}
.is-new .Diagram_Stroke, .is-new .Diagram_Line {
  animation: diagram-pen var(--_pen) ease-out calc(var(--i, 0) * var(--_pen) * .6) backwards;
}
.is-new text {
  animation: diagram-ink var(--_pen) ease-out calc((var(--i, 0) * .6 + .7) * var(--_pen)) backwards;
}
@keyframes diagram-pen {
  from { stroke-dashoffset: 1; stroke: var(--_glow); }
  70% { stroke: var(--_glow); }
}
@keyframes diagram-ink { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .is-new .Diagram_Stroke, .is-new .Diagram_Line, .is-new text { animation: none; }
}
`
