import { createHash } from 'node:crypto';
import dgram from 'node:dgram';

export const FSAPI_ST = 'urn:schemas-frontier-silicon-com:undok:fsapi:1';

export interface Advertisement {
  /** Search target / notification type, e.g. `urn:schemas-frontier-silicon-com:undok:fsapi:1`. */
  st: string;
  /** Builds the description address for a given local IPv4 (the address the asker can reach us on). */
  location: (localAddress: string) => string;
  /** The SERVER header apps may look at. */
  server?: string;
}

export interface SsdpOptions {
  uuid: string;
  advertisements: Advertisement[];
  /** Default 1900; tests use another port. */
  port?: number;
  /** Join the multicast group (off in tests). */
  multicast?: boolean;
  bindAddress?: string;
  /** Overrides the local address used in answers (tests). */
  localAddress?: string;
  log?: (msg: string) => void;
}

/** A stable UUID derived from a name, so the same device keeps its identity across restarts. */
export function stableUuid(name: string): string {
  const h = createHash('sha1').update(`radioformer:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function parseSearch(msg: string): { st: string } | null {
  const lines = msg.split(/\r?\n/);
  if (!/^M-SEARCH \* HTTP\/1\.1/i.test(lines[0] ?? '')) return null;
  const headers = new Map<string, string>();
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':');
    if (i > 0) headers.set(l.slice(0, i).trim().toUpperCase(), l.slice(i + 1).trim());
  }
  if (!/ssdp:discover/i.test(headers.get('MAN') ?? '')) return null;
  const st = headers.get('ST');
  return st ? { st } : null;
}

export function searchResponse(ad: Advertisement, uuid: string, localAddress: string): string {
  return [
    'HTTP/1.1 200 OK',
    'CACHE-CONTROL: max-age=1800',
    'EXT:',
    `LOCATION: ${ad.location(localAddress)}`,
    `SERVER: ${ad.server ?? 'FOS/1.0 UPnP/1.0 Radioformer/0.1'}`,
    `ST: ${ad.st}`,
    `USN: uuid:${uuid}::${ad.st}`,
    '',
    '',
  ].join('\r\n');
}

export function notifyMessage(ad: Advertisement, uuid: string, localAddress: string, alive: boolean): string {
  return [
    'NOTIFY * HTTP/1.1',
    'HOST: 239.255.255.250:1900',
    ...(alive ? ['CACHE-CONTROL: max-age=1800', `LOCATION: ${ad.location(localAddress)}`] : []),
    `NT: ${ad.st}`,
    `NTS: ssdp:${alive ? 'alive' : 'byebye'}`,
    `SERVER: ${ad.server ?? 'FOS/1.0 UPnP/1.0 Radioformer/0.1'}`,
    `USN: uuid:${uuid}::${ad.st}`,
    '',
    '',
  ].join('\r\n');
}

/** The IPv4 address this machine would use to reach `remote` (so the answer points at an address the asker can use). */
function localAddressFor(remote: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => {
      s.close();
      reject(e);
    });
    s.connect(9, remote, () => {
      const a = s.address().address;
      s.close();
      resolve(a);
    });
  });
}

/** Answers SSDP searches and announces itself, so apps that discover radios by network search find the face. */
export function startSsdp(opts: SsdpOptions): { close(): Promise<void> } {
  const log = opts.log ?? (() => {});
  const port = opts.port ?? 1900;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let timer: NodeJS.Timeout | undefined;

  const announce = async (alive: boolean) => {
    if (!opts.multicast) return;
    try {
      const local = opts.localAddress ?? (await localAddressFor('239.255.255.250'));
      for (const ad of opts.advertisements) socket.send(notifyMessage(ad, opts.uuid, local, alive), 1900, '239.255.255.250');
    } catch (e) {
      log(`ssdp announce failed: ${String(e)}`);
    }
  };

  socket.on('message', (data, rinfo) => {
    const search = parseSearch(data.toString('latin1'));
    if (!search) return;
    const matches = opts.advertisements.filter((ad) => search.st === 'ssdp:all' || search.st === ad.st);
    if (matches.length === 0) return;
    void (async () => {
      const local = opts.localAddress ?? (await localAddressFor(rinfo.address).catch(() => ''));
      if (!local) return;
      for (const ad of matches) {
        // answers are spread out a little, as the protocol asks, so a burst of searches is not a burst of replies
        setTimeout(() => socket.send(searchResponse(ad, opts.uuid, local), rinfo.port, rinfo.address), Math.random() * 400).unref();
      }
    })();
  });
  socket.on('error', (e) => log(`ssdp socket error: ${String(e)}`));
  socket.bind(port, opts.bindAddress, () => {
    if (opts.multicast) {
      try {
        socket.addMembership('239.255.255.250');
      } catch (e) {
        log(`could not join the SSDP multicast group: ${String(e)}`);
      }
    }
    log(`ssdp listening on ${port}`);
    void announce(true);
    timer = setInterval(() => void announce(true), 15 * 60_000);
    timer.unref();
  });

  return {
    close: async () => {
      clearInterval(timer);
      await announce(false);
      await new Promise<void>((r) => setTimeout(r, 50));
      socket.close();
    },
  };
}
