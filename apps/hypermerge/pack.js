// A block's bytes: its change as canonical JSON, keys sorted at every depth,
// so a change hashes and signs alike in every tab whatever order the store
// hands its keys back in.

/// text({ b: 1, a: [{ d: 1, c: 2 }], z: undefined }) -> '{"a":[{"c":2,"d":1}],"b":1}'
export let text = (v) =>
  Array.isArray(v)
    ? `[${v.map(text).join(',')}]`
    : v && typeof v == 'object'
    ? `{${
      Object.keys(v).sort().filter((k) => v[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${text(v[k])}`).join(',')
    }}`
    : JSON.stringify(v)

export let bytes = (change) => new TextEncoder().encode(text(change))

/// hex(Uint8Array.of(0, 15, 255)) -> '000fff'
export let hex = (b) =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/// unhex('000fff') -> Uint8Array.of(0, 15, 255)
export let unhex = (s) =>
  Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))

/** The SHA-256 of some bytes, in hex: a block's eid. */
export let sha256 = async (b) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
