import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI usa la conexión directa; PrismaService utiliza DATABASE_URL.
    url: process.env.DIRECT_URL?.trim() || env('DATABASE_URL'),
  },
});
