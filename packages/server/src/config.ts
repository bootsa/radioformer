import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  WEB_DIR: z.string().default('../../apps/web/build'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Token for changing stations through the API. Without it the API is read-only. */
  ADMIN_TOKEN: z.string().min(16).optional(),
  /** Base URL the radios use to reach this server, e.g. http://192.168.222.241:8080 (default: the Host header). */
  PUBLIC_URL: z.url().optional(),
  /** Let the stream proxy reach private addresses (LAN sources). */
  ALLOW_PRIVATE_UPSTREAMS: bool,
  MAX_STREAMS: z.coerce.number().int().min(1).max(100).default(8),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
