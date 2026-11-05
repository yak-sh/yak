// Lucide ships types for its barrel but omits its individual icon modules.
declare module 'lucide/dist/esm/icons/*.mjs' {
  let nodes: import('lucide').IconNode
  export default nodes
}
