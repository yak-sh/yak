# Hosted model executor

The executor runs hosted model calls in a Cloudflare Workflow outside the kernel
Worker. An **executor release** is one Worker and Workflow name, such as
`yak-model-v1`. Accepted calls keep that executor release while kernel deploys
replace the app Store that requested them. Private requests and receipts live in
the `RECEIPTS` R2 bucket.

## Build and deployment

From the repository root, bundle without deploying:

```sh
deno run -A workers/model/wrangler.ts deploy --dry-run
```

The wrapper reuses the kernel's pinned Wrangler, npm installation and workspace
import paths. A push to main deploys through this Worker's own Workers Builds
connection. The kernel build does not deploy the executor.

| Workers Builds setting  | Value                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | `yak-sh/yak`                                                                                                                                                              |
| Production branch       | `main`                                                                                                                                                                    |
| Root directory          | repository root                                                                                                                                                           |
| Build command           | empty                                                                                                                                                                     |
| Deploy command          | `sh bin/build-model`                                                                                                                                                      |
| Build variable          | `SKIP_DEPENDENCY_INSTALL=1`                                                                                                                                               |
| Build caching           | enabled                                                                                                                                                                   |
| Watch paths             | `workers/model/*`, `packages/*`, `bin/build-model`, `workers/yak/wrangler.ts`, `workers/yak/dependencies.ts`, `workers/yak/package.json`, `workers/yak/package-lock.json` |
| Non-production branches | disabled                                                                                                                                                                  |

The build records the commit and a hash of the bundle, bindings and Wrangler
pin. It skips an unchanged executor release and refuses to replace a published
executor release with changed inputs. Give changed code another Worker and
Workflow name, connect its independent build, and retain prior executor releases
for their accepted calls. Switching new calls to a release and retiring a
drained release are kernel integration work.

## Account setup

Create the private R2 bucket `yak-model-receipts` and the Workers Builds
connection before activation. Bucket creation is an account operation:

```sh
npx --yes --prefer-offline wrangler@4.111.0 r2 bucket create yak-model-receipts
```

The `KERNEL` service binding calls the kernel's `ModelHost`, its authenticated
receipt host. The build refuses to publish a release without this binding;
publishing it first would freeze the binding out of its immutable configuration.
There is no public route or workers.dev endpoint. Provider credentials are
forwarded at the executor's outbound boundary; private request objects contain
no credential values.

Configure the independent build in the Cloudflare dashboard or use a user-scoped
token with Workers Builds Configuration Edit. Ordinary Worker deployment
credentials do not configure the repository connection.

## Kernel integration

A production kernel build inspects this executor release's deployments before
uploading. It adds the `MODEL` service binding only when one version serves all
traffic. Before the independent Workers Builds project publishes its first
release, or when deployment inspection fails, hosted calls keep running inline.
The next kernel build after publication enables dispatch to the executor;
staging and local probes keep running inline. The kernel's `MODEL_RECEIPTS`
binding reads the same private bucket as the executor's `RECEIPTS` binding.

The kernel freezes the request privately before pinning `inference` on the ask.
For ask `a`, the `Inference` Workflow parameters are:

```json
{
  "call": "a",
  "executor": "yak-model-v1",
  "request": "inference/yak-model-v1/a/request",
  "receipt": "inference/yak-model-v1/a/receipt"
}
```

The request object is `FrozenRequest` from `worker.ts`: the same `call` and
`executor`, provider data (`api`, sentinel `key`, optional OpenAI `base` and
`headers`), and a `frozenRequest` from `@yaks/model`. The kernel never replaces
that object on retry. `ModelExecutor.submit` creates or finds the Workflow whose
instance id is the ask eid. `version` returns its executor release and Worker
version metadata. The service has no public fetch door.

`Kernel` in `worker.ts` defines the `ModelHost` service contract. `submitted`
reads the ask's submission mark; `claim` atomically writes it only if absent;
`checkpoint` awaits provider-owned acknowledgement marks. `grants` authorizes
credentials for that ask at each outbound call. The executor swaps the grants
in-process with `@yaks/egress`, so the provider stream stays outside the kernel.

The bucket keeps the complete `InferenceReceipt` at the receipt reference,
provider evidence at `inference/<executor>/<ask>/media`, and generated artifacts
under `artifacts/<address>`. `delivered` idempotently publishes the receipt
reference on the original ask and owes its graph delivery and settlement.
`report` durably reports a failure once for that ask; its reason and exception
retain the evidence needed by the tracker. A failed delivery leaves the complete
answer intact. After bounded Workflow retries, an unrecoverable generation
publishes an interruption without clearing its submission mark.
