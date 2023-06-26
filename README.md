express-openapi-gen
===================

A tool that generates an OpenAPI definition directly from your [express](https://github.com/expressjs/express) routes at runtime. Works best with [swagger-ui-express](https://github.com/scottie1984/swagger-ui-express) as such or similar tools.

index.ts
```javascript
import express from 'express';
import { generateSwaggerDoc } from 'express-openapi-gen';
import swaggerUi from 'swagger-ui-express';

const app = express();

app.get("/banana",
// use JSDoc for JS
(req: express.Request<{}, {}, number>, res) => {
    res.send([...Array(req.body)].map(_ => "🍌"));
});

// uses process.argv[1] or you can pass the relative path from your package.json
const swaggerDocument = generateSwaggerDoc();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))
```
See [examples](/examples) for more detailed examples.

---

# Features
- Works with JavaScript and TypeScript

# Requirements
- Requires [@types/express](https://www.npmjs.com/package/@types/express) (in `devDependencies` at a minimum). This does not require installing TypeScript.

# Limitations
- Routing that is not syntax analyzable will not be recognized (runtime code generation).
- Certain uses will cause detection to fail, such referencing an `express` instance higher up in the source file than where it is defined (such as with a method), or creating endpoints with loops. However, patterns that do not involve calls and jumps should work fine, such as the below "fluent" example.

    ```javascript
    express()
        .get("/banana", () => "🍌")
        .use("/api",
            express()
                .get("/snake", () => "🐍")
                .get("/carrot", () => "🥕"))
        .use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))
        .use(express.static("swagger"))
        .listen(80);
    ```
    This behavior may change in a future version.
- No support for tags, descriptions, or additional metadata. This behavior will ideally change in a future version, though you can merge the generated schema with your own descriptive data.

## Todo
- Only recognizes `get` endpoints (add support for all HTTP method types)
- Only recognizes routes in the single source file detected or passed (allow passing glob path of source files with routes or auto-detect)
- Types referenced are not added to the definition `schema` (auto-generate `schema` from involved types)

---

This package was inspired by [Swashbuckle.AspNetCore](https://github.com/domaindrivendev/Swashbuckle.AspNetCore)