/**
 * The stylesheet a drawing is meant to wear: thin strokes, small mono text,
 * and a pen. Without {@link ink} each new shape and line is drawn in, one
 * after another, as it joins; with it the page says how far each is drawn,
 * and the stroke under the pen glows. Every colour is a custom property a
 * page sets on the drawing or above it:
 *
 * - `--diagram-line` strokes and text (default: currentColor)
 * - `--diagram-soft` names, components and reference lines
 * - `--diagram-fill` a shape's inside (default: Canvas)
 * - `--diagram-paper` what the drawing is on, behind a line's name
 *   (default: Canvas)
 * - `--diagram-glow` the pen, the stroke it draws, a done mark and a shape
 *   in focus
 * - `--diagram-font` the text's font family
 * - `--diagram-pen` how long one stroke takes without ink() (default 0.5s)
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
  --_paper: var(--diagram-paper, Canvas);
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
.Diagram_Line { stroke-width: 1.4; }
.Diagram_Link-ref .Diagram_Line { stroke: var(--_soft); stroke-width: .9; opacity: .8; }
.Diagram_Head { fill: var(--_line); }
.Diagram_Head-ref { fill: var(--_soft); }
.Diagram_Dia { fill: var(--_paper); stroke: var(--_line); stroke-width: 1.1; }
.Diagram text { fill: var(--_line); font-size: 10.5px; }
.Diagram_Id { font-weight: 500; }
.Diagram_Node-round .Diagram_Id, .Diagram_Node-hex .Diagram_Id { font-size: 11px; }
.Diagram_Title { font-size: 12.5px; }
.Diagram_Comps, .Diagram_State { fill: var(--_soft); font-size: 9px; }
.Diagram_Name, .Diagram_Sub {
  fill: var(--_soft);
  font-size: 8.5px;
  paint-order: stroke;
  stroke: var(--_paper);
  stroke-width: 3px;
  stroke-linejoin: round;
}
.Diagram_Link-edge .Diagram_Name { fill: var(--_line); font-size: 10px; }
.Diagram_Mark { fill: var(--_paper); stroke: var(--_line); stroke-width: 1; }
.is-done .Diagram_Mark { fill: var(--_glow); stroke: var(--_glow); }
.Diagram_Node { cursor: pointer; outline: none; }
.Diagram_Node:hover .Diagram_Stroke, .Diagram_Node:focus-visible .Diagram_Stroke {
  stroke: var(--_glow);
  stroke-width: 1.6;
}
.Diagram_Pen { pointer-events: none; transition: opacity .3s; }
.Diagram_Halo { fill: color-mix(in srgb, var(--_glow) 25%, transparent); stroke: var(--_glow); stroke-width: .8; }
.Diagram_Hair { stroke: var(--_glow); stroke-width: .8; }
.Diagram_Tip { fill: var(--_glow); }

.Diagram:not(.is-inked) .is-new .Diagram_Stroke,
.Diagram:not(.is-inked) .is-new .Diagram_Line {
  animation: diagram-pen var(--_pen) ease-out calc(var(--i, 0) * var(--_pen) * .6) backwards;
}
.Diagram:not(.is-inked) .is-new text {
  animation: diagram-ink var(--_pen) ease-out calc((var(--i, 0) * .6 + .7) * var(--_pen)) backwards;
}
@keyframes diagram-pen {
  from { stroke-dashoffset: 1; stroke: var(--_glow); }
  70% { stroke: var(--_glow); }
}
@keyframes diagram-ink { from { opacity: 0; } }

.is-inked .is-gone { display: none; }
.is-inked .Diagram_Fill, .is-inked text, .is-inked .Diagram_Dia, .is-inked .Diagram_Mark {
  transition: opacity .35s;
}
.is-inked :not(.is-drawn) > .Diagram_Fill,
.is-inked :not(.is-drawn) > text,
.is-inked :not(.is-drawn) > .Diagram_Dia,
.is-inked :not(.is-drawn) > .Diagram_Mark { opacity: 0; }
.is-inked :not(.is-drawn) > .Diagram_Line { marker-end: none; }
.is-inked .is-drawing > .Diagram_Stroke, .is-inked .is-drawing > .Diagram_Line {
  stroke: var(--_glow);
  stroke-width: 1.6;
}
.is-zoomed > .Diagram { cursor: grab; }
.is-zoomed > .Diagram:active { cursor: grabbing; }
@media (prefers-reduced-motion: reduce) {
  .is-new .Diagram_Stroke, .is-new .Diagram_Line, .is-new text { animation: none; }
  .is-inked .Diagram_Fill, .is-inked text { transition: none; }
}
`
