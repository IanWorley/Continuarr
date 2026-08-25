# Dependency injection experiment: iti

## Approach

This experiment adapts one existing vertical slice: `GET
/api/v1/auth/plex/login/start`. The service remains an ordinary function factory.
It knows about four function-shaped dependencies and has no `iti` import,
decorator, authored service class, or container lookup. Elysia routes are also
factories, so the only container-aware file is the composition root in
`src/backend/container.ts`.

```ts
export function createStartPlexLogin(dependencies: StartPlexLoginDependencies) {
  return async function startPlexLogin() {
    const setting = dependencies.findApplicationSetting(SETTING_KEY);
    const identifier = setting?.value ?? dependencies.createClientIdentifier();

    if (!setting) dependencies.saveApplicationSetting(SETTING_KEY, identifier);

    const result = await dependencies.startPlexAuth(identifier);
    return result.data?.authorizationUrl;
  };
}
```

`iti@0.8.0` is a legitimate function-factory option. Its chained `add`
callbacks infer the accumulated dependency record, it does not need reflection,
and its factories may return values, functions, or promises. This experiment
does not manufacture an asynchronous initializer: SQLite opens synchronously.
The useful async flow is the real Plex OAuth operation injected into the
business function.

## Production composition

The application container is constructed once in `api.server.ts`. Registrations
are lazy and cached per container. Returning a function from a factory is how a
function-valued dependency is registered without executing the business
function during resolution.

```ts
const container = createContainer()
  .add({
    databaseResource: createProductionDatabaseResource,
    createClientIdentifier: () => createProductionClientIdentifier,
    startPlexAuth: () => startPlexAuthWithPlex,
  })
  .add((items) => ({
    applicationSettingsRepository: () =>
      items.databaseResource.applicationSettingsRepository,
  }))
  .add((items) => ({
    startPlexLogin: () => createStartPlexLogin({
      ...items.applicationSettingsRepository,
      createClientIdentifier: items.createClientIdentifier,
      startPlexAuth: items.startPlexAuth,
    }),
  }))
  .addDisposer({
    databaseResource: (resource) => resource.close(),
  });

const api = createApi({
  startPlexLogin: container.get("startPlexLogin"),
});
```

The database connection and its repository are grouped into one resource. That
keeps ownership obvious: the container creates it, consumers receive the narrow
repository, and the disposer closes it.

## Test composition and ceremony

### Unit

Unit-test ceremony is **low**: call the service factory with four plain
functions. There is no container, test module, token declaration, framework
mock, or reset hook.

```ts
const saved = new Map<string, string>();
const startPlexLogin = createStartPlexLogin({
  findApplicationSetting: (key) => {
    const value = saved.get(key);
    return value === undefined ? null : { value };
  },
  saveApplicationSetting: (key, value) => saved.set(key, value),
  createClientIdentifier: () => "test-client",
  startPlexAuth: async () => ({
    data: { authorizationUrl: "https://app.plex.tv/auth/test" },
  }),
});

expect(await startPlexLogin()).toBe("https://app.plex.tv/auth/test");
```

### Integration

Integration-test ceremony is **medium-low**: define one plain test layer at the
external boundary, construct the normal container, resolve the use case, and
pass it to the normal API factory. The checked-in integration test crosses
Elysia, the `iti` graph, the business function, persistence behavior, and an
async client fake.

```ts
const testLayer = {
  createDatabaseResource: () => ({
    applicationSettingsRepository: mapBackedRepository,
    close: () => { closeCalls += 1; },
  }),
  createClientIdentifier: () => "integration-client",
  startPlexAuth: async () => ({ data: { authorizationUrl } }),
};

const container = createBackendContainer(testLayer);
const api = createApi({
  startPlexLogin: container.get("startPlexLogin"),
});

const response = await api.handle(new Request(loginUrl));
```

A real SQLite integration test would instead omit `createDatabaseResource`, run
the committed migrations against a temporary database, and call the same
resolved function. That belongs in a Node-compatible integration lane: loading
and exercising the production `better-sqlite3` resource under Bun 1.3.14 caused
a native N-API crash during this experiment. The repository's existing
migration tests use Bun's separate SQLite driver or the SQLite container.

### Resource lifecycle

Lifecycle-test ceremony is **low**: resolve the resource so it is cached, call
`disposeAll`, and assert the fake close function ran. An unresolved resource is
not disposed by `iti`.

```ts
const { container, getCloseCalls } = createTestLayer();
container.get("databaseResource");

await container.disposeAll();

expect(getCloseCalls()).toBe(1);
```

Tests should use a fresh container per test and dispose it in `finally` whenever
the test resolves resources. `upsert` can replace registrations, but a fresh
test layer is more obvious and avoids cached-instance surprises.

## Type-safety failure modes

- A missing `items.someDependency` reference is a compile-time error because
  each chained `add` returns a new inferred container type.
- `get("unknownToken")` is rejected while the concrete container type is
  preserved. Duplicate keys passed to `add` are rejected by both types and a
  runtime check; `upsert` deliberately opts out of that protection.
- Factory return types flow into later registrations, including promises. A
  promise-producing registration must be awaited by its consumer.
- The safety is structural, not nominal. `any`, broad casts, an overly broad
  dependency interface, or exporting an erased `Container` type can bypass it.
- There is no separate typed token-to-interface contract. Property names are
  the tokens, so renames are safe through callback access but raw string calls
  are less refactor-friendly.
- Circular graphs and factory exceptions fail on first lazy resolution, not at
  container construction. There is no graph validation command.
- The official scaling guide acknowledges TypeScript's deep-instantiation
  failure on large chains and recommends fewer `add` steps/tokens or multiple
  containers ([patterns and known issue](https://itijs.org/patterns-and-tips/),
  [issue #42](https://github.com/molszanski/iti/issues/42)).

## Runtime, lifetime, and resource behavior

An `iti` factory is lazy and cached after first access: effectively one instance
per container. A factory that returns another function provides an explicit
transient factory; there are no named request or child-container scopes. For
Continuarr, request-specific data should remain ordinary function arguments,
not container registrations.

Promise-returning factories are cached immediately, so concurrent callers share
the same promise. A rejected promise remains cached; disposal awaits it and may
reject before clearing the cache, so recovery requires updating/deleting the
registration or rebuilding the container. This slice keeps async work inside
`startPlexLogin`, where each HTTP call must perform fresh network work, rather
than caching the OAuth result as a container item.

`disposeAll()` awaits disposers for resolved/cached items. The implementation
starts them together; it does not perform reverse dependency ordering. Disposing
one token does not walk its dependent graph, a limitation the official docs
state directly ([disposal guidance](https://itijs.org/api/#notes-on-disposing)).
Grouping the connection and repository into `databaseResource` makes one close
operation sufficient.

`api.server.ts` exports `disposeBackendResources`, but TanStack Start currently
does not call it from a checked-in shutdown hook. Production process teardown
will reclaim SQLite, but graceful shutdown and dev hot-reload cleanup remain
integration work before broad adoption.

One documentation/API mismatch deserves caution: the API page describes
`getSync` as returning a cached value or `undefined`, while the 0.8.0 type and
implementation resolve a cold registration and can return a promise. This
experiment avoids `getSync` ([API prose](https://itijs.org/api/#getsynctoken---get-item-synchronously-new-in-v080),
[implementation](https://github.com/molszanski/iti/blob/master/iti/src/iti.ts)).

## Dependency and bundle cost

The direct runtime dependency is `iti@0.8.0`; it declares one dependency,
`utility-types`. The current package declares `sideEffects: false` and uses
`utility-types` only from declarations, so normal bundlers can omit that helper
from runtime output ([package manifest](https://github.com/molszanski/iti/blob/master/iti/package.json)).

Measurements from the published 0.8.0 tarball on 2026-08-25:

| Item | Measured cost |
| --- | ---: |
| npm tarball | 24 KiB |
| npm reported unpacked size | 109,816 bytes |
| ESM runtime entry | 4,380 bytes raw / 1,399 bytes gzip |
| Declared transitive packages | 1 (`utility-types`) |

This is small, but the homepage's “~1kB” claim is more optimistic than the
current gzip measurement. The more important cost is contributor knowledge and
container-specific lifetime behavior, not download size. Package version and
dependency metadata are available on [npm](https://www.npmjs.com/package/iti).

## Debugging ergonomics

The composition chain is short, typed, and searchable; business stack traces
still name normal functions. `getTokens()` and item events offer basic runtime
visibility. Conversely, lazy factories move construction failures to the first
request, string property names appear in runtime errors, and there is no graph
visualizer or startup validation. Debuggers step through minified container
internals between registrations. Manual function composition remains easier to
trace for a graph this small.

## Scaling limits

Multiple feature containers can limit type depth and disposal blast radius, but
`iti` has no first-class request scope, child scope, tagged collection,
conditional registration, or disposal ordering. Large graphs increase chained
generic complexity; the official workaround is to group tokens or split
containers. Those constraints are acceptable for a small singleton-oriented
backend but become design work once Continuarr has per-request authentication,
background jobs, or several disposable clients.

## Migration cost

For this slice, migration requires one dependency, one composition-root file,
route factories, a service dependency record, a database-resource boundary,
and focused tests. The domain code becomes easier to test, but most of that gain
comes from the plain function factory and would also exist with manual DI.

Migrating the entire application now would be premature. A gradual migration is
possible: make a feature's functions injectable, register that feature at the
root, and leave unrelated imports untouched. Avoid calling the container from
business logic; doing so would turn gradual migration into a service locator.

## Official documentation scorecard

Scale: 1 = missing/misleading, 3 = usable with source reading, 5 = complete and
easy to trust. These scores intentionally evaluate maintenance suitability, not
whether the library can implement this demo.

| Category | Score | Evidence and notes |
| --- | ---: | --- |
| Getting-started clarity | 3/5 | The [quick start](https://itijs.org/quick-start/) makes install and basic resolution visible, but opens with React-oriented installation and explicitly says the docs are a work in progress. The end-to-end example is longer than the API itself. |
| Function-first examples | 2/5 | Registrations are plain function factories, but the [basic](https://itijs.org/basic-di/iti/) and [async](https://itijs.org/async-di/iti/) guides author class-based services. There is no substantial function-service backend example like this slice. |
| API reference completeness | 2/5 | The [API reference](https://itijs.org/api/) labels itself “work in progress”; `upsert` and `delete` have headings with almost no contract, and `getSync` prose conflicts with the shipped implementation. Source/types were required to confirm behavior. |
| Testing guidance | 1/5 | There is no testing section in the official guide navigation and no documented fake/override recipe. The repository has [runtime and type tests](https://github.com/molszanski/iti/tree/master/iti/tests), but those are maintainer tests rather than user guidance. |
| Lifecycle guidance | 3/5 | The [disposal section](https://itijs.org/api/#disposing) includes sync/async examples and candidly says dependent graphs are not disposed. It omits ordering, rejection behavior, shutdown integration, and request-scope recipes. |
| Currency and maintenance signals | 3/5 | [0.8.0 was released in October 2025](https://github.com/molszanski/iti/releases/tag/0.8.0), and the [commit history](https://github.com/molszanski/iti/commits/master/) shows a February 2026 commit. That is current enough to evaluate, but releases are infrequent, the ecosystem is small, and documentation gaps remain months later. |
| Time to find needed APIs | 3/5 | `createContainer`, `add`, and `get` were findable from the quick start in under two minutes; disposer APIs took about four minutes via the API page. After ten minutes across the guide, site search, and repository, no consumer testing guide or graceful-shutdown recipe was found. |

Overall documentation score: **17/35 (2.4/5)**. The core is discoverable, but
the docs are not sufficient on their own for confident long-term maintenance;
developers must verify types, source, and tests.

## Recommendation

**Do not adopt `iti` as Continuarr's default DI approach yet.** It meets the
function-first and type-safety requirements for this slice, stays tiny, and has
a pleasantly low unit-test cost. The library is a credible option, not a failed
prototype.

The candid problem is leverage: the plain factory refactor provides nearly all
of today's testing benefit, while `iti` adds lazy-cache and disposal semantics
that the team must learn from incomplete documentation. Manual function DI is
the better default at Continuarr's current graph size. Reconsider a container
when repeated resource ownership or multiple implementations make composition
materially painful; if that happens, weigh `iti`'s small API against the other
experiment options' documentation, scopes, validation, and maintenance depth.
