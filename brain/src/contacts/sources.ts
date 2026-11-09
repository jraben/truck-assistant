// Reading address books: Outlook (Microsoft Graph, signed in with a device
// code), Google (People API, OAuth with the paste-back redirect), and any
// CardDAV server (iCloud, Fastmail, Nextcloud...). Each gives the same record.
import type { ContactPhone } from './types.ts';
import { addressData, davHrefIn, davResponses, isAddressBook, parseVCard, splitVCards } from './vcard.ts';

export type RawContact = { sourceId: string; name: string; org: string | null; phones: ContactPhone[]; address: string | null };
export type OAuthToken = { access: string; refresh: string; expiresAt: number };
type FetchFn = typeof fetch;

export class SourceError extends Error {
  auth: boolean;
  constructor(message: string, auth = false) { super(message); this.auth = auth; }
}

async function json<T>(res: Response, who: string): Promise<T> {
  if (res.status === 401 || res.status === 403) throw new SourceError(`${who} refused the sign-in: connect it again on the settings page.`, true);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json() as { error_description?: string; error?: { message?: string } | string }; detail = j.error_description ?? (typeof j.error === 'string' ? j.error : j.error?.message ?? ''); } catch { /* none */ }
    throw new SourceError(`${who} answered ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  return await res.json() as T;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

// ---- Outlook (Microsoft Graph) ------------------------------------------------------

const MS = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_SCOPE = 'Contacts.Read User.Read offline_access';

export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; intervalS: number; expiresAt: number };

export async function outlookDeviceStart(clientId: string, f: FetchFn = fetch): Promise<DeviceCode> {
  const j = await json<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }>(
    await f(`${MS}/devicecode`, { method: 'POST', headers: FORM, body: form({ client_id: clientId, scope: MS_SCOPE }) }), 'Microsoft');
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, intervalS: j.interval || 5, expiresAt: Date.now() + j.expires_in * 1000 };
}

/** One poll: a token once the code was entered, 'pending' before, or an error. */
export async function outlookDevicePoll(clientId: string, deviceCode: string, f: FetchFn = fetch): Promise<OAuthToken | 'pending'> {
  const res = await f(`${MS}/token`, { method: 'POST', headers: FORM, body: form({ client_id: clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode }) });
  const j = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (j.error === 'authorization_pending' || j.error === 'slow_down') return 'pending';
  if (!res.ok || !j.access_token || !j.refresh_token) throw new SourceError(j.error === 'expired_token' ? 'The sign-in code expired: start again.' : `Microsoft: ${j.error_description?.split('\r')[0] ?? j.error ?? res.status}`);
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

export async function outlookRefresh(clientId: string, refresh: string, f: FetchFn = fetch): Promise<OAuthToken> {
  const j = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
    await f(`${MS}/token`, { method: 'POST', headers: FORM, body: form({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refresh, scope: MS_SCOPE }) }), 'Microsoft');
  return { access: j.access_token, refresh: j.refresh_token ?? refresh, expiresAt: Date.now() + j.expires_in * 1000 };
}

type GraphAddress = { street?: string; city?: string; state?: string; postalCode?: string; countryOrRegion?: string };
const graphAddress = (a: GraphAddress | undefined) => (a ? [a.street, a.city, [a.state, a.postalCode].filter(Boolean).join(' '), a.countryOrRegion].filter((x) => x && x.trim()).join(', ') || null : null);

export async function outlookContacts(token: string, f: FetchFn = fetch): Promise<{ account: string | null; contacts: RawContact[] }> {
  const h = { authorization: `Bearer ${token}` };
  const me = await json<{ userPrincipalName?: string; mail?: string }>(await f('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: h }), 'Outlook');
  const out: RawContact[] = [];
  let url: string | undefined = 'https://graph.microsoft.com/v1.0/me/contacts?$top=500&$select=id,displayName,companyName,homeAddress,businessAddress,otherAddress,mobilePhone,homePhones,businessPhones';
  while (url && out.length < 20000) {
    const j: { value: Record<string, unknown>[]; '@odata.nextLink'?: string } = await json(await f(url, { headers: h }), 'Outlook');
    for (const c of j.value) {
      const phones: ContactPhone[] = [];
      if (typeof c.mobilePhone === 'string' && c.mobilePhone) phones.push({ number: c.mobilePhone, label: 'mobile' });
      for (const n of (c.homePhones as string[] | undefined) ?? []) if (n) phones.push({ number: n, label: 'home' });
      for (const n of (c.businessPhones as string[] | undefined) ?? []) if (n) phones.push({ number: n, label: 'work' });
      const name = String(c.displayName ?? '').trim() || String(c.companyName ?? '').trim();
      if (!name) continue;
      out.push({ sourceId: String(c.id), name, org: (c.companyName as string) || null, phones, address: graphAddress(c.homeAddress as GraphAddress) ?? graphAddress(c.businessAddress as GraphAddress) ?? graphAddress(c.otherAddress as GraphAddress) });
    }
    url = j['@odata.nextLink'];
  }
  return { account: me.mail ?? me.userPrincipalName ?? null, contacts: out };
}

// ---- Google (People API) ------------------------------------------------------------

const G_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/userinfo.email';

export function googleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  return `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: G_SCOPE, access_type: 'offline', prompt: 'consent', state })}`;
}

export async function googleExchange(clientId: string, secret: string, code: string, redirectUri: string, f: FetchFn = fetch): Promise<OAuthToken> {
  const j = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(
    await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: FORM, body: form({ client_id: clientId, client_secret: secret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }) }), 'Google');
  if (!j.refresh_token) throw new SourceError('Google gave no refresh token: remove the app at myaccount.google.com/permissions and connect again.');
  return { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 };
}

export async function googleRefresh(clientId: string, secret: string, refresh: string, f: FetchFn = fetch): Promise<OAuthToken> {
  const j = await json<{ access_token: string; expires_in: number }>(
    await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: FORM, body: form({ client_id: clientId, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }) }), 'Google');
  return { access: j.access_token, refresh, expiresAt: Date.now() + j.expires_in * 1000 };
}

type GPerson = { resourceName: string; names?: { displayName?: string }[]; organizations?: { name?: string }[]; phoneNumbers?: { value?: string; type?: string }[]; addresses?: { formattedValue?: string; type?: string }[] };

export async function googleContacts(token: string, f: FetchFn = fetch): Promise<{ account: string | null; contacts: RawContact[] }> {
  const h = { authorization: `Bearer ${token}` };
  let account: string | null = null;
  try { account = (await json<{ email?: string }>(await f('https://www.googleapis.com/oauth2/v3/userinfo', { headers: h }), 'Google')).email ?? null; } catch { /* name only */ }
  const out: RawContact[] = [];
  let page: string | undefined;
  do {
    const u = `https://people.googleapis.com/v1/people/me/connections?personFields=names,organizations,phoneNumbers,addresses&pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const j: { connections?: GPerson[]; nextPageToken?: string } = await json(await f(u, { headers: h }), 'Google');
    for (const p of j.connections ?? []) {
      const org = p.organizations?.[0]?.name ?? null;
      const name = p.names?.[0]?.displayName?.trim() || org;
      if (!name) continue;
      const adr = p.addresses?.find((a) => a.type === 'home') ?? p.addresses?.[0];
      out.push({
        sourceId: p.resourceName, name, org: org && org !== name ? org : null,
        phones: (p.phoneNumbers ?? []).filter((n) => n.value).map((n) => ({ number: n.value!, label: n.type === 'mobile' ? 'mobile' : n.type === 'work' ? 'work' : n.type === 'home' ? 'home' : 'phone' })),
        address: adr?.formattedValue?.replace(/\n/g, ', ') ?? null,
      });
    }
    page = j.nextPageToken;
  } while (page && out.length < 20000);
  return { account, contacts: out };
}

