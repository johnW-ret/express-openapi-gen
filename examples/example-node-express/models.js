import { Association, DataTypes, Model, Sequelize } from "sequelize";

const sequelize = new Sequelize("sqlite::memory:");

/** @extends {Model<import("sequelize").InferAttributes<Basket>, import("sequelize").InferCreationAttributes<Basket>>} */
export class Basket extends Model {
    /** @type {number} */
    size;
    /** @type {string} */
    color;
    /** @type {Date} */
    createdOn;

    /** @type {import("sequelize").NonAttribute<Handle> | null} */
    handle;

    /** @type {{route: Association<Basket, Handle>}} */
    static associations;

    func = () => { };
}

/** @extends {Model<import("sequelize").InferAttributes<Handle>, import("sequelize").InferCreationAttributes<Handle>>} */
export class Handle extends Model {
    /** @type {number} */
    length;

    func = () => { };
}

Basket.init({
    size: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    color: {
        type: DataTypes.STRING
    }
}, { sequelize });