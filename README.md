express-openapi-gen
===================

A tool that generates an OpenAPI definition directly from your [express](https://github.com/expressjs/express) routes at runtime. Works best with [swagger-ui-express](https://github.com/scottie1984/swagger-ui-express) as such or similar tools.

- See the [package README](src/README.md) for a quick-start and information on features and limitations.
- See [examples](examples) for JavaScript and TypeScript examples.

# Todo 📋
- No support for query parameters (add support for query parameters)
- Only first level properties of types are added to the `schema`
- Types referenced are not added to the definition `components/schema` and are generated for each method (auto-generate `components/schema` from involved types)

---

This package was inspired by [Swashbuckle.AspNetCore](https://github.com/domaindrivendev/Swashbuckle.AspNetCore)