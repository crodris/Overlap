import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Supabase Supavisor transaction pooler (port 6543) cannot use prepared statements.
const queryClient = postgres(connectionString, { prepare: false })

// Migrations require session mode, so they use the direct connection (port 5432).
const directConnectionString = process.env.DIRECT_URL || connectionString

export const migrationClient = postgres(directConnectionString, {
  max: 1,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

export type Database = typeof db
