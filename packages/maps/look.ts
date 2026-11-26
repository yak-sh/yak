// How a map looks around its canvas: the few of MapLibre's own rules a map
// drawn here needs (it draws no controls; maplibre-gl.css is 70 KB of them),
// the pin and its label, the credits behind their ⓘ, and the links under the
// map. Every colour and the type are the theme's own custom properties, so a
// map's frame wears the app's look.

/** The maps stylesheet, as text a page puts in a `<style>` once. */
export let LOOK: string = `
.maplibregl-map{overflow:hidden;position:relative;-webkit-tap-highlight-color:transparent}
.maplibregl-canvas{left:0;position:absolute;top:0}
.maplibregl-canvas-container.maplibregl-interactive{cursor:grab}
.maplibregl-canvas-container.maplibregl-touch-drag-pan.maplibregl-cooperative-gestures,
.maplibregl-canvas-container.maplibregl-touch-drag-pan.maplibregl-cooperative-gestures .maplibregl-canvas{touch-action:pan-x pan-y}
.maplibregl-marker{left:0;position:absolute;top:0;will-change:transform}
.maplibregl-cooperative-gesture-screen{align-items:center;background:rgb(0 0 0/.4);color:#fff;display:flex;font:inherit;inset:0;justify-content:center;opacity:0;padding:1rem;pointer-events:none;position:absolute;text-align:center;transition:opacity 1s ease 1s;z-index:2}
.maplibregl-cooperative-gesture-screen.maplibregl-show{opacity:1;transition:opacity .05s}
.maplibregl-cooperative-gesture-screen .maplibregl-mobile-message{display:none}
@media (hover:none),(pointer:coarse){
  .maplibregl-cooperative-gesture-screen .maplibregl-desktop-message{display:none}
  .maplibregl-cooperative-gesture-screen .maplibregl-mobile-message{display:block}
}
.MapFrame{display:grid;gap:calc(var(--gap,16px)/2);margin:0}
.MapView{aspect-ratio:var(--map-ratio,16/10);width:100%;border:1px solid var(--border,#cfc5b3);border-radius:var(--radius,8px);background:var(--bg,#f6f1e7);overflow:hidden}
.MapBox{position:relative}
.MapCredit{position:absolute;right:6px;bottom:6px;z-index:2;display:flex;flex-direction:row-reverse;align-items:center;max-width:calc(100% - 12px);border-radius:12px;background:var(--bg,#fff);color:var(--muted,#6f665a);font-family:var(--font,inherit);font-size:var(--small,13px);line-height:1.3;box-shadow:0 1px 2px rgb(0 0 0/.2)}
.MapCredit summary{display:grid;place-items:center;flex:none;box-sizing:border-box;width:24px;height:24px;padding:0;border-radius:50%;list-style:none;cursor:pointer;-webkit-tap-highlight-color:transparent;color:var(--text,#2b2620);line-height:0}
.MapCredit summary svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.MapCredit summary::-webkit-details-marker{display:none}
.MapCredit summary:focus-visible{outline:2px solid var(--accent,#c2562f);outline-offset:1px}
.MapCredit_Name{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.MapCredit[open]{gap:.25em;padding-left:.6em}
.MapCredit a{color:inherit}
.MapFrame figcaption{display:flex;flex-wrap:wrap;gap:.25em 1em;justify-content:flex-end;color:var(--muted,#6f665a);font-family:var(--font,inherit);font-size:var(--small,13px)}
.MapFrame figcaption a{color:inherit}
.MapPin{display:grid;justify-items:center;pointer-events:none}
.MapPin svg{width:24px;height:32px;filter:drop-shadow(0 1px 1px rgb(0 0 0/.3))}
.MapPin path{fill:var(--accent,#c2562f)}
.MapPin circle{fill:var(--bg,#fff)}
.MapPin_Label{order:-1;margin-bottom:2px;padding:1px 6px;border-radius:4px;background:var(--bg,#fff);color:var(--text,#2b2620);font-family:var(--font,inherit);font-size:var(--small,13px);font-weight:600;white-space:nowrap;box-shadow:0 1px 2px rgb(0 0 0/.2)}
`
