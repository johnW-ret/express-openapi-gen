express-openapi-gen
===================

A tool that generates an OpenAPI definition directly from your [express](https://github.com/expressjs/express) routes at runtime. Works best with [swagger-ui-express](https://github.com/scottie1984/swagger-ui-express) as such or similar tools.

index.ts
```typescript
import express from 'express';
import { generateSwaggerDoc } from 'express-openapi-gen';
import swaggerUi from 'swagger-ui-express';

const app = express();

app.use(express.json());

app.get("/banana/:count",
    // use JSDoc for JS
    (req: express.Request<{ count: string }, string>, res) => {
        res.send([...Array(Number(req.params.count))].map(_ => "🍌").join(''));
    });

// uses process.argv[1] or you can pass the relative path from your package.json
const swaggerDocument = generateSwaggerDoc();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))
```
See [examples](/examples) for more detailed examples.

---

# Features ✨
- Works with JavaScript and TypeScript
  - No types? No problem. Missing types appear as empty `object`s
- Supports summaries, descriptions, and tags
    ```typescript
    /** 
     * @summary A collection of endpoints that return tasty snacks.
     * @description This collection of endpoints can return a wide variety of fruits of different flavors and colors. The response will always be a single emoji string, and the endpoints take no parameters.
     * @tags fruit
     */
    app.use("/fruit", fruit);

    /** @tags yellow */
    fruit.get("/banana", (req, res) => res.send("🍌"));
    fruit.get("/orange", (req, res) => res.send("🍊"));
    /** @tags yellow, sour */
    fruit.get("/lemon", (req, res) => res.send("🍋"));

    const swaggerDocument = generateSwaggerDoc();
    swaggerDocument.tags = [{
        name: "fruit",
        description: "A collection of endpoints that return tasty snacks.",
        externalDocs: {
            description: "Find out more",
            url: "https://en.wikipedia.org/wiki/Fruit"
        }
    }];

    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
    app.use(express.static("swagger"));
    ```

# Requirements ❗
- Requires [@types/express](https://www.npmjs.com/package/@types/express) (in `devDependencies` at a minimum). This does not require installing TypeScript.

# Limitations ⚠️
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
- No support for custom response headers (uses `default`). This behavior may change in a future version.
- Only supports `application/json` content type. This behavior may change in a future version.
- No support for operation ids, links, or additional metadata (No full specification support). This behavior will ideally change in a future version, though you can merge the generated schema with your own descriptive data.
- See more limitations at the [project's GitHub README's Todo list](https://github.com/johnW-ret/express-openapi-gen#todo-).

---

This package was inspired by [Swashbuckle.AspNetCore](https://github.com/domaindrivendev/Swashbuckle.AspNetCore)