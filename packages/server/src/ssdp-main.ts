import { FSAPI_ST, startSsdp, stableUuid } from './ssdp.ts';

/** Small stand-alone process (run with host networking) that makes the FSAPI face discoverable. */
const port = Number(process.env['SSDP_FSAPI_PORT'] ?? 8082);
const name = process.env['SSDP_NAME'] ?? 'radioformer-fsapi';
const uuid = process.env['SSDP_UUID'] ?? stableUuid(name);

const s = startSsdp({
  uuid,
  multicast: true,
  log: (m) => console.log(m),
  advertisements: [{ st: FSAPI_ST, location: (ip) => `http://${ip}:${port}/device`, server: 'FOS/1.0 UPnP/1.0 Jupiter/6.5' }],
});
console.log(`advertising ${FSAPI_ST} as uuid:${uuid}, port ${port}`);

const stop = async () => {
  await s.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