// ---- CardDAV (iCloud, Fastmail, Nextcloud...) -------------------------------------------

const PROPFIND = (props: string) => `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop>${props}</d:prop></d:propfind>`;
const QUERY = '<?xml version="1.0"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><c:address-data/></d:prop></c:addressbook-query>';

/** Every contact in every address book the account can see, starting from the server's address (or an address book's). */
export async function cardDavContacts(baseUrl: string, username: string, password: string, f: FetchFn = fetch): Promise<RawContact[]> {
  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const dav = async (url: string, method: string, depth: '0' | '1', body: string) => {
    let res: Response;
    try { res = await f(url, { method, headers: { authorization: auth, depth, 'content-type': 'application/xml; charset=utf-8' }, body, redirect: 'follow', signal: AbortSignal.timeout(30_000) }); }
    catch (e) { throw new SourceError(`Can't reach ${new URL(url).host} (${(e as Error).message}).`); }
    if (res.status === 401 || res.status === 403) throw new SourceError('The address book refused the login (iCloud needs an app-specific password).', true);
    if (res.status !== 207 && !res.ok) throw new SourceError(`The address book answered ${res.status}.`);
    return { text: await res.text(), url: res.url || url };
  };
  const abs = (href: string, base: string) => new URL(href, base).toString();

  // Is the address itself an address book? Else: principal → address-book home → address books.
  const first = await dav(baseUrl, 'PROPFIND', '0', PROPFIND('<d:resourcetype/><d:current-user-principal/>'));
  let books: string[] = [];
  const self = davResponses(first.text)[0];
  if (self && isAddressBook(self.body)) books = [first.url];
  else {
    const principal = self ? davHrefIn(self.body, 'current-user-principal') : null;
    const p = await dav(principal ? abs(principal, first.url) : first.url, 'PROPFIND', '0', PROPFIND('<c:addressbook-home-set/>'));
    const homeHref = davResponses(p.text).map((r) => davHrefIn(r.body, 'addressbook-home-set')).find(Boolean);
    if (!homeHref) throw new SourceError('This server has no address book for that login.');
    const home = abs(homeHref, p.url);
    const list = await dav(home, 'PROPFIND', '1', PROPFIND('<d:resourcetype/><d:displayname/>'));
    books = davResponses(list.text).filter((r) => isAddressBook(r.body)).map((r) => abs(r.href, list.url));
  }
  const out: RawContact[] = [];
  for (const book of books) {
    const r = await dav(book, 'REPORT', '1', QUERY);
    for (const resp of davResponses(r.text)) {
      const data = addressData(resp.body);
      if (!data) continue;
      for (const card of splitVCards(data)) {
        const c = parseVCard(card);
        if (c) out.push({ sourceId: c.uid ?? resp.href, name: c.name, org: c.org, phones: c.phones, address: c.address });
      }
    }
  }
  return out;
}
