import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';
import * as relations from './relations.ts';
import { config } from '../config.ts';

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
export const db = drizzle(pool, { schema: { ...schema, ...relations } });
export type DB = typeof db;
