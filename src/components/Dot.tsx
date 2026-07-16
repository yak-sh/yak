// A status pip. The colour rides the modifier class (`.Dot-wip`, …), which
// just re-points the `--dot` custom property — structure stays put.
export let Dot = ({ status }: { status: string }) => (
  <span class={`Dot Dot-${status}`} />
)
