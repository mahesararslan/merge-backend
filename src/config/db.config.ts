import { registerAs } from "@nestjs/config";
import * as path from "path";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

export default registerAs("dbconfig.dev", (): PostgresConnectionOptions => ({
    url: process.env.DB_URL || "",
    type: 'postgres',
    port: Number(process.env.DB_PORT) || 5432, // PostgreSQL default port
    entities: [path.join(__dirname, '..', 'entities', '*.entity{.ts,.js}')], // Direct path to entities folder
    synchronize: true, // only for development, set to false when in production
}));