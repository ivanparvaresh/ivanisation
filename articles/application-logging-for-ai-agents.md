# Application Logging for AI Agents

*How to write ordinary application logs — for any service — so a coding agent like Cursor can troubleshoot with you instead of guessing.*

Sep 8, 2026 · Mohammad Hamrah

---

## What you will read

This is not an article about logging the AI agents inside your product.

It is about **application logs**: the structured records your API, worker, CLI, or backend already emits (or should emit). The reader that matters now is often a coding agent — Cursor, Copilot, and the like — helping you find why a request failed, returned the wrong payload, or behaved oddly in production.

Two rules drive everything else:

1. **Application logs should carry full context** so an agent can review one request and quickly understand the exact response — what came in, what the system did, and what went out.
2. **Give the agent access to the logs** so it can query the neighborhood around a failure — earlier requests, related ids, sibling steps — instead of waiting for you to paste a fragment.

You will also see how I log in practice (structured context at the edge, warn vs fatal) and how I throw with `AppError` — `.withMeta(...)` for safe business facts, `.withDebug(...)` for ops-only detail that stays in logs.

The through-line: **log for comprehension, open for investigation.**

---

## The shift: logs used to be for you

For years, application logs were breadcrumbs for a human who already knew the codebase. You grepped. You remembered that `orderId` lived three services away. You filled gaps from tribal knowledge.

Coding agents do not have that tribal knowledge. They are fast at reading evidence and slow at inventing what you forgot to record. If the log is thin, they hallucinate a story. If the log is complete and reachable, they localize the bug.

| Old mindset | Agent-ready application logging |
| --- | --- |
| Log enough for a human who wrote the feature | Log enough for an agent that did not |
| Status + short message | Full request context + exact response / outcome |
| You grep; you decide what matters | You give an id; the agent queries |
| Paste a snippet when stuck | Agent can fetch the request and its neighbors |
| Logs are an ops afterthought | Logs are how the coding agent sees production |

If Cursor has to ask “what was in the response body?” or “what was the request payload?”, the log failed — not the model.

---

## Mindset 1 — Full context in the application log

An agent cannot infer what you forgot to write down. Design each serious log event as a **self-contained brief**: after one read, the agent should understand *this request* without a second trip to your head.

### What “full context” means

Not a novel. A complete frame for the unit of work (HTTP request, job, message handler):

- **Who / where:** tenant or workspace, principal, service, environment
- **Correlation:** `requestId` (and `jobId` / `messageId` / `traceId` if you have them)
- **What came in:** method, path, key params or a redacted body summary
- **What the system did:** important branches, downstream calls, cache hit/miss, validation failures
- **What went out:** status, **exact response** (or a faithful summary of the payload the client got), error code / message
- **Timing:** duration; optionally downstream durations

The test I use: *If I handed only this log line (or this request’s log group) to Cursor in a fresh session, could it explain the response in one pass?* If not, the context is incomplete.

### Thin logs feel fine until an agent reads them

```text
INFO POST /orders 200 142ms requestId=req_8f3a
```

That is enough for uptime dashboards. It is useless for “why did we charge the customer twice?” or “why is `total` null in the JSON?” The agent needs the order id, the idempotency key, the branch that ran, and the response body (or its structured fields). Without that, it invents theories. With that, it finds the real bug.

### Log the response you actually returned

“Full context” includes the **outbound** side. Agents debug wrong answers and wrong payloads as often as they debug 500s. If you only log “ok”, they cannot see that you returned `{ "status": "paid" }` while the DB still said `pending`. Prefer structured fields for the response shape you care about; redact secrets; keep enough that the agent can match log ↔ client symptom.

---

## Mindset 2 — Let the agent access the neighborhood

Full context on one event is necessary. It is not sufficient.

Bugs live in the **neighborhood**: the prior request that created the row, the retry that double-wrote, the worker that failed after the API returned 200, the sibling call with the same idempotency key. A pasted snippet freezes time. An agent with access can walk sideways.

### What “access” looks like

You do not need a research platform. You need a path the coding agent can use:

- **Queryable store** — files, Docker logs, CloudWatch / Datadog / Loki, Postgres audit tables, or whatever you already have
- **Stable ids** on every related line so “neighbors of `req_8f3a`” is a query
- **A fetch path** — CLI, script, API, MCP, or “read this log file” — so you are not the paste buffer
- **Bounded permissions** — read-only where possible, redacted, environment-scoped

