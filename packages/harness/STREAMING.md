# Streamed responses

Response streaming is enabled by default in both `agent` and the worker-backed
`remote` frontend. Disable it with `HARNESS_STREAM=0 deno task harness`, or pass
`streaming: false` (also accepted as `stream: false`) to `agent` / `remote`.
Explicit programmatic configuration overrides the environment; `streaming` wins
if both option names are supplied. `HARNESS_STREAM=1` remains supported.

Models that return only a final reply still work; they simply have no partial
text to display. Disabling streaming uses the older completed-response path: the
ask is recorded after the model returns, and existing non-streaming retry
behavior applies. Streaming attempts retain the interruption rules below.
Terminal graphics are configured separately and are not enabled by this change.

The worker receives each OpenAI public output-text delta, assigns the provider's
item ID to one response entry, and publishes ordered graph text projections.
Tool argument fragments and private reasoning are not published or executed.
Image payloads still go through artifact storage, not text projections. Final
output, calls, artifacts, and usage are committed when the reply completes.

Provider deltas are not necessarily individual tokens. Transient notifications
are microtask-batched by subscriptions, and terminal paints use the existing
renderer scheduling. The callback backlog is bounded at 4,096 deltas; overflow
fails the attempt instead of silently dropping text. The transport disables its
internal retry loop for streaming exchanges, because an already-exposed partial
response must not be replayed as though nothing happened.

## Ask lifecycle and failures

The ask is persisted **before calling the model**, with
`attempt.state=inflight`, its original `ask.through` boundary, and resolved
request configuration. Local context-image loading finishes first. A dispatch
crash after admission but before network send is indistinguishable from a crash
after send; either is treated conservatively as interrupted on restart. No
automatic resend occurs.

Each text item starts with a durable identity and empty body. The body is live
until a checkpoint or finalization. Checkpoints occur on the next delta after 2
seconds have elapsed (`agent({checkpointMs})`, zero disables checkpoints). They
write complete current text through existing blob storage; appends do not create
blob versions. A crash can lose the tail after the last checkpoint. There is no
timer-based checkpoint while the provider is silent.

Success patches the original ask to `completed` and updates the same response
entries; it does not append duplicate final messages. Operational interruption
(abort, transport/provider error, or an unfinished attempt recovered on restart)
preserves received/checkpointed text and marks the attempt `interrupted`. An
`error{code: "interrupted"}` entry records the outcome; it is not a defect or a
crashed session. With no newer input the session settles, without automatically
resending the request. New inputs already admitted during the attempt, or
submitted afterward, continue normally. Repeated restarts do not append
additional interruption records.

Continuation uses the last completed response, never an interrupted attempt's
provider ID. Intervening user inputs and partial assistant text are included as
conversation history. Partial tool arguments are not admitted as executable
calls. This is not a guarantee of exactly-once execution for provider-native
side effects: an interrupted image or other native operation may have executed
remotely, and a new explicit request may repeat it.

Unexpected adapter/programming exceptions and checkpoint/finalization failures
remain defects with exception records. Recognized operational errors bypass the
defect journal. This does not change nonstreaming request retry policy.

New messages arriving during a request remain outside its frozen boundary and
are served by a subsequent ask. Session status stays running while the request
is active. Tool calls execute only after final arguments are admitted. Forks
whose inherited prefix would include an in-flight attempt are rejected rather
than sharing a mutable response tail. Normal tool-created forks inherit the
completed request's original prefix, as before.

Shutdown drains callbacks under the existing daemon contract. A forced worker
termination leaves the ask in flight; startup marks it interrupted rather than
repeating it. Old inline readers must not be running against a streaming
database.

## Measurements and limitations

`deno run -A packages/harness/streaming_bench.ts` compares a RAM graph with an
API subscription receiving 2,000 ten-character deltas. One development-host run:

| Implementation                      | Durable writes | Serialized characters |   Time |
| ----------------------------------- | -------------: | --------------------: | -----: |
| Growing-string write for each delta |          2,000 |            20,172,071 | 248 ms |
| Transient appends and final commit  |              1 |               239,300 |  29 ms |

This is a protocol/storage-work comparison, **not** a terminal input-latency or
live-provider benchmark. The worker integration test verifies that the frontend
can read partial text before model completion. Existing Markdown rendering still
parses the visible item's growing text, and the harness still uses coarse
refresh notifications. Thus large visible outputs can incur repeated
layout/parse cost; this pilot does not promise constant-time rendering per
delta. Initial snapshots and checkpoints transfer complete strings. There is no
transport backpressure acknowledgment yet, only a bounded session ingestion
backlog.

The generic projection API and its deliberately durable query-membership rules
are documented in [TRANSIENT.md](../graph/TRANSIENT.md). Full transient
predicate indexes, generalized patch overlays, distributed writers, automatic
retry of ambiguous asks, and retained streaming replay logs are not implemented.
