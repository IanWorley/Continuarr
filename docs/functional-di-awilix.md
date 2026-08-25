# Function-first dependency injection with Awilix

This experiment applies Awilix 13.0.5 to one backend slice: the health route. It
keeps the health service and request context as plain factory functions. Awilix
appears only in the composition root, while the HTTP controller is the only code
that creates and reads a request scope.

```ts
const container = createContainer<ApplicationCradle>({
  injectionMode: InjectionMode.PROXY,
  strict: true,
}).register({
  healthService: asFunction(createHealthService).singleton(),
  requestContext: asFunction(createRequestContext).scoped(),
})

const requestScope = container.createScope()
const { healthService, requestContext } = requestScope.cradle
```

The proxy injection mode passes a named dependency object to each factory. It is
minification-safe and makes direct tests readable: `createHealthService({
applicationName: "test" })`. The health service is a singleton because it is
stateless and only captures application configuration. The request context is
scoped so one generated request ID is reused inside a request and never crosses
into another request. Strict mode rejects unsafe lifetime relationships when a
registration is resolved.

## Comparison

| Area | Assessment |
| --- | --- |
| Ergonomics | Registrations are compact and require no classes or decorators. The composition root and per-request scope are extra concepts compared with calling factories manually. |
| Type safety | Factory parameters, returned services, the cradle, and registration outputs are typed. Awilix does not statically prove that a factory's dependency names match registrations, so missing names remain resolution-time errors. |
| Runtime behavior | Resolution is lazy. Proxy injection resolves dependencies when factories read named properties; business code receives ordinary objects and functions. Strict mode adds runtime checks for lifetime leaks. |
| Lifetimes | Transient, scoped, and singleton lifetimes are built in. This is the strongest advantage over a hand-written object graph when request-local state grows. |
| Costs | Awilix and its transitive packages become production dependencies, and container resolution adds runtime indirection. Registrations also duplicate some relationships already visible in TypeScript signatures. This experiment does not use module auto-loading. |
| Bad fit | Prefer manual factory composition while the graph stays small, request scoping is rare, or compile-time validation of the entire graph matters more than runtime flexibility. Avoid it in hot paths until resolution overhead is measured. |

For this slice, Awilix earns a comparison because request scope creation,
singleton reuse, and test replacement are visible in a small amount of code. It
does not yet establish that the whole application should adopt a container; the
added dependency is hard to justify if the backend graph remains this small.

The API choices above follow the package's shipped type declarations and the
[Awilix README](https://github.com/jeffijoe/awilix#readme), especially its
sections on function resolvers, injection modes, strict mode, and scoped
lifetimes.
