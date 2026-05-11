import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TWILIO_USE_MOCK: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  TWILIO_MOCK_DELAY_MIN: z.coerce.number().default(3000),
  TWILIO_MOCK_DELAY_MAX: z.coerce.number().default(15000),
  TWILIO_MOCK_FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_VALIDATE_SIGNATURE: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  TWILIO_WEBHOOK_URL: z.string().optional(),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
