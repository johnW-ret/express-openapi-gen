import express from 'express';

export const fruitRouter = express.Router();

fruitRouter.get("/orange",
(req, res) => {
    res.send("🍊");
});