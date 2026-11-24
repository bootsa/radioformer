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
  /** Where titles come from when the stream has none, e.g. `radiofrance:7`; empty means the stream's own. */
  /**
   * How the title shown on the radio is put together when a metadata source is set, e.g.
   * `{artist} - {title}[ · On air: {programme}][ · Next: {next}]`. Empty means "Artist - Title".
   */
  titleTemplate: z.string().max(300).default(''),
  /**
   * The id this station has in the radio's original directory (Airable), when it is a counterpart of one.
   * The radio is shown this id, so presets keep working if Radioformer's DNS is ever bypassed. Empty means none.
   */
  directoryId: z.string().regex(/^\d{10,19}$|^$/).default(''),
  metadataSource: z.string().regex(/^[a-z]{2,20}:[A-Za-z0-9_-]{1,30}$|^$/).default(''),
});
export type Station = z.infer<typeof Station>;
