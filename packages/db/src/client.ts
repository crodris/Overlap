import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// For query purposes
const queryClient = postgres(connectionString)

// For migrations
export const migrationClient = postgres(connectionString, { max: 1 })

export const db = drizzle(queryClient, { schema })

export type Database = typeof db
