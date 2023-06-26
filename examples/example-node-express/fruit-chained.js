import express from 'express';

export const fruitRouter = express.Router();

fruitRouter.get("/banana",
/**
 * @param {express.Request<{},{}, number>} req 
 */
(req, res) => {
    res.send([...Array(req.body)].map(_ => "🍌"));
});

fruitRouter.get("/orange",
(req, res) => {
    res.send("🍊");
});