# Signed directory

T-125570's signed-directory implementation lets signed requests use an
independent serving copy when directory reads stall, without treating a copied
body as current permission. This describes the working implementation, not a
production-readiness verdict. The workerd regression and security/socket checks
remain under investigation; the local measurements below do not resolve them.

## Authority and admission

The **serving copy** is the independent `ServingCopy` Durable Object selected by
`copyOf(env)` under the shared name `public`, for both public and signed paths.
It persists one snapshot containing a revision, a blocked flag and query bodies.
The directory itself remains the write authority: the serving copy stores
answers and controls admission, not directory mutations or permission decisions.

A **revision** is the global fence number associated with a committed directory
mutation. Before mutation, `fenced` awaits `begin()`, which advances the
revision, blocks serving and clears every copied answer durably. The directory
commits its `directory-revision` with the mutation, refusing an older fence and
retrying with a fresh fence. Only matching `finish(revision)` unblocks serving.
A failed begin prevents the write; rollback does not reopen the copy.

Invalidation is global, not per person, app or query. Even an unrelated
directory write clears warm answers. Cold, fenced and evicted queries wait for
the directory; the fallback deadline is not a response-time guarantee. A blocked
copy stays blocked across restart. Lost-finish recovery requires a directory
read carrying exactly the copy's matching **committed** epoch: `publish` may
finish that epoch, but an older/precommit response cannot reopen a newer fence.
If no matching epoch committed, another successful fenced write is needed.

Revocation applies at admission. A successful validity check is not a lease for
later requests, but a subsequent fence does not abort work already admitted.
This does not establish that existing sockets or all security-sensitive doors
are safe; those checks remain separate.

## Request path

`directory-copy.ts` implements `signedDirectory` as a request-scoped transport.
Apps, MCP and Store directory lookups install it; it must not be shared across
requests. Without `SERVING_COPY`, it returns the original Fetcher.

Each signed GET starts the real directory request and a fallback deadline shared
by the transport: 25 ms from its creation, not another 25 ms per lookup. The
`x-yak-directory-revision` request header bypasses the directory part's TTL
cache. The directory Store captures its committed epoch beside the query, before
yielding, and returns it with the response. Within one request a question is
asked once, until the request writes to the directory (hops.ts `recall`), and
the answer keeps the revision it was read at.

| Successful path                        | Directory work                                      | Serving-copy RPCs before answering |
| -------------------------------------- | --------------------------------------------------- | ---------------------------------- |
| Direct signed query                    | One directory fetch and body read                   | None; `publish` follows the answer |
| Copied signed query                    | Directory fetch still starts; it may remain pending | `read` then `valid`                |
| App Store request with policy metadata | None, unless older than the Store's floor           | None                               |

The directory is the authority, and its answer stands as read. A write it has
fenced but not yet committed is one that read came before. The copy is filled
behind the answer, in the request's background work: it takes a body of its own
revision and no other, a body of its committed revision lowers a fence whose
finish was lost, and a body it refuses while still fenced asks the directory to
mend. A copy miss does not turn a slow directory request into a 503.

Fallback reads return both body and epoch, then validate independently, catching
a fence between read and acceptance: a copied body is never an unchecked
authorization grant.

The app Store takes the kernel's `x-yak-policy` at its word. It keeps a local
policy floor: a request read at an older revision than one the Store already
acted on is read again from the directory, so what the Store holds never goes
back in time. Directory-derived policy metadata is carried through the ordinary
directory/Store doors; possessing a copied body alone does not confer standing.

Until T-132705 a direct answer also waited for `publish` and `valid`, and every
Store request asked the copy `valid` and reread the directory whenever any
directory write had moved the revision since the kernel read it. Measured live
on jeff.yaks.app/housebook, those copy calls cost more than the directory reads
they checked, on every signed request, and closed only the milliseconds between
the kernel's read and the Store's.

## Persistence and body bounds

Warm `read` and `valid` use memory only. An equal-body `publish` at the current,
unblocked revision returns without persisting: `finish` is already satisfied and
`put` detects the existing body before copying the map. A changed accepted body
persists a replacement snapshot. The Durable Object adapter stores the snapshot
in its own SQLite `copy` row, independent of the directory Store.

