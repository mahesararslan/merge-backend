import { registerAs } from "@nestjs/config";
import * as path from "path";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

export default registerAs("dbconfig.dev", (): PostgresConnectionOptions => {
    const poolerUrl = process.env.DB_URL || "";

    // TypeORM's synchronize uses DDL (ALTER TABLE, CREATE TYPE) which are
    // session-level operations. Neon's pooler (PgBouncer in transaction mode)
    // can route these DDL statements to a different backend than subsequent
    // queries, causing intermittent "column does not exist" errors.
    // Use the direct connection URL (no pooler) so all DDL and schema
    // introspection stay on the same backend connection.
    const directUrl = process.env.DB_DIRECT_URL
        || poolerUrl.replace('-pooler.', '.').replace('channel_binding=require', '').replace(/[?&]$/, '');

    return {
        url: directUrl,
        type: 'postgres',
        entities: [path.join(__dirname, '..', 'entities', '*.entity{.ts,.js}')],
        synchronize: true,
    };
});