import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Typed = { t: string; v: number | string };

/** A tiny stand-in for a Frontier Silicon radio, for tests. Mirrors answers captured from a Roberts Stream 94i. */
export class FakeRadio {
  readonly nodes = new Map<string, Typed>();
  readonly lists = new Map<string, { key: number; fields: Record<string, Typed> }[]>();
  readonly log: string[] = [];
  sessions = new Set<string>();
  blockedListReads = 0;
  /** How long GET_NOTIFIES waits when nothing has changed (the real radio waits about 25 s). */
  holdMs = 150;
  /** Writes to these nodes answer FS_NODE_BLOCKED this many times first (menu still loading). */
  readonly blockedWrites = new Map<string, number>();
  #waiters = new Set<() => void>();
  #next = 1000;
  #server: http.Server;
  #notifies: { node: string; value: Typed }[] = [];

  readonly pin: string;

  constructor(pin = '1234') {
    this.pin = pin;
    this.#server = http.createServer((req, res) => this.#handle(req, res));
    const n = (node: string, t: string, v: number | string) => this.nodes.set(node, { t, v });
    n('netRemote.sys.info.friendlyName', 'c8_array', 'DanceHall');
    n('netRemote.sys.info.version', 'c8_array', 'ir-mmi-FS2026-0500-0515-Stream94i_V2.14.35c');
    n('netRemote.sys.net.wlan.rssi', 'u8', 100);
    n('netRemote.sys.power', 'u8', 1);
    n('netRemote.sys.mode', 'u32', 0);
    n('netRemote.sys.audio.volume', 'u8', 7);
    n('netRemote.sys.caps.volumeSteps', 'u8', 33);
    n('netRemote.sys.audio.mute', 'u8', 0);
    n('netRemote.sys.sleep', 'u32', 0);
    n('netRemote.sys.audio.eqPreset', 'u8', 1);
    n('netRemote.sys.audio.eqLoudness', 'u8', 0);
    n('netRemote.sys.audio.eqCustom.param0', 's16', 0);
    n('netRemote.sys.audio.eqCustom.param1', 's16', -2);
    n('netRemote.play.status', 'u8', 2);
    n('netRemote.play.caps', 'u32', 2050); // stop + add preset, as seen in Internet radio mode
    n('netRemote.play.info.name', 'c8_array', 'FIP');
    n('netRemote.play.info.text', 'c8_array', 'Radio France - eclectic & fresh');
    n('netRemote.play.info.artist', 'c8_array', '');
    n('netRemote.play.info.album', 'c8_array', '');
    n('netRemote.play.info.graphicUri', 'c8_array', 'http://radio.test/logo/1.png');
    n('netRemote.play.shuffle', 'u8', 0);
    n('netRemote.play.repeat', 'u8', 0);
    n('netRemote.nav.state', 'u8', 0);
    const item = (key: number, fields: Record<string, Typed>) => ({ key, fields });
    this.lists.set('netRemote.sys.caps.validModes', [
      item(0, { id: { t: 'c8_array', v: 'IR' }, selectable: { t: 'u8', v: 1 }, label: { t: 'c8_array', v: 'Internet radio' } }),
      item(1, { id: { t: 'c8_array', v: 'Spotify' }, selectable: { t: 'u8', v: 1 }, label: { t: 'c8_array', v: 'Spotify' } }),
      item(2, { id: { t: 'c8_array', v: 'DMR' }, selectable: { t: 'u8', v: 0 }, label: { t: 'c8_array', v: 'Local Music' } }),
    ]);
    this.lists.set('netRemote.nav.presets', [
      item(0, { name: { t: 'c8_array', v: 'FIP        ' } }),
      item(1, { name: { t: 'c8_array', v: '' } }),
      item(2, { name: { t: 'c8_array', v: 'M80' } }),
    ]);
    this.lists.set('netRemote.nav.list', [
      item(0, { name: { t: 'c8_array', v: 'Radio stations' }, type: { t: 'u8', v: 0 } }),
      item(1, { name: { t: 'c8_array', v: 'Portugal' }, type: { t: 'u8', v: 0 } }),
      item(2, { name: { t: 'c8_array', v: 'FIP' }, type: { t: 'u8', v: 2 } }),
    ]);
  }

