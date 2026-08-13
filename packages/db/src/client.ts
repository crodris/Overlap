import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Supabase Supavisor transaction pooler (port 6543) cannot use prepared statements.
//
// `max` and `idle_timeout` matter as much as `prepare: false` here. Each warm
// serverless instance holds its own postgres-js pool for its lifetime; the
// postgres-js default (`max: 10`, no `idle_timeout`) means every instance
// keeps up to 10 pooler connections open indefinitely, even when idle.
// Supavisor's transaction pooler has a fixed connection budget (e.g. 200 on
// Supabase's smaller tiers), so roughly `200 / max` concurrent warm instances
// exhausts it - at `max: 10` that is only ~20 instances, and every route
// (including the GitHub webhook) starts failing to acquire a connection.
//
//  - `max: 3` keeps a single instance's worst case (three concurrent queries
//    in flight on one invocation) well below what this app ever does
//    concurrently per request, while raising the number of warm instances
//    the pooler budget can support roughly 3x over the default.
//  - `idle_timeout: 10` (seconds) releases connections back to the pooler
//    shortly after a burst of activity ends instead of holding them for the
//    lifetime of the instance, so idle warm instances stop costing pooler
//    slots at all.
const queryClient = postgres(connectionString, {
  prepare: false,
  max: 3,
  idle_timeout: 10,
})

// Migrations require session mode, so they use the direct connection (port 5432).
const directConnectionString = process.env.DIRECT_URL || connectionString

export const migrationClient = postgres(directConnectionString, {
  max: 1,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

export type Database = typeof db
