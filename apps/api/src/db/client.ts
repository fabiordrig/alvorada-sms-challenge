import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import * as relations from './relations';
import { config } from '../config';

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export type DB = typeof db;