  listen(): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve) =>
      this.#server.listen(0, '127.0.0.1', () =>
        resolve({ port: (this.#server.address() as AddressInfo).port, close: () => new Promise<void>((r) => this.#server.close(() => r())) }),
      ),
    );
  }

  notify(node: string, value: Typed): void {
    this.#notifies.push({ node: node.toLowerCase(), value });
    for (const w of this.#waiters) w();
  }

  #xml(t: Typed): string {
    const v = typeof t.v === 'string' ? t.v.replace(/&/g, '&amp;').replace(/</g, '&lt;') : t.v;
    return `<${t.t}>${v}</${t.t}>`;
  }

  #handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/^\/fsapi\//, '');
    this.log.push(`${path}${url.searchParams.has('value') ? '=' + url.searchParams.get('value') : ''}`);
    const send = (body: string, status = 200): void => {
      res.writeHead(status, { 'Content-Type': 'text/xml' }).end(body);
    };
    const ok = (inner = ''): void => send(`<fsapiResponse>\n<status>FS_OK</status>\n${inner}</fsapiResponse>\n`);
    if (url.searchParams.get('pin') !== this.pin) return send('', 403);
    if (path === 'CREATE_SESSION') {
      const sid = String(this.#next++);
      this.sessions.add(sid);
      return ok(`<sessionId>${sid}</sessionId>\n`);
    }
    const sid = url.searchParams.get('sid') ?? '';
    if (!this.sessions.has(sid)) return send('404 Error', 404);
    if (path === 'DELETE_SESSION') {
      this.sessions.delete(sid);
      return ok();
    }
    if (path.startsWith('GET/')) {
      const node = path.slice(4);
      const t = this.nodes.get(node);
      return t ? ok(`<value>${this.#xml(t)}</value>\n`) : send('<fsapiResponse><status>FS_NODE_DOES_NOT_EXIST</status></fsapiResponse>');
    }
    if (path.startsWith('SET/')) {
      const node = path.slice(4);
      const blocked = this.blockedWrites.get(node) ?? 0;
      if (blocked > 0) {
        this.blockedWrites.set(node, blocked - 1);
        return send('<fsapiResponse><status>FS_NODE_BLOCKED</status></fsapiResponse>');
      }
      const t = this.nodes.get(node);
      const raw = url.searchParams.get('value') ?? '';
      if (t) this.nodes.set(node, { t: t.t, v: t.t === 'c8_array' ? raw : Number(raw) });
      else this.nodes.set(node, { t: 'u32', v: Number(raw) });
      return ok();
    }
    if (path === 'GET_MULTIPLE') {
      // like the real 94i: more than 9 nodes and it answers with nothing useful
      if (url.searchParams.getAll('node').length > 9) return send('<fsapiGetMultipleResponse>\n<fsapiResponse>\n<status>FS_PACKET_BAD</status>\n</fsapiResponse>\n</fsapiGetMultipleResponse>\n');
      const parts = ['<fsapiResponse>\n<status>FS_PACKET_BAD</status>\n</fsapiResponse>\n'];
      for (const node of url.searchParams.getAll('node')) {
        const t = this.nodes.get(node);
        parts.push(
          t
            ? `<fsapiResponse>\n<node>${node}</node>\n<status>FS_OK</status>\n<value>${this.#xml(t)}</value>\n</fsapiResponse>\n`
            : `<fsapiResponse>\n<node>${node}</node>\n<status>FS_NODE_DOES_NOT_EXIST</status>\n</fsapiResponse>\n`,
        );
      }
      return send(`<fsapiGetMultipleResponse>\n${parts.join('')}</fsapiGetMultipleResponse>\n`);
    }
    if (path.startsWith('LIST_GET_NEXT/')) {
      const [, node = '', startRaw = '-1'] = path.split('/');
      const items = this.lists.get(node);
      if (!items) return send('<fsapiResponse><status>FS_NODE_DOES_NOT_EXIST</status></fsapiResponse>');
      if (node === 'netRemote.nav.list' && this.blockedListReads > 0) {
        this.blockedListReads--;
        return send('<fsapiResponse><status>FS_NODE_BLOCKED</status></fsapiResponse>');
      }
      const start = Number(startRaw);
      const page = items.filter((i) => i.key > start).slice(0, 2); // small pages to exercise paging
      const body = page
        .map((i) => `<item key="${i.key}">${Object.entries(i.fields).map(([k, t]) => `<field name="${k}">${this.#xml(t)}</field>`).join('')}</item>\n`)
        .join('');
      const last = page.length === 0 || page[page.length - 1]!.key === items[items.length - 1]!.key;
      return ok(body + (last ? '<listend/>\n' : ''));
    }
    if (path === 'GET_NOTIFIES') {
      const reply = () => {
        const out = this.#notifies.splice(0).map((n) => `<notify node="${n.node}"><value>${this.#xml(n.value)}</value>\n</notify>\n`).join('');
        if (out === '') return send('<fsapiResponse><status>FS_TIMEOUT</status></fsapiResponse>');
        ok(out);
      };
      if (this.#notifies.length > 0) return reply();
      const timer = setTimeout(() => {
        this.#waiters.delete(wake);
        reply();
      }, this.holdMs);
      const wake = () => {
        clearTimeout(timer);
        this.#waiters.delete(wake);
        reply();
      };
      this.#waiters.add(wake);
      return;
    }
    if (path === 'GET_NOTIFIES_OLD') {
      const out = this.#notifies.splice(0).map((n) => `<notify node="${n.node}"><value>${this.#xml(n.value)}</value>\n</notify>\n`).join('');
      return ok(out);
    }
    return send('<fsapiResponse><status>FS_FAIL</status></fsapiResponse>');
  }
}
