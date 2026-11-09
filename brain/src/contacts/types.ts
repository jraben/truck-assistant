// Contacts synced from address books (Outlook, Google, CardDAV). Pure types.

export type ContactPhone = { number: string; label: 'mobile' | 'work' | 'home' | 'phone' };

export type Contact = {
  id: number;
  /** The address book it came from (a source id) and its id there. */
  source: string;
  sourceId: string;
  name: string;
  org: string | null;
  phones: ContactPhone[];
  address: string | null;
  /** Where the address is, looked up once per address change; null when unknown or not found. */
  lat: number | null;
  lon: number | null;
  geocode: 'pending' | 'found' | 'not-found' | 'none';
  updatedAt: string;
};

export type ContactSourceKind = 'outlook' | 'google' | 'carddav' | 'demo';

/** What the settings page sees of a connected address book (no secrets). */
export type ContactSourceStatus = {
  id: string;
  kind: ContactSourceKind;
  label: string;
  account: string | null;
  connected: boolean;
  contacts: number;
  lastSync: string | null;
  error: string | null;
};

export type ContactsStatus = {
  sources: ContactSourceStatus[];
  /** A Microsoft sign-in in progress: the code to enter and where. */
  outlookPending: { userCode: string; verificationUri: string; expiresAt: string } | null;
  outlookClientId: string | null;
  googleClientId: string | null;
  googleSecretSet: boolean;
  total: number;
  located: number;
};
