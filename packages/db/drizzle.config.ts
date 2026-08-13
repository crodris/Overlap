import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations require a direct (unpooled) connection: they run DDL and rely
    // on session state, which transaction pooling does not preserve. On Neon,
    // pooled and direct differ by HOSTNAME, not by port - the pooled endpoint
    // carries a `-pooler` suffix while the direct one does not, and both use
    // port 5432. See packages/db/src/client.ts for the full explanation.
    url:
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/overlap',
  },
})
