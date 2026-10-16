// JSON at the graph's doors. Bytes are tagged on output, but a tag only has
// meaning in a declared binary property on input: JSON objects everywhere
// else (including an object with these exact keys) keep their old meaning.
import type { Vocab } from './vocab.ts'
import { isBinary } from './vocab.ts'

/** JSON for a bundle or frame, preserving Uint8Array values as base64 tags. */
export let stringify = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => {
    if (!(v instanceof Uint8Array)) return v
    let text = ''
    for (let at = 0; at < v.length; at += 8192) {
      text += String.fromCharCode(...v.subarray(at, at + 8192))
    }
    return { $bytes: btoa(text), encoding: 'base64' }
  })

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v) &&
  !(v instanceof Uint8Array)

let invalid = (message: string): never => {
  let error = new Error(message)
  error.name = 'Refused'
  throw error
}

/** Media type for a length-prefixed JSON header followed by raw byte values. */
export let BINARY = 'application/vnd.yaks.bundle+binary'

/** Encode a bundle or subscription packet with raw Uint8Array payloads.
 * Offsets are relative to the payload after the JSON header. */
export let binary = (value: unknown): Uint8Array<ArrayBuffer> => {
  let chunks: Uint8Array[] = [], length = 0
  let header = new TextEncoder().encode(JSON.stringify(value, (_key, v) => {
    if (!(v instanceof Uint8Array)) return v
    let offset = length
    chunks.push(v)
    length += v.byteLength
    return { $bytes: offset, length: v.byteLength }
  }))
  let out = new Uint8Array(4 + header.length + length)
  new DataView(out.buffer).setUint32(0, header.length)
  out.set(header, 4)
  let at = 4 + header.length
  for (let chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** Read a binary envelope without interpreting its JSON. The vocabulary-aware
 * decode is what gives references meaning only in binary properties. */
export let unpack = (
  data: ArrayBuffer | Uint8Array,
): { value: unknown; payload: Uint8Array } => {
  let raw = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (raw.length < 4) {
    return invalid('binary envelope needs a 4-byte header length')
  }
  let size = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(
    0,
  )
  if (size > raw.length - 4) {
    return invalid('binary envelope header exceeds body')
  }
  let value: unknown
  try {
    value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        raw.subarray(4, 4 + size),
      ),
    )
  } catch {
    return invalid('binary envelope needs a UTF-8 JSON header')
  }
  return { value, payload: raw.subarray(4 + size) }
}

let bytes = (value: unknown, payload?: Uint8Array): unknown => {
  if (payload && object(value) && typeof value.$bytes == 'number') {
    let offset = value.$bytes, length = value.length
    if (
      Object.keys(value).length != 2 || !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof length != 'number' || !Number.isSafeInteger(length) ||
      length < 0 ||
      offset > payload.length || length > payload.length - offset
    ) {
      return invalid(
        'binary property reference exceeds payload or has invalid bounds',
      )
    }
    return payload.slice(offset, offset + length)
  }
  if (value == null || value instanceof Uint8Array) return value
  let data: string
  let encoding: string
  if (typeof value == 'string') {
    data = value
    encoding = 'base64'
  } else if (
    object(value) && Object.keys(value).length == 2 &&
    typeof value.$bytes == 'string' && typeof value.encoding == 'string'
  ) {
    data = value.$bytes
    encoding = value.encoding
  } else return value // Admission reports the property's type mismatch.
  if (encoding == 'hex' && /^(?:[0-9a-fA-F]{2})*$/.test(data)) {
    return Uint8Array.from(
      data.match(/../g) ?? [],
      (pair) => parseInt(pair, 16),
    )
  }
  if (
    encoding == 'base64' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|)$/
      .test(data)
  ) {
    let text = atob(data)
    if (btoa(text).replace(/=+$/, '') == data.replace(/=+$/, '')) {
      return Uint8Array.from(text, (c) => c.charCodeAt(0))
    }
  }
  return invalid(`invalid ${encoding} binary value`)
}

/** Decode JSON bundles and existing subscription envelopes using their
 * vocabulary. Only binary properties are interpreted; arbitrary JSON values,
 * bundle guards, and unknown envelope fields are not traversed. */
export let decode = <T>(
  vocab: Pick<Vocab, 'def'>,
  value: T,
  payload?: Uint8Array,
): T => {
  let bundle = (v: unknown): unknown => {
    if (!object(v)) return v
    let out = { ...v }
    for (let [comp, row] of Object.entries(v)) {
      if (comp.startsWith('$') || !object(row)) continue
      let props = vocab.def(comp)?.properties
      if (!props) continue
      let next = { ...row }
      for (let [prop, val] of Object.entries(row)) {
        if (props[prop] && isBinary(props[prop])) {
          next[prop] = bytes(val, payload)
        }
      }
      out[comp] = next
    }
    return out
  }
  let packet = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(bundle)
    if (!object(v)) return v
    if (object(v.entity) && typeof v.entity.eid == 'string') return bundle(v)
    let out = { ...v }
    for (let key of ['bundles', 'entities', 'peers', 'relay']) {
      if (Array.isArray(v[key])) out[key] = v[key].map(bundle)
    }
    if (Array.isArray(v.frames)) out.frames = v.frames.map(packet)
    return out
  }
  return packet(value) as T
}
