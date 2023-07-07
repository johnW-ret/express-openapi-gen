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

/**
 * @summary This is a demonstration of a router with authentication middleware. It does not actually authenticate anything.
 * @tags private
 */
app.use("/private", /** authMiddleware, */express.Router().use("/examples", examples));

/**
 * @tags examples
 */
app.use("/examples", examples);

const fruit = express.Router();
app.use("/fruit", fruit);

// document parameters on single handlers...
/**
 * @tags fruit
 */
fruit.get("/banana",
    /**
     * @param {express.Request<{}, string>} req 
     */
    (req, res) => {
        res.send("🍌");
    });

// ...or document a handler for concise type checking
// note that your handler types must all agree
// unfortunately, I have not found a way to pass type arguments to the IRouterMatcher function itself
/** @tags person */
api.post("/person",
    /** @type {express.RequestHandler<{}, { name: string, age: number }, {}>} */
    (req, res) => {
        res.send({ name: "joe", age: 30 });
    },
    (req, res) => {
        // req.params.id;
        res.send({ name: "joe", color: "red" });
    });

/** @tags SSSSsssss...🐍 */
api.put("/snake",
    (req, res) => {
        res.send("🐍");
    });

api.get("/carrot",
    (req, res) => {
        res.send("🥕");
    });

const pet = express.Router();
app.use("/pet", pet);

/**
 * @typedef Pet
 * @property {number} id
 * @property {string} name
 * @property {Category} category
 * @property {string[]} photoUrls
 * @property {object[]} tags
 * @property {number} tags.id
 * @property {string} tags.name
 * @property {string} status
 */

/**
 * @typedef Category
 * @property {number} id
 * @property {string} name
 */

pet.get("/example",
    /** @type {express.RequestHandler<{}, Pet>} */
    (req, res) => {
        res.send({
            "id": 0,
            "name": "doggie",
            "category": {
                "id": 1,
                "name": "Dogs"
            },
            "photoUrls": [
                "string"
            ],
            "tags": [
                {
                    "id": 0,
                    "name": "string"
                }
            ],
            "status": "available"
        });
    });

/**
* @typedef Node
* @property {Node[]} branches
* @property {number} value
*/

// works with recursive types (though Swagger UI currently has issues rendering them well)
api.get("/tree",
    /** @type {express.RequestHandler<{}, Node>} */
    (req, res) => {
        res.send({ value: 4, branches: [{ value: 5, branches: [] }] });
    });

// works with route parameters 
// currently, route parameters must be strings due to the way express works
api.get("/snake/:a/and/:b",
    (req, res) => {
        res.send([...Array(Number(req.params.a) * Number(req.params.b))].map(_ => "🐍").join(''));
    });

/**
 * @description This is an endpoint that tells the user their name given their first and last name. The point of this this description is to be a very long example description.
 * @summary Tell a user their name given their first and last names.
 * @tags person
 */
// nullable route parameters map to optional parameters
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
/**
 * @tags export-fruit, fruit
 */
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
swaggerDocument.tags = [{
    name: "fruit",
    description: "A collection of endpoints that return tasty snacks.",
    externalDocs: {
        description: "Find out more",
        url: "https://en.wikipedia.org/wiki/Fruit"
    }
},
{
    name: "examples",
    description: "A collection of example endpoints."
}];

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))

app.listen(80);