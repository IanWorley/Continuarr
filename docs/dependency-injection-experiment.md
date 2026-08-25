# Dependency injection experiment: Effect 3

## Scope and approach

This experiment adapts one existing vertical slice: `GET /api/v1/health`. It
does not move the Plex flow or the rest of the backend into Effect.

The slice is intentionally function-first:

```text
Elysia route
  -> Effect health request
       -> getHealthReport (ApplicationConfig requirement)
       -> RequestContext requirement
            <- requestContextLive (RequestIdGenerator requirement)
  <- Promise<{ report, requestContext }> at the HTTP boundary
```

Services are readonly interfaces identified by `Context.GenericTag`; values are
plain objects, and behavior remains functions. There are no authored classes,
decorators, or calls to `Context.get` in business logic. `getHealthReport` is an
`Effect` whose requirement type makes `ApplicationConfig` visible to the type
checker. Its actual domain transformation stays a normal pure function:

```ts
export function createHealthReport(config: ApplicationConfig): HealthReport {
  return { application: config.applicationName, status: "ok" }
}

export const getHealthReport = Effect.map(ApplicationConfig, createHealthReport)
```

That boundary is deliberate. Returning `Effect` from the orchestration function
demonstrates Effect's typed dependency channel; returning it from every pure
domain function would add no value. Elysia is kept outside Effect and calls
`Effect.runPromise` once in the controller. Existing framework code therefore
continues to see a Promise and a plain response object.

## Production composition

`createApplicationLayer` is the composition root. It supplies the application
configuration and UUID function, then uses the latter to build a fresh request
context whenever the health layer is provided:

```ts
const applicationConfig = Layer.succeed(ApplicationConfig, {
  applicationName: dependencies.applicationName,
})
const requestIdGenerator = Layer.succeed(RequestIdGenerator, {
  createRequestId: dependencies.createRequestId,
})
const requestContext = requestContextLive.pipe(
  Layer.provide(requestIdGenerator),
)

return Layer.merge(applicationConfig, requestContext)
```

`createApi()` accepts the fully closed `HealthLayer`. The controller provides it
to the request program, runs that Effect, sets the request ID header, and returns
the report. The layer type fixes both its error and input requirements to
`never`, so an incomplete production graph cannot be handed to the route.

This experiment constructs the small layer per request. That gives the request
context the correct lifetime and keeps ownership obvious. If a later slice adds
a database pool or another expensive application-lifetime resource, it should
use a `ManagedRuntime` created at application startup and disposed on Elysia
shutdown; that extra lifetime machinery is not justified for two value layers
and one UUID here.

## Test composition and ceremony

### Unit test: low-to-medium ceremony

The unit test replaces one dependency with a plain object in a one-service
layer. There is no container reset or mocking library:

```ts
const testLayer = Layer.succeed(ApplicationConfig, {
  applicationName: "Continuarr unit test",
})

const report = await Effect.runPromise(
  getHealthReport.pipe(Effect.provide(testLayer)),
)
```

Compared with direct parameter injection, `Layer.succeed` plus
`Effect.provide`/`runPromise` is noticeable ceremony. Compared with a mutable DI
container, isolation is excellent: the replacement is local to this value and
cannot leak into another test.

### HTTP integration test: low ceremony

The integration test uses the same production graph builder with two plain
fakes and passes the resulting layer to `createApi`:

```ts
const testApi = createApi(
  createApplicationLayer({
    applicationName: "Continuarr test",
    createRequestId: () => "test-request-id",
  }),
)

const response = await testApi.handle(
  new Request("http://localhost/api/v1/health"),
)
```

This is the easiest test style in the experiment. The fake values are obvious,
fully typed, and use the real composition path.

### Resource-lifecycle test: medium ceremony, strong guarantee

A scoped test layer can prove release behavior without a real file, socket, or
container:

```ts
const requestContext = Layer.scoped(
  RequestContext,
  Effect.acquireRelease(
    Effect.succeed({ requestId: "scoped-request-id" }),
    ({ requestId }) => Effect.sync(() => releasedRequestIds.push(requestId)),
  ),
)

const testApi = createApi(Layer.merge(applicationConfig, requestContext))
await testApi.handle(new Request("http://localhost/api/v1/health"))
expect(releasedRequestIds).toEqual(["scoped-request-id"])
```

The setup is more abstract than `try/finally`, but it tests the property that
matters: the finalizer has run by the time the request Effect completes. The
production request context uses `Layer.effect`, not a fake no-op finalizer,
because generating a UUID does not own a resource.

## Type-safety failure modes

- An unprovided tag remains in `Effect<Success, Error, Requirements>`.
  `Effect.runPromise` only accepts an Effect whose requirements are `never`, so
  missing provision fails type checking at the boundary.
- `Layer.succeed(Tag, value)` checks the full service shape. A missing field or
  wrong function result is a compile-time error, and `HealthLayer` prevents a
  partially wired graph from reaching `createApi`.
- Expected failures can live in Effect's typed error parameter. This slice has
  no expected failure, so it uses `never`; thrown exceptions such as a broken
  UUID implementation are defects and are not represented in that channel.
- `GenericTag` keys are strings and their types are erased at runtime. Reusing a
  key for two incompatible service types can create a runtime collision that
  TypeScript cannot detect. Central tag declarations and namespaced constants
  reduce, but do not eliminate, that risk.
- `any`, unsafe casts, and running an Effect too early can bypass the guarantees.
  Promise adapters also need an explicit policy for mapping typed failures or
  defects into HTTP responses; this healthy-only slice does not exercise it.

## Runtime, lifetime, and resource behavior

Layers describe construction and dependency relationships. Supplying the health
layer builds a request context for that request; the Effect runtime closes any
scope created by a scoped layer after success, failure, or interruption.
`Effect.acquireRelease` registers release only after successful acquisition and
runs it when the scope closes. The focused lifecycle test verifies this at the
actual Elysia boundary.

Layer memoization applies within one layer build, not globally across unrelated
`Effect.provide` calls. Consequently, this design intentionally gets one request
context per request. Long-lived resources must instead be built once in a
managed runtime and explicitly disposed during application shutdown. Getting
that boundary wrong can cause repeated pool construction or a leaked runtime;
Effect supplies the primitives but cannot infer the application's desired
lifetime.

## Dependency and bundle cost

This change adds `effect@3.22.1`, which declares two direct dependencies:
`@standard-schema/spec` and `fast-check`; `fast-check` adds `pure-rand`. The
published Effect package reports 2,715 files and 27,163,807 bytes unpacked. The
installed packages occupy about 37 MB total (approximately 33 MB for Effect,
4.1 MB for `fast-check`, 320 kB for `pure-rand`, and 36 kB for the schema spec).
Effect declares `sideEffects: []`, allowing tree shaking.

For this repository's production build, the client JavaScript chunk sizes were
unchanged; generated CSS moved from 9.71 kB / 2.74 kB gzip at the base commit to
9.74 kB / 2.76 kB gzip after adding this report. The large server router chunk
changed from 2,538.14 kB / 158.51 kB gzip to 2,540.14 kB / 159.09 kB gzip:
approximately +2.00 kB raw and +0.58 kB gzip for this slice. These are
Vite-reported bundle figures, not a general benchmark; importing more of Effect
will change them.

The bundle delta is small. Install size, dependency surface, compile-time type
work, and the team's learning cost are the more material costs for DI alone.

## Debugging ergonomics

Positive: requirements are visible in inferred types, construction is described
in one layer graph, and local test layers avoid global state. Effect also carries
structured causes and preserves finalization across interruption, which becomes
valuable for asynchronous workflows.

Negative: a developer must read Effect's generic parameter order and layer
algebra to understand wiring failures. Runtime defects are rendered through
Effect's cause machinery and can be less familiar than a direct Promise stack.
The LSP can improve diagnostics, but requiring an Effect-specific editor plugin
would be an adoption cost. For this small endpoint, stepping through
`Effect.provide` is less obvious than stepping through a function parameter.

## Scaling limits

- Layer graphs scale better than manually threading a large shared environment,
  but merge/provide direction and inferred unions become hard to read as the
  graph grows. Named subgraphs and explicit closed layer aliases are necessary.
- Cyclic dependencies remain an architecture problem. Effect can express lazy
  construction, but using it to preserve cycles would hide a design issue.
- Per-request construction is correct for request data and wrong for pools,
  caches, and clients. A real application needs documented ownership boundaries
  and managed runtime disposal.
- Effect is much broader than a DI library. A team that uses only Context and
  Layer still pays for a new execution model in affected functions without
  receiving the full benefit of typed errors, concurrency, schedules, streams,
  and observability.
- Elysia, Drizzle, and third-party Promise APIs require adapters. Too many
  Effect/Promise crossings would make both error handling and traces worse, so
  crossings should stay at controllers and infrastructure adapters.

## Migration cost

The demonstrated slice is small: one package, four production modules, and
focused tests. Migrating the backend is not a mechanical container swap. Service
orchestration must return `Effect`; expected errors need modeled types; Promise
APIs need wrappers; and startup/shutdown ownership must be designed. Developers
also need to learn Context identity, Layer input/output types, scope, causes, and
the difference between defects and typed failures.

Incremental adoption is possible because `Effect.runPromise` gives a clean exit
at the controller. The safe path would be one asynchronous/resource-heavy slice
at a time, leaving pure domain functions pure. A broad rewrite would be high
risk and would make the comparison impossible to evaluate.

## Official documentation quality

Evidence was checked on 2026-08-25 against the stable v3 documentation and the
installed `effect@3.22.1` declarations. Scores are intentionally about the path
needed for this function-first DI experiment, not Effect's overall capability.

| Category | Score | Evidence and notes |
| --- | ---: | --- |
| Getting-started clarity | 4/5 | The [introduction](https://www.effect.website/docs/v3/getting-started/introduction) clearly explains the success/error/requirements model and the [installation guide](https://www.effect.website/docs/v3/getting-started/installation) covers supported package managers and TypeScript settings. The sequence is approachable, but it is a large framework before DI appears. |
| Function-first examples | 2/5 | The [managing services guide](https://www.effect.website/docs/v3/requirements-management/services) begins with function parameters, but its actual Effect service examples use authored classes extending `Context.Tag`. The supported class-free `GenericTag` constructor is documented primarily in the [Context API reference](https://www.effect.website/docs/v3/api/effect/Context#generictag), with only a tiny example. |
| API reference completeness | 4/5 | The v3 [API index](https://www.effect.website/docs/v3/api) is versioned and the `Context` and [Layer reference](https://www.effect.website/docs/v3/api/effect/Layer) include signatures, `since` versions, examples, and source links. It matched installed 3.22.1 types. Navigation is comprehensive but dense, and some entries explain mechanics more than intended composition patterns. |
| Testing guidance | 2/5 | The narrative testing section contains only [TestClock](https://www.effect.website/docs/v3/testing/testclock). It is useful for time, but there is no first-party walkthrough for replacing application services with layers in Bun's test runner or for testing scoped finalizers. The needed pattern had to be assembled from service/layer/resource pages. |
| Lifecycle guidance | 4/5 | [Resource management](https://www.effect.website/docs/v3/resource-management/introduction), [Scope](https://www.effect.website/docs/v3/resource-management/scope), and the layer guide's [scoped layers](https://www.effect.website/docs/v3/requirements-management/layers#scoped-layer) explain finalization, scopes, and acquisition/release in depth. The material is strong but spread across long pages. |
| Currency and maintenance signals | 4/5 | The official [v3 API page](https://www.effect.website/docs/v3/api/effect) reports 3.22.1, matching the installed latest stable version, while [npm](https://www.npmjs.com/package/effect) shows frequent releases and active use. The site clearly offers v3/v4 switches, but the homepage now promotes v4 RC, so newcomers must consciously stay on v3 and plan a future major migration. |
| Time to find needed APIs | 2/5 | `Context` and `Layer` appeared immediately in the requirements guides, but finding a current class-free tag took a move to the API reference and verification in installed declarations. General fake-layer and lifecycle-test recipes were not directly findable. Roughly 15 minutes of cross-checking was needed for five APIs in a small slice. |

Total: **22/35**. The documentation is extensive and current, but the exact
function-first DI/testing path is not easy or obvious.

## Recommendation

Do not adopt Effect across Continuarr solely for dependency injection today.
For Ian's priorities, direct factory functions and explicit parameters are
easier to teach, debug, and test, and the official docs do not make the preferred
class-free path obvious enough. This slice works and is strongly typed, but its
unit test has more ceremony than the behavior warrants.

Effect becomes a credible choice if Continuarr also wants its typed error model,
structured concurrency, retries, observability, and resource safety. In that
case, keep pure domain transformations plain, let orchestration functions return
`Effect`, maintain one boundary per HTTP request, and introduce managed runtimes
only when the first genuinely long-lived resource arrives. Re-evaluate after one
resource-heavy production slice rather than committing the whole backend based
on this health endpoint.
