;; The source of add.wasm beside it — 41 bytes, the smallest thing that is
;; honestly a compiled module: one function, two i32 in, one i32 out.
;;
;; It stands for a worker compiled from Rust or Go: what matters to the
;; platform is not what the module computes but that its bytes travel as a
;; module part of type application/wasm and come back out of the runtime as a
;; WebAssembly.Module the app's worker.js instantiates (dispatch.ts, T-34263).
;;
;; The bytes are checked in rather than built, because wat2wasm is not on the
;; box and 41 bytes of a stable format is not a build step. To rebuild:
;;   wat2wasm workers/yak/fixtures/add.wat -o workers/yak/fixtures/add.wasm
(module
  (func $add (param i32 i32) (result i32)
    local.get 0
    local.get 1
    i32.add)
  (export "add" (func $add)))
