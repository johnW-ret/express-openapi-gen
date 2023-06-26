import express from 'express';

import { generateSwaggerDoc } from 'express-openapi-gen';
import swaggerUi from 'swagger-ui-express';

const app = express();
const api = express.Router();

app.get("/banana",
(req: express.Request<{}, {}, number>, res) => {
    res.send("banana");
});

app.use("/api", api);

api.get("/snake",
(req: express.Request<{}, {}, string>, res) => {
    res.send("snake");
});

api.get("/carrot", 
(req, res) => {
    res.send("carrot");
});

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