import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// DATABASE_URL must be the POOLED connection string.
//
// On Neon, pooled and direct differ by HOSTNAME, not by port: the pooled
// endpoint carries a `-pooler` suffix (`ep-xxx-pooler.region.aws.neon.tech`)
// while the direct one does not. Both use 5432. This is worth stating because
// the more common Supabase shape distinguishes them by port (6543 vs 5432),
// and a connection string that looks right can silently be the wrong one.
//
// `prepare: false` is set because the pooler runs PgBouncer in transaction
// mode. Neon's PgBouncer does support protocol-level prepared statements, so
// this is conservative rather than strictly required; it is kept because it
// is known-safe under transaction pooling and the performance difference is
// immaterial at this workload's query volume. Do not remove it without
// testing under real concurrency, since the failure mode is intermittent
// `prepared statement "s1" already exists` rather than a clean error.
//
// `max` and `idle_timeout` bound what each warm serverless instance holds.
// The postgres-js defaults (`max: 10`, no `idle_timeout`) mean an instance
// keeps up to 10 pooler connections open for its entire lifetime, even while
// idle. Neon's pooler tolerates far more client connections than a Supavisor
// tier would (thousands rather than hundreds), so exhaustion is unlikely
// here - but an unbounded idle pool is wasteful regardless, and these values
// keep the app portable to a pooler with a tighter budget.
//
//  - `max: 3` sits above anything a single request does concurrently.
//  - `idle_timeout: 10` (seconds) returns connections after a burst instead
//    of holding them for the life of the instance.
const queryClient = postgres(connectionString, {
  prepare: false,
  max: 3,
  idle_timeout: 10,
})

// Migrations need a direct (unpooled) connection: they run DDL and rely on
// session state, which transaction pooling does not preserve. On Neon that
// means the endpoint WITHOUT the `-pooler` suffix.
const directConnectionString = process.env.DIRECT_URL || connectionString

export const migrationClient = postgres(directConnectionString, {
  max: 1,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

export type Database = typeof db