The mindset shift: **stop being the agent’s log proxy.** Point it at the id (or time window + service). Let it pull the request. Let it ask for ±N minutes, same `orderId`, same user, same job.

### Why neighborhood queries beat bigger pastes

Pastes are lossy and static. Neighborhood queries find:

- the create that succeeded before the update that failed
- three retries that looked like “slowness”
- a race between two requests with the same key
- a worker error five seconds after a 200

Tell the agent: *Start from `req_8f3a`. Load that request’s logs. Query the same `orderId` for ±30 minutes across api and worker. Compare.* That is investigation. Handing it one sad line is theater.

---

## How the two mindsets fit together

```text
Write full context  →  agent understands this response in one read
Open log access     →  agent queries neighbors when the story is incomplete
Correlate with ids  →  neighborhood queries stay cheap and precise
Redact by default   →  access stays safe enough to give the agent
```

Vendors and OpenTelemetry help when you outgrow files and grep. They are optional. The mindset is not: **comprehensible application logs** and **reachable stores**.

---

## How I actually log

Patterns I use across ordinary backends (APIs, workers, jobs). Names below are fictionalized as Harbor Desk; the shape is what I ship.

### Structured logger + request context

- Child logger per operation (`Checkout.Complete`, worker `operationId`).
- At the edge of every HTTP/worker call: `setContext({ requestId, spec, http|worker, principal })` so later lines inherit ids without re-threading them.
- Levels that mean something: `info` for success path, `warn` for expected client/domain failures, `error` / `fatal` for unexpected server failures (fatal also alerts).
- JSON lines in production; pretty ANSI locally.
- Automatic redaction of sensitive keys (`password`, `token`, `authorization`, `cookie`, `api_key`, …) and light email masking before write.
- When an `AppError` is logged, the logger serializes `id`, `code`, `severity`, `meta`, `debug`, and `innerError` into the `error` field — so Cursor sees the same bag you threw.

Success path (edge):

```ts
this.logger.setContext({
  requestId,
  spec: { operationId: this.spec.operationId },
  http: { method: request.method, path: request.path },
})
// ...
this.logger.info(`${request.method} ${request.path} - ${status} - ${duration}ms`, {
  http: { status, duration },
})
```

Failure path (edge): expected failures are `warn`; true server failures are `fatal` — always with the error object attached:

```ts
const appError = AppError.of(error)
const status = AppError.CODES[appError.severity].status
if (appError.severity === 'SERVER_ERROR') {
  this.logger.fatal(appError.message, { error: appError, http: { status } })
} else {
  this.logger.warn(appError.message, { error: appError, http: { status } })
}
```

That pairing matters for agents: the log line is not “something failed” — it is the full error record under a shared `requestId`.

### How I throw — `withMeta` vs `withDebug`

I do not `throw new Error('not found')`. I throw a typed application error with a stable **code**, a human **message**, and then attach bags:

| Bag | Purpose | Safe for API clients? | Safe / useful in logs for Cursor? |
| --- | --- | --- | --- |
| `.withMeta({ ... })` | Business facts that explain the failure (ids, status, allowed vs actual) | Yes — included in the serialized error body | Yes |
| `.withDebug({ ... })` | Ops-only detail (raw token fragment context, stack-ish internals, noisy payloads) | No — stripped from the client response | Yes — logger keeps it on the error object |
| `.withInnerError(err)` | Wrap an unknown/lower error | No (server errors hide internals) | Yes |

Factory + chain:

```ts
// Expected domain failure — meta is part of the contract with clients and logs
throw AppError.resourceNotFound(
  'order.not_found',
  'Order not found',
).withMeta({ orderId, workspaceId })

throw AppError.badRequest(
  'checkout.invalid_status',
  'Only pending carts can be checked out',
).withMeta({ cartId, status: cart.status })

throw AppError.forbidden(
  'auth.permission_denied',
  'You are not allowed to perform this action',
).withMeta({ permissions: required, actorRole: role })

// Downstream failure — debug has noisy ops detail; meta stays safe for clients/logs
throw AppError.serverError('Inventory service unavailable')
  .withInnerError(error)
  .withMeta({ orderId, sku: 'SKU-1042' })
  .withDebug({
    downstream: { method: 'POST', path: '/v1/reserve', status: 503, latencyMs: 2104 },
    attempt: 2,
  })
```

Rule of thumb I give myself (and Cursor):

- **`meta`** = what you would put on a ticket for another engineer *and* safely show the client.
- **`debug`** = what helps an agent reconstruct the failure but must not leak to the browser.
- Never put secrets in either bag without redaction — the logger scrubs known keys, but do not rely on that as your only control.

When something unknown blows up, normalize once:

```ts
const appError = AppError.of(unknown) // wraps Error / Zod / raw into AppError
```

Then log that object. Cursor gets `code`, `severity`, `meta`, `debug`, and stack in one place.

---

## Samples (fictionalized)

### Incomplete vs complete success log

**Incomplete:**

```text
INFO POST /checkout 200 142ms requestId=req_8f3a
```

**Complete enough for an agent to understand the exact response:**

```json
{
  "level": "info",
  "name": "Checkout.Complete",
  "msg": "POST /checkout - 200 - 142ms",
  "requestId": "req_8f3a…",
  "http": { "method": "POST", "path": "/checkout", "status": 200, "duration": 142 },
  "principal": { "workspaceId": "ws_…", "userId": "usr_…" },
  "input": { "cartId": "cart_19", "idempotencyKey": "idem_77" },
  "orderId": "ord_441",
  "response": {
    "orderId": "ord_441",
    "paymentStatus": "paid",
    "totalCents": 12900
  }
}
```

### Sample error logs (what Cursor should see)

**1. Expected not-found — `warn` + `withMeta`**

Throw:

```ts
throw AppError.resourceNotFound('order.not_found', 'Order not found')
  .withMeta({ orderId: 'ord_441', workspaceId: 'ws_9' })
```

Logged (edge handler):

```json
{
  "level": "warn",
  "time": "2026-09-08T01:12:44.102Z",
  "name": "Orders.Get",
  "msg": "Order not found",
  "requestId": "req_8f3a…",
  "http": { "method": "GET", "path": "/orders/ord_441", "status": 404 },
  "error": {
    "id": "err_01J…",
    "name": "Error",
    "message": "Order not found",
    "code": "order.not_found",
    "severity": "NOT_FOUND",
    "meta": { "orderId": "ord_441", "workspaceId": "ws_9" }
  }
}
```

Client body still gets `meta` (safe). Cursor does not need you to explain which order — it is on the line.

**2. Domain conflict — status mismatch**

Throw:

```ts
throw AppError.badRequest(
  'checkout.invalid_status',
  'Only pending carts can be checked out',
).withMeta({ cartId: 'cart_19', status: 'paid' })
```

Logged:

```json
{
  "level": "warn",
  "msg": "Only pending carts can be checked out",
  "requestId": "req_91c2…",
  "http": { "status": 400 },
  "error": {
    "id": "err_01K…",
    "code": "checkout.invalid_status",
    "severity": "BAD_REQUEST",
    "message": "Only pending carts can be checked out",
    "meta": { "cartId": "cart_19", "status": "paid" }
  }
}
```

An agent reading this knows the bug is either a double-submit or a stale client — not a missing route.

**3. Downstream failure — `withDebug` stays in logs, not in the response**

Throw:

```ts
throw AppError.serverError('Inventory service unavailable')
  .withInnerError(error)
  .withMeta({ orderId: 'ord_441', sku: 'SKU-1042' })
  .withDebug({
    downstream: { method: 'POST', path: '/v1/reserve', status: 503, latencyMs: 2104 },
    attempt: 2,
  })
```

Logged:

```json
{
  "level": "fatal",
  "msg": "Inventory service unavailable",
  "requestId": "req_22ab…",
  "http": { "status": 500 },
  "error": {
    "id": "err_01L…",
    "code": "app.internal_server_error",
    "severity": "SERVER_ERROR",
    "message": "Inventory service unavailable",
    "meta": { "orderId": "ord_441", "sku": "SKU-1042" },
    "debug": {
      "downstream": { "method": "POST", "path": "/v1/reserve", "status": 503, "latencyMs": 2104 },
      "attempt": 2
    },
    "innerError": {
      "name": "FetchError",
      "message": "socket hang up"
    }
  }
}
```

Serialized HTTP body for the client omits `debug` / `innerError` (generic internal error). The log keeps the downstream status and attempt count so Cursor can see *which* hop failed without shipping that detail to the browser.

**4. Unexpected server failure — `fatal` + wrapped error**

```ts
// somewhere deep
throw AppError.of(err) // or AppError.serverError('Payment provider unavailable').withInnerError(err).withMeta({ orderId })
```

Logged:

```json
{
  "level": "fatal",
  "msg": "Payment provider unavailable",
  "requestId": "req_77e1…",
  "http": { "status": 500 },
  "error": {
    "id": "err_01M…",
    "code": "app.internal_server_error",
    "severity": "SERVER_ERROR",
    "message": "Payment provider unavailable",
    "meta": { "orderId": "ord_441" },
    "innerError": {
      "name": "FetchError",
      "message": "socket hang up"
    }
  }
}
```

Client sees a generic internal error. Logs + alert channel see the full bag. That is the split `meta` / `debug` / `innerError` exist for.

### Neighborhood prompt for Cursor

```text
Symptom:
Client shows paymentStatus=paid for ord_441, but the orders table is still pending.
Customer was charged once.

Do this yourself — do not wait for me to paste more logs:
1. Load application logs for requestId=req_8f3a and summarize input + exact response
   (and any warn/fatal error objects with meta/debug)
2. Query the neighborhood: same orderId / idempotencyKey across api + worker
   in a ±30m window
3. Find the write path that left DB pending while the HTTP response said paid
4. Fix that path; if you throw, use AppError.*.withMeta({ orderId, ... })
   and log the AppError at the edge (warn vs fatal by severity)

Access:
- local: docker compose logs or the log script already in @apps/api
- ids: requestId=req_8f3a orderId=ord_441 idempotencyKey=idem_77

Constraints:
- Read-only against prod-shaped data; redact secrets
- Small fix; review before commit
```

You gave access and a neighborhood. The agent investigates. You review the diff.

---

## Operating habits

### Write logs as if the next reader is cold

Assume Cursor did not write the feature and was not on the call. Put the exact response (or its critical fields) and the evidence that produced it in the record.

### Prefer “here is the id” over “here is everything I remember”

Your memory is lossy. The log store is not. Point the agent at ids; let it pull context and neighbors.

### Teach the agent how to query

A short rule helps: *On production bugs, fetch logs by requestId, then query ±30m by business key across related services before proposing a fix.*

### Still redact

Access without redaction is how useful logging becomes an incident. Full context means **full decision/request context**, not a credential dump. Put sensitive material in `debug` only when needed — and rely on logger redaction as a backstop, not the plan.

### Still bound the fix

Better logs improve diagnosis. They do not excuse a 40-file refactor. Small blast radius; review before commit.

---

## The pattern you can reuse

I call it:

**Write application logs so a coding agent can understand the exact response in one read — and let that agent query the neighborhood when the story is incomplete.**

Try this:

1. On every request/job, log input summary, key business ids, and **exact response** (or structured outcome) under a `requestId`.
2. Throw typed errors with stable codes; attach `.withMeta({ ... })` for client-safe facts and `.withDebug({ ... })` for log-only detail.
3. At the edge, log the `AppError` object (`warn` vs `fatal` by severity) so meta/debug land in the same line Cursor will read.
4. Make those logs reachable from the repo workflow (script, CLI, MCP, log file path).
5. On failure, give Cursor the id and symptom — not a memoir.
6. Tell it to load the request, then query neighbors before fixing.
7. After the fix, ask: *Would an agent have understood this from the log alone?* If no, add the missing field (usually more `meta`).

What this is *not*: status-only logging, logs trapped in a UI only humans click, or pasting random fragments and hoping the model guesses the rest. And it is *not* a guide to instrumenting product AI agents — it is how any application should log so AI agents can help you debug.

---

## Conclusion

The useful change is not a new library. It is a different reader of the same application logs.

Write enough context that a coding agent can review a request and immediately understand the exact response. Throw errors that carry `meta` and `debug` so the failure is self-describing in the log. Then give that agent access to the log store so it can query the neighborhood — same business key, surrounding requests, sibling workers — instead of waiting for you to act as a slow, lossy API.

**Log for comprehension. Open for investigation.** Do that for any application, and Cursor stops guessing about production — it reads it.
