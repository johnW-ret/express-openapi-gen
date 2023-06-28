import express from 'express';

export const fruitRouter = express.Router();

export const chainedFruit = (req, res) => {
    res.send("carrot");
};

fruitRouter.post("/banana",
    /**
     * @param {express.Request<{}, string, {count: number}>} req 
     */
    (req, res) => {
        res.send([...Array(req.body.count)].map(_ => "🍌").join(''));
    });

fruitRouter.get("/orange",
    (req, res) => {
        res.send("🍊");
    });