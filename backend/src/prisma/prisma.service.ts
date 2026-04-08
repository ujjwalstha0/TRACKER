import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function ensureDatabaseUrl(): void {
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;

  if (!user || !password || !database) {
    return;
  }

  const host = process.env.DB_HOST ?? 'tracker-db';
  const port = process.env.DB_PORT ?? '5432';

  process.env.DATABASE_URL =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${database}`;
}

ensureDatabaseUrl();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.ensureScrapeTables();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private async ensureScrapeTables(): Promise<void> {
    await this.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Price" (
        "id" BIGSERIAL PRIMARY KEY,
        "symbol" VARCHAR(20) NOT NULL,
        "company" VARCHAR(255),
        "sector" VARCHAR(100),
        "ltp" NUMERIC(18,4) NOT NULL,
        "change" NUMERIC(18,4),
        "changePct" NUMERIC(10,4),
        "open" NUMERIC(18,4),
        "high" NUMERIC(18,4),
        "low" NUMERIC(18,4),
        "volume" BIGINT,
        "turnover" NUMERIC(22,4),
        "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Price_symbol_key" ON "Price" ("symbol");',
    );
    await this.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Price_savedAt_idx" ON "Price" ("savedAt");',
    );

    await this.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "IndexValue" (
        "id" BIGSERIAL PRIMARY KEY,
        "indexName" VARCHAR(80) NOT NULL,
        "value" NUMERIC(18,4) NOT NULL,
        "change" NUMERIC(18,4) NOT NULL,
        "changePct" NUMERIC(10,4) NOT NULL,
        "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IndexValue_indexName_key" ON "IndexValue" ("indexName");',
    );
    await this.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "IndexValue_savedAt_idx" ON "IndexValue" ("savedAt");',
    );

    this.logger.log('Ensured Prisma scrape tables exist.');
  }
}
