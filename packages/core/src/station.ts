import { z } from 'zod';

/** How the radio reaches a station's audio (see docs/DESIGN.md, section 5). */
export const ProxyMode = z.enum(['direct', 'proxy', 'auto']);
export type ProxyMode = z.infer<typeof ProxyMode>;

export const Station = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  streamUrl: z.url({ protocol: /^https?$/ }),
  logoId: z.number().int().positive().nullable().default(null),
  description: z.string().max(1000).default(''),
  country: z.string().max(2).default(''),
  language: z.string().max(40).default(''),
  tags: z.array(z.string().max(40)).default([]),
  transformer: z.string().max(40).default('none'),
  proxyMode: ProxyMode.default('auto'),
  /** Folder shown on the radio and in the web app; empty means none. */
  collection: z.string().max(100).default(''),
});
export type Station = z.infer<typeof Station>;
