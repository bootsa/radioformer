import { z } from 'zod';

/** Compose files often pass unset variables as empty strings: treat those as not set. */
const blank = (v: unknown) => (v === '' ? undefined : v);

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  WEB_DIR: z.string().default('../../apps/web/build'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Token for changing stations through the API. Without it the API is read-only. */
  ADMIN_TOKEN: z.preprocess(blank, z.string().min(16).optional()),
  /** Base URL the radios use to reach this server, e.g. http://192.168.222.241:8080 (default: the Host header). */
  PUBLIC_URL: z.preprocess(blank, z.url().optional()),
  /** Let the stream proxy reach private addresses (LAN sources). */
  ALLOW_PRIVATE_UPSTREAMS: bool,
  /** Port for the radio's control interface as seen by other apps (0 = off). */
  FSAPI_FACE_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  /** PIN the apps use on that face; the radio's own default is 1234. */
  FSAPI_FACE_PIN: z.string().regex(/^\d{4}$/).default('1234'),
  /** The name apps see (empty: the radio's name plus a "+"). */
  FSAPI_FACE_NAME: z.string().max(60).default(''),
  /** Where apps outside the radio's DNS can load pictures (e.g. http://192.168.222.241:8081). Empty: no rewriting. */
  FSAPI_FACE_ASSET_URL: z.preprocess(blank, z.url().optional()),
  /** Which radio it fronts. */
  FSAPI_FACE_RADIO: z.coerce.number().int().min(1).default(1),
  MAX_STREAMS: z.coerce.number().int().min(1).max(100).default(8),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
