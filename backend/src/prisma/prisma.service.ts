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
      CREATE TABLE IF NOT EXISTS "prices" (
        "id" BIGSERIAL PRIMARY KEY,
        "symbol" VARCHAR(20) NOT NULL,
        "t" TIMESTAMP(3) NOT NULL,
        "o" NUMERIC(18,4) NOT NULL,
        "h" NUMERIC(18,4) NOT NULL,
        "l" NUMERIC(18,4) NOT NULL,
        "c" NUMERIC(18,4) NOT NULL,
        "v" BIGINT
      );
    `);

    await this.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "prices_symbol_t_key" ON "prices" ("symbol", "t");',
    );
    await this.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "prices_symbol_t_idx" ON "prices" ("symbol", "t");',
    );
    await this.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "prices_t_idx" ON "prices" ("t");');

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

    await this.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        "id" BIGSERIAL PRIMARY KEY,
        "email" VARCHAR(255) NOT NULL,
        "passwordHash" VARCHAR(255) NOT NULL,
        "displayName" VARCHAR(120),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await this.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User" ("email");');

    await this.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Holding" (
        "id" BIGSERIAL PRIMARY KEY,
        "userId" BIGINT NOT NULL,
        "symbol" VARCHAR(20) NOT NULL,
        "buyPrice" NUMERIC(18,4) NOT NULL,
        "qty" INTEGER NOT NULL,
        "targetPrice" NUMERIC(18,4),
        "stopLoss" NUMERIC(18,4),
        "notes" VARCHAR(280),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Holding_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);
    await this.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Holding_userId_idx" ON "Holding" ("userId");');
    await this.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Holding_userId_symbol_idx" ON "Holding" ("userId", "symbol");',
    );

    await this.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await this.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'set_user_updated_at'
        ) THEN
          CREATE TRIGGER set_user_updated_at
          BEFORE UPDATE ON "User"
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at_timestamp();
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'set_holding_updated_at'
        ) THEN
          CREATE TRIGGER set_holding_updated_at
          BEFORE UPDATE ON "Holding"
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at_timestamp();
        END IF;
      END
      $$;
    `);

    await this.$executeRawUnsafe('ALTER TABLE trades ADD COLUMN IF NOT EXISTS user_id BIGINT;');
    await this.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS trades_user_id_idx ON trades (user_id);');

    this.logger.log('Ensured Prisma scrape tables exist.');
  }
}
