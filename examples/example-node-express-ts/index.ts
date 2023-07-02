import express from 'express';

import { generateSwaggerDoc } from 'express-openapi-gen';
import swaggerUi from 'swagger-ui-express';

const app = express();

app.use(express.json());
app.use(express.text());
app.use(express.urlencoded({ extended: true }));

const api = express.Router();

app.get("/banana/:count",
    (req: express.Request<{ count: string }, string>, res) => {
        res.send([...Array(Number(req.params.count))].map(_ => "🍌").join(''));
    });

api.post("/any",
    (req, res) => {
        res.send({ name: "joe", age: 5 });
    });

api.get("/snake",
    (req: express.Request<{}, {}, string, number>, res) => {
        res.send("snake");
    });

api.get("/carrot",
    (req, res) => {
        res.send("carrot");
    });

app.use("/api", (req, res) => { return 0; }, api);

api.use("/methods", express.Router()
    .post("/post", (req, res) => { res.send("🙂") })
    .put("/put", (req, res) => { res.send("🙂") })
    .delete("/delete", (req, res) => { res.send("🙂") })
    .patch("/patch", (req, res) => { res.send("🙂") })
    .options("/options", (req, res) => { res.send("🙂") })
    .head("/head", (req, res) => { res.send("🙂") })
);

const swaggerDocument = generateSwaggerDoc();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))

app.listen(80);