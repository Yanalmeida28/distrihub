import { reverse, lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const hostname = value => /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) && !isIP(value);
export async function resolveFtpsHost(server, configured = '', dns = { reverse, lookup }) {
  server = server.trim(); configured = configured.trim();
  if (!server || (!isIP(server) && !hostname(server))) throw new Error('Invalid FTP server configuration.');
  if (configured && !hostname(configured)) throw new Error('FTP_TLS_SERVER must be a DNS hostname.');
  if (!isIP(server)) return configured || server;
  const candidates = configured ? [configured] : (await dns.reverse(server)).filter(name => /^[a-z0-9-]+\.hstgr\.io$/i.test(name));
  for (const candidate of candidates) {
    if (!hostname(candidate)) continue;
    const addresses = await dns.lookup(candidate, { all: true });
    if (addresses.some(item => item.address === server)) return candidate;
  }
  throw new Error('No verified TLS hostname points to the configured FTP IP. Configure FTP_TLS_SERVER using the Hostinger server name.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await resolveFtpsHost(process.env.FTP_SERVER ?? '', process.env.FTP_TLS_SERVER ?? '');
  if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GitHub step output.');
  console.log('::add-mask::' + server);
  appendFileSync(process.env.GITHUB_OUTPUT, 'server=' + server + '\n');
  console.log('FTPS hostname verified. Certificate validation remains strict.');
}
