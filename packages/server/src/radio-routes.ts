import { FsapiError } from '@radioformer/fsapi';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SqliteLibrary } from './library.ts';
import { assertLanHost } from './net-guard.ts';
import type { RadioManager } from './radios.ts';

const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('power'), on: z.boolean() }),
  z.object({ type: z.literal('volume'), level: z.number().int().min(0).max(100) }),
  z.object({ type: z.literal('mute'), muted: z.boolean() }),
  z.object({ type: z.literal('mode'), key: z.number().int().min(0) }),
  z.object({ type: z.literal('transport'), command: z.enum(['stop', 'play', 'pause', 'next', 'previous']) }),
  z.object({ type: z.literal('shuffle'), on: z.boolean() }),
  z.object({ type: z.literal('repeat'), mode: z.number().int().min(0).max(2) }),
  z.object({ type: z.literal('sleep'), seconds: z.number().int().min(0).max(86_400) }),
  z.object({
    type: z.literal('eq'),
    preset: z.number().int().min(0).optional(),
    loudness: z.boolean().optional(),
    bass: z.number().int().min(-7).max(7).optional(),
    treble: z.number().int().min(-7).max(7).optional(),
  }),
  z.object({ type: z.literal('preset'), key: z.number().int().min(0) }),
  z.object({ type: z.literal('enter'), key: z.number().int().min(0) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('play'), key: z.number().int().min(0) }),
  z.object({ type: z.literal('closeMenu') }),
]);

const Settings = z.object({
  label: z.string().max(100).optional(),
  host: z.string().max(253).optional(),
  pin: z.string().regex(/^\d{4}$/, 'the PIN is four digits').optional(),
});

export function registerRadioRoutes(
  app: FastifyInstance,
  deps: { library: SqliteLibrary; manager: RadioManager; guard: (req: FastifyRequest, reply: FastifyReply) => boolean },
): void {
  const { library, manager, guard } = deps;

  const radioId = (req: FastifyRequest): number | null => {
    const id = (req.params as { id: string }).id;
    return /^\d+$/.test(id) ? Number(id) : null;
  };

  /** Runs `fn` against the radio's control, turning radio problems into clear HTTP answers. */
  async function withRadio<T>(req: FastifyRequest, reply: FastifyReply, fn: (c: NonNullable<ReturnType<RadioManager['get']>>) => Promise<T>): Promise<T | undefined> {
    if (!guard(req, reply)) return undefined;
    const id = radioId(req);
    if (id === null || !library.getRadio(id)) return void reply.code(404).send({ error: 'unknown radio' });
    const control = manager.get(id);
    if (!control) return void reply.code(409).send({ error: 'set the radio\'s address first (PATCH /api/v1/radios/:id)' });
    try {
      return await fn(control);
    } catch (err) {
      req.log.warn({ radio: id, err: String(err) }, 'radio request failed');
      if (err instanceof FsapiError) return void reply.code(err.code === 'BAD_PIN' ? 403 : 502).send({ error: err.message, code: err.code });
      const timedOut = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      return void reply.code(timedOut ? 504 : 502).send({ error: timedOut ? 'the radio did not answer' : 'could not reach the radio' });
    }
  }

  app.get('/api/v1/radios', async (req, reply) => (guard(req, reply) ? library.listRadios() : undefined));

  app.patch<{ Params: { id: string } }>('/api/v1/radios/:id', async (req, reply) => {
    if (!guard(req, reply)) return;
    const id = radioId(req);
    const current = id === null ? null : library.getRadio(id);
    if (!current) return reply.code(404).send({ error: 'unknown radio' });
    const parsed = Settings.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const host = parsed.data.host ?? current.host;
    if (host) {
      try {
        await assertLanHost(host);
      } catch (err) {
        return reply.code(422).send({ error: (err as Error).message });
      }
    }
    library.updateRadio(current.id, parsed.data.label ?? current.label, { host, pin: parsed.data.pin ?? current.pin });
    return library.listRadios().find((r) => r.id === current.id);
  });

  app.get<{ Params: { id: string } }>('/api/v1/radios/:id/status', (req, reply) => withRadio(req, reply, (c) => c.status()));
  app.get<{ Params: { id: string } }>('/api/v1/radios/:id/modes', (req, reply) => withRadio(req, reply, (c) => c.modes(true)));
  app.get<{ Params: { id: string } }>('/api/v1/radios/:id/presets', (req, reply) => withRadio(req, reply, (c) => c.presets()));
  app.get<{ Params: { id: string } }>('/api/v1/radios/:id/eq-presets', (req, reply) => withRadio(req, reply, (c) => c.eqPresets()));
  app.get<{ Params: { id: string } }>('/api/v1/radios/:id/menu', (req, reply) => withRadio(req, reply, (c) => c.browse()));

  app.post<{ Params: { id: string } }>('/api/v1/radios/:id/command', async (req, reply) => {
    const parsed = Command.safeParse(req.body);
    if (!parsed.success) {
      if (!guard(req, reply)) return;
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const cmd = parsed.data;
    return withRadio(req, reply, async (c) => {
      switch (cmd.type) {
        case 'power': await c.setPower(cmd.on); break;
        case 'volume': await c.setVolume(cmd.level); break;
        case 'mute': await c.setMute(cmd.muted); break;
        case 'mode': await c.setMode(cmd.key); break;
        case 'transport': await c.transport(cmd.command); break;
        case 'shuffle': await c.setShuffle(cmd.on); break;
        case 'repeat': await c.setRepeat(cmd.mode); break;
        case 'sleep': await c.setSleep(cmd.seconds); break;
        case 'eq': {
          const { type: _t, ...eq } = cmd;
          await c.setEq(eq);
          break;
        }
        case 'preset': await c.selectPreset(cmd.key); break;
        case 'enter': return { menu: await c.enter(cmd.key) };
        case 'back': return { menu: await c.back() };
        case 'play': await c.play(cmd.key); break;
        case 'closeMenu': await c.closeNav(); break;
      }
      return { ok: true };
    });
  });

  // Server-sent events: the Remote page listens here instead of polling.
  app.get<{ Params: { id: string } }>('/api/v1/radios/:id/events', (req, reply) => {
    if (!guard(req, reply)) return;
    const id = radioId(req);
    if (id === null || !library.getRadio(id)) return reply.code(404).send({ error: 'unknown radio' });
    if (!manager.get(id)) return reply.code(409).send({ error: 'set the radio\'s address first' });
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = manager.subscribe(id, (e) => (e.status ? send('status', e.status) : send('problem', { error: e.error })));
    const keepAlive = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}
