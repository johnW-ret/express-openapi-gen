// @ts-check

import express from 'express';
import { generateSwaggerDoc } from 'express-openapi-gen';
import swaggerUi from 'swagger-ui-express';
import { fruitRouter as exportFruitRouter, chainedCarrot } from './fruit.js';
import exportDefaultGrape from './exportDefaultGrape.js';

const app = express();

app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: true }));

const api = express.Router();
const examples = express.Router();
app.use("/examples", examples);

const fruit = express.Router();
app.use("/fruit", fruit);

// document parameters on single handlers...
fruit.get("/banana",
    /**
     * @param {express.Request<{}, string>} req 
     */
    (req, res) => {
        res.send("🍌");
    });

// ...or document a handler for concise type checking
// note that your handler types must all agree
// unfrotunately, I have not found a way to pass type arguments to the IRouterMatcher function itself
api.post("/person",
    /** @type {express.RequestHandler<{}, { name: string, age: number }, {}>} */
    (req, res) => {
        res.send({ name: "joe", age: 30 });
    },
    (req, res) => {
        // req.params.id;
        res.send({ name: "joe", color: "red" });
    });

api.put("/snake",
    (req, res) => {
        res.send("🐍");
    });

api.get("/carrot",
    (req, res) => {
        res.send("🥕");
    });

// type your route parameters and return types
api.get("/snake/:a/and/:b",
    /** @type {express.RequestHandler<{a: string, b: string}, {}>} */
    (req, res) => {
        res.send([...Array(Number(req.params.a) * Number(req.params.b))].map(_ => "🐍").join(''));
    });


api.get("/my-name/:first?/:last?",
    (req, res) => {
        res.send(`Your name is ${req.params.first} ${req.params.last}`);
    });

// example using handlers
/**
 * Returns an object with the properties `name` and `age`.
 * @param {express.Request<{}, { name: string, age: number }>} req
 * @param {express.Response<{ name: string, age: number }>} res
 */
function handlerWhichSends(req, res) {
    res.send({ name: "joe", age: 5 });
}

examples.get("function-handler", handlerWhichSends);

// example using function which generates a handler
/**
 * Returns an object with the properties `name` and `age`.
 * @param {express.Request} req - The request object.
 * @param {express.Response} res - The response object.
 * @returns {{ name: string, age: number }} - An object with the properties `name` and `age`.
 */
function handlerWhichReturnsInsteadOfSends(req, res) {
    return { name: "joe", age: 5 };
}

function generateResponseFunction(func) {
    return (req, res) => {
        res.send(func(req, res));
    }
}

// note that, unfortunately, the type of the handler is not inferred from the type of the function
examples.get("/generated-function-handler", generateResponseFunction(handlerWhichReturnsInsteadOfSends));

// example using export functions
examples.get("/export-carrot", chainedCarrot);

// example using default export functions
examples.get("/export-default-grape", exportDefaultGrape);

// example using export routers
examples.use("/export-fruit", exportFruitRouter);

// example using a 'fluent' api
examples.use("/methods", express.Router()
    .post("/post", (req, res) => { res.send("🙂") })
    .put("/put", (req, res) => { res.send("🙂") })
    .delete("/delete", (req, res) => { res.send("🙂") })
    .patch("/patch", (req, res) => { res.send("🙂") })
    .options("/options", (req, res) => { res.send("🙂") })
    .head("/head", (req, res) => { res.send("🙂") })
);

app.use("/api", api);

const swaggerDocument = generateSwaggerDoc();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))

app.listen(80);