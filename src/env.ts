import 'dotenv/config';
import { createEnv } from "@t3-oss/env-core";
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),
    DISCORD_WEBHOOK_URL: z.string(),
    DISCORD_BOT_TOKEN: z.string(),
    REVERSE_PROXY_URL: z.string(),
    DISCORD_CDN_URL: z.string(),
    DISCORD_CDN_USER_ID: z.string(),
    DISCORD_CDN_USER_SECRET: z.string(),
    OSU_COOKIE: z.string(),
    OSU_API_TOKEN: z.string(),
    PORT: z.coerce.number().default(3000),
    HOSTNAME: z.string().default('0.0.0.0'),
    // Sentry
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.enum(['local', 'production']).default('local'),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  },
  client: {},
  runtimeEnv: process.env,
  clientPrefix: '',
});
