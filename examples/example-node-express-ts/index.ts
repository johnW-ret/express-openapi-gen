import express from 'express';

import { generateSwaggerDoc } from 'openapi-gen';
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

const swaggerDocument = generateSwaggerDoc("index.ts");

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(express.static("swagger"))

app.listen(80);