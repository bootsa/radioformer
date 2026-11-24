import { FSAPI_ST, UPNP_TYPES, rendererUuid, startSsdp, stableUuid } from './ssdp.ts';

/** Small stand-alone process (run with host networking) that makes the FSAPI face and the renderer face discoverable. */
const port = Number(process.env['SSDP_FSAPI_PORT'] ?? 8082);
const upnpPort = Number(process.env['SSDP_UPNP_PORT'] ?? 0);
const upnpRadio = Number(process.env['SSDP_UPNP_RADIO'] ?? 1);
const name = process.env['SSDP_NAME'] ?? 'radioformer-fsapi';
const uuid = process.env['SSDP_UUID'] ?? stableUuid(name);
const upnpUuid = process.env['SSDP_UPNP_UUID'] ?? rendererUuid(upnpRadio);

const upnpAds = upnpPort
  ? [`uuid:${upnpUuid}`, ...UPNP_TYPES].map((st) => ({ st, uuid: upnpUuid, location: (ip: string) => `http://${ip}:${upnpPort}/upnp/desc.xml`, server: 'Linux/6.0 UPnP/1.0 Radioformer/0.1' }))
  : [];

const s = startSsdp({
  uuid,
  multicast: true,
  log: (m) => console.log(m),
  advertisements: [{ st: FSAPI_ST, location: (ip) => `http://${ip}:${port}/device`, server: 'FOS/1.0 UPnP/1.0 Jupiter/6.5' }, ...upnpAds],
});
console.log(`advertising ${FSAPI_ST} as uuid:${uuid}, port ${port}`);
if (upnpPort) console.log(`advertising the media renderer as uuid:${upnpUuid}, port ${upnpPort}`);

const stop = async () => {
  await s.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
