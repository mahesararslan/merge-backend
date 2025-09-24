import * as path from "path";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

export default (): PostgresConnectionOptions => ({
    url: process.env.DB_URL || "",
    type: 'postgres',
    port: Number(process.env.DB_PORT) || 5432, 
    entities: [path.join(__dirname, '..', 'entities', '*.entity{.ts,.js}')], 
    synchronize: false, // only for development, set to false when in production
})