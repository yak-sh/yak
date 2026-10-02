# Populated peer capacity

Run these explicitly; neither is part of the default package test run:

```sh
CAPACITY_CLIENTS=100 deno task test --all --tag=workerd \
  bench/vale-capacity_workerd_test.ts
CAPACITY_CLIENTS=200 CAPACITY_TICKS=12 deno task test --all --tag=workerd \
  bench/vale-capacity_workerd_test.ts
deno run -A bench/peer-capacity.ts 100
deno run -A bench/peer-capacity.ts 200
```

The workerd probe seeds a scratch app with 100 players, 100 looks and 1,282
placed records (1,482 rows; 1,682 at 200 players). Each client opens the current
area, reference-look and eleven own-record watches plus its own row. It
acknowledges frames, sends positions and makes three durable item/place writes.
It reports first-position and paced delivery separately from joins; intermediate
positions can coalesce, but every latest position and action must arrive.
`VALE_PROBE_LOG` optionally writes JSON lines; remove that file when finished.
No production load or copied owner data is used.

The local benchmark measures process CPU with the same watch/data shape over
RAM, including simulated subscribers, JSON serialization and decoding. It is not
workerd isolate CPU, Cloudflare duration or a billing estimate. Its ACKs are
synchronous; use workerd for transport/ACK latency. Comparisons on this shared
box are subject to other agents' CPU and disk contention.

Paired seam measurement for the cross-writer fanout change (`edcdbf14`):

| 100 clients                           |      Before |      After |
| ------------------------------------- | ----------: | ---------: |
| First position p95                    |    3,161 ms |     296 ms |
| Movement membership passes            |         100 |          1 |
| Membership wall sum                   |    2,054 ms |     190 ms |
| Reference matcher calls               |      10,000 |        100 |
| Queue maximum                         |  197 frames |   0 frames |
| Enqueue to send maximum               |    2,448 ms |     190 ms |
| First position SQL calls / rows       | 901 / 4,314 | 10 / 4,614 |
| Paced movement + actions p95          |    1,075 ms |     223 ms |
| Local process CPU, four ticks/actions |     3.220 s |    0.748 s |

Temporary seam counters were removed. Workerd's clock is quantized and does not
report isolate CPU; the local CPU numbers come from the RAM benchmark. The
baseline fixture's old own-row query caused 100 initial refusals; after
correcting it to `.entity.eid`, another before run still measured 3,597 ms
first-position p95 and 1,173 ms paced p95, with zero refusals.

Final uninstrumented run on the landed implementation: 100 clients delivered
9,900 first positions at 296 ms p95, all 39,600 paced observations at 171 ms p95
and all 300 action receipts. At 200 clients and twelve ticks, 39,800 latest
positions arrived, 318,400 intermediate observations were retained through
coalescing, and all 600 action receipts arrived; first p95 was 950 ms, paced
p95/p99 500/516 ms. Both runs had zero refusals or socket faults. The earlier
instrumented 200-client run reached 1,042/1,040 ms first/paced p95 with a
maximum queue of two frames: this is graceful degradation, not unlimited
headroom. Local 200-client process CPU was 2.440 s over 2.315 s movement wall,
including clients; simultaneous writers can use more than one CPU core.

Sequential cold join fanout remains expensive: 8.62 s and 58.06 MB for 100
clients, 17.49 s and 115.88 MB for 200. A bounded shared-initial-read trial
saved only about a second; it was removed. These are aggregate sequential join
times, not each client's login latency. Cold restore already shares identical
reads within its restore pass; fresh join read amplification and initial payload
size remain follow-up work. None of these measurements attributes T-44020's
historical row burst.
