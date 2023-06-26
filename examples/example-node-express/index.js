// @ts-check

import express from 'express';
import { generateSwaggerDoc } from 'express-openapi-gen';
import swaggerUi from 'swagger-ui-express';
import { fruitRouter } from './fruit.js';
   
const app = express();
const api = express.Router();

app.get("/banana",
/**
 * @param {express.Request<{},{}, number>} req 
 */
(req, res) => {
    res.send("banana");
});

app.use("/api", api);

api.get("/snake",
(req, res) => {
    res.send("snake");
});

api.get("/carrot", 
/**
 * 
 * @param {{body: {string}}} req 
 * @param {any} res 
 */
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

api.use("/fruit", fruitRouter);

const swaggerDocument = generateSwaggerDoc();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))

app.listen(80);