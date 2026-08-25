# Functional dependency injection experiment

This experiment adapts the Plex login-start slice with ordinary TypeScript. A
typed dependency record describes what each repository, client, and service
needs. Their factories close over those dependencies, and `createApi()` is the
composition root that builds an application scope and returns only the API.
There is no container, decorator, reflection, or global service locator.

```ts
interface PlexLoginServiceDependencies {
  repository: PlexLoginRepository;
  client: PlexLoginClient;
  createClientIdentifier: () => string;
}

const repository = createPlexLoginRepository({
  findApplicationSetting,
  saveApplicationSetting,
});
const client = createPlexLoginClient({ startPlexAuth });
const service = createPlexLoginService({
  repository,
  client,
  createClientIdentifier: () => crypto.randomUUID(),
});
```

## Comparison with a container

| Concern | Function factories | DI container |
| --- | --- | --- |
| Ergonomics | Plain imports, records, and calls; navigation and tests stay direct. Wiring becomes repetitive as the graph grows. | Central registrations reduce repeated wiring, but add container APIs and indirection. |
| Type safety | TypeScript checks every dependency at the factory call site without tokens or casts. | Depends on the library; string or symbol registrations can weaken static checks. |
| Runtime behavior | Construction is normal JavaScript with no reflection or resolution errors. | The container resolves a graph at runtime and may report missing or cyclic registrations only then. |
| Lifetime and resources | Each `createApi()` call scopes its repository, client, service, and routes to that API instance. Database connections and cached SDK clients remain application-lived resources. Request-scoped values can use another factory; disposal still needs explicit `try/finally` or a close function. | Mature containers can automate singleton, request, and transient scopes plus disposal. |
| Costs | No dependency, metadata, bootstrap convention, or container-specific testing helpers. | Adds a package, conventions, startup work, and a concept contributors must learn. |
| Scaling limits | Large graphs can create long dependency records, repeated forwarding, and a crowded composition root. | Registration modules and scope management can make large, dynamic graphs easier to organize. |

A real container becomes justified when Continuarr has enough independently
configured implementations or scoped/disposable resources that manual wiring is
repeated and error-prone. For this slice, the direct factory approach meets the
requirements with less machinery and lets tests replace dependencies with plain
functions.