Bounds count JavaScript UTF-16 code units, including keys: 64 Ki per key/body
pair, 512 Ki across retained pairs, and at most 1000 answers (a smaller
configured limit is allowed). Eviction follows insertion order, not read
frequency. The aggregate string bound implies at most 2 MiB of UTF-8 payload,
not a bound on serialized JSON or heap overhead. Oversized answers remain
directory-only; publication can decline to retain a body without invalidating a
matching direct answer.

## Local warm cost

The scratch benchmark used the actual `signedDirectory` and `ServingCopy` in one
Deno process, with an immediate fake directory Fetcher and asynchronous
RPC-shaped methods forwarding to the core. Persistence callbacks counted reads
and writes; the write callback cloned the snapshot. The fixture used
`.app.slug=cookbook` (18 code units) and a 122-byte ASCII JSON app body with
epoch zero.

One signed query primed the copy, followed by 300 untimed queries of each path.
Each of three rounds measured 3000 sequential queries per path with
`performance.now()`, alternating order (plain/signed, signed/plain,
plain/signed). Every query constructed a Request, consumed the response body and
asserted its contents; the signed case constructed a fresh transport. The
direct-path timer registered/cancelled no-op callbacks and never fired. Thus the
timing excludes real timer scheduling, the 25 ms fallback wait and RPC
transport.

Environment: Deno 2.9.1, V8 14.9.207.2-rusty, Linux x86-64, Intel Core i7-8700K
3.70 GHz, shared local machine; no CPU isolation.

| Round | Plain total, ms | Plain, µs/query | Signed total, ms | Signed, µs/query |
| ----- | --------------: | --------------: | ---------------: | ---------------: |
| 1     |          54.290 |          18.097 |          148.574 |           49.525 |
| 2     |          50.580 |          16.860 |          159.685 |           53.228 |
| 3     |          32.751 |          10.917 |          140.200 |           46.733 |

The difference between medians is 32.665 µs/query. This is local wrapper and
in-process call cost, **not production latency**, network/RPC latency, billed
CPU, a percentile distribution or a workerd result. Plain uses no real directory
SQL either. No latency conclusion follows for fallback or an entire signed
request.

Assertions confirmed:

- Each 3000-query plain sample: 3000 directory calls, no copy calls.
- Each 3000-query signed sample: 3000 directory calls, 3000 `publish`, 3000
  `valid`, no `read`; zero additional persistence reads or writes.
- After the priming publication, 100 repetitions of equal-body `publish`,
  `valid` and `read` left persistence counts unchanged at one read and one write
  total.
- A deterministically triggered fallback against a never-resolving Fetcher: one
  directory attempt, one `read`, one `valid`, no publication or persistence
  work. This checked counts only, without sleeping or timing fallback latency.

The script and logs lived only in a unique `/tmp/T-125570-warm/docs.ZsEte2RB`
scratch directory, removed after recording results. No production or test source
was edited for the measurement.

## Verification and source

The focused Deno run passed 96 tests, including equal-publication persistence,
equal-request Store RPC counts, fences, signed Apps/MCP and lost-finish
recovery:

```sh
deno task test --tag=deno \
  workers/yak/serving-copy_test.ts workers/yak/directory-fence_test.ts \
  workers/yak/directory-signed_test.ts workers/yak/graph_test.ts
```

This is in-process evidence, not workerd or socket validation. The owning code
is `workers/yak/directory-copy.ts`, `serving-copy.ts`, the Durable Object
adapter in `index.ts`, and the directory/Store paths in `directory.ts` and
`graph.ts`. The surrounding package documentation is `workers/yak/README.md`,
especially “Store composition”.

## Authorization operations during tools

A tool invocation owns its directory view. A committed directory write does not
renew that view or its captured Store doors. `reacquire` opens a provisional
view and reads the space, the app and the caller's current membership by stable
identity in one directory round trip (directory.ts `target`), then the caller's
administrative standing. Only after every check succeeds does it return the new
metadata, Who and Store door together. Removal, downgrade, trash and credential
narrowing still refuse the operation. Names are never resolved a second time to
choose a replacement target.

Deployment checkpoints retain the release/fence compare-and-set conditions. The
protected continuation runs with newly acquired metadata, not by mutating old
doors or relaxing the Store floor. Read-only provisional acquisition may restart
if overtaken by another commit; tool execution, compilation and writes are never
replayed to repair authorization. Post-tool private news acquires its own
current standing, so a tool that removes its own membership still reports its
result without leaking unseen details.

For anonymous rendering, a versioned directory response may carry its epoch
without an added copy RPC on the warm path. A copied body is never an unchecked
authorization grant.
