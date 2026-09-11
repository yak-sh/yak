# Bounded transcript loading

The transcript UI loads a page around the bottom or its saved entry anchor,
rather than subscribing to every entry in the selected session. The default page
contains at most 64 entry bodies. Navigating near an edge requests an
overlapping page. Start/end navigation requests the corresponding real edge. The
full `Agent.transcript()` API and model request history are unchanged.

## Data flow

- `@yaks/session.transcriptPlan` walks fork ancestry and reads entry-position
  projections. It returns ordinary sequence-range queries with entry limits.
- The worker opens those queries through the existing `@yaks/api` subscription
  registry. Existing sync frames and transient text updates populate the
  frontend's `@yaks/client` working set.
- A separate metadata-only newest-entry query per ancestor observes append
  boundaries. New offscreen content is not replicated just to detect an append.
- The client owns loaded coverage and retains at most 256 inactive rows. Active
  session/task subscriptions are outside that inactive budget. Moving away from
  a page releases its subscription instead of marking its rows deleted.
- Viewport anchor, follow state, and pending range requests live in the private
  frontend graph. The generic `VirtualList` only requests ranges and renders
  supplied items. Loading a page cannot replace an anchor with a temporary empty
  collection.
- The Context usage panel reads the latest fork-aware usage fields separately;
  it no longer loads the entire transcript to find one ask.

No search/detail UI is introduced by this change. The entry-ID window API can
support a future reveal action without requiring every transcript ID locally.

## Measured comparison

Run `deno run -A packages/harness/window_bench.ts 2000 1000 3` to create a
private SQLite fixture and compare the existing full-transcript call with the
windowed call. The worker is initialized before the timed read. No live database
or provider is used. The measurements below are three runs on a shared host, not
production guarantees or complete launch-to-paint timings.

| Measurement                  | Full transcript | 64-entry window |
| ---------------------------- | --------------- | --------------- |
| Delivered entries            | 2,000           | 64              |
| Serialized result characters | 2,409,570       | 77,113          |
| First read                   | 238–526 ms      | 24–39 ms        |
| Repeated read                | 2–5 ms          | 5–7 ms          |
| Maximum 2 ms timer delay     | 165–372 ms      | 4–13 ms         |

Serialized result size excludes frame envelopes, metadata frontier frames, and
initial session/task summaries. An additional SQLite regression seeds 10,000
100,000-character bodies and reads only eight bodies. Its large source is
content-deduplicated by the blob store. The fixture does not imply a byte cap on
an individual page.

## Remaining limits

- A page is bounded by entry count, not byte size. One enormous entry still
  transfers and lays out its full text. Large-entry source slicing is separate
  work.
- Ancestor discovery and edge planning scale with fork depth. Initial root
  session/task summaries still load globally, and broad summary invalidation
  remains independent work.
- The scrollbar estimates unknown ranges as additional pages; it does not show
  an exact percentage of the complete transcript.
- Inactive retention is row-count bounded, not byte-count bounded. A retained
  page can contain large entries. The renderer independently bounds its trees
  and measured-line cache.
- Moving to a new page currently replaces its subscriptions. Cached rows avoid
  unbounded memory retention but do not eliminate server revalidation/transfer.
- Concurrent edits to loaded entries are subscribed. Appended membership is
  observed through frontier queries. Arbitrary historical deletion outside the
  loaded page is learned when the affected range is next requested.
- The backend still assembles the complete required conversation for a model
  request. This change limits UI reads, not model context.
