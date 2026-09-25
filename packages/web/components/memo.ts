// A Preact render boundary: shallow-equal props sleep, owned signals wake it.
import { createElement, type FunctionComponent } from 'preact'

let differs = (a: object, b: object) => {
  for (let k in a) {
    if (!(k in b) || a[k as keyof typeof a] !== b[k as keyof typeof b]) {
      return true
    }
  }
  for (let k in b) if (!(k in a)) return true
  return false
}

// Preact's functional component instance honors shouldComponentUpdate.
// Signal invalidation marks that instance dirty and deliberately bypasses
// the prop comparison, so a row patch still enters its Entity boundary.
export let memo = <P extends object>(
  face: FunctionComponent<P>,
): FunctionComponent<P> => {
  function Memoed(this: {
    props: P
    shouldComponentUpdate?: (next: P) => boolean
  }, props: P) {
    this.shouldComponentUpdate = (next) => differs(this.props, next)
    return createElement(face, props)
  }
  return Memoed as unknown as FunctionComponent<P>
}
