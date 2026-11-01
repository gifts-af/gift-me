// The browser half of the Google Contacts import (ALL-24). Google Identity
// Services shows Google's own consent popup and hands back a short-lived
// access token for read-only contacts. The browser reads the contacts with it
// and revokes it straight away. The token never reaches our server and is
// never stored (AC-8); unticked contacts never leave the browser (T42).
import { contactsFromPeopleApi, type GoogleContact } from "@gifts-af/core";

export const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const CONNECTIONS = "https://people.googleapis.com/v1/people/me/connections";
const PERSON_FIELDS = "names,nicknames,birthdays,addresses,photos";
// Google's largest page.
const PAGE_SIZE = "1000";

type TokenResponse = { access_token?: string; error?: string; scope?: string };

/** The parts of Google Identity Services we use. */
export type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }): { requestAccessToken(options?: { prompt?: string }): void };
      hasGrantedAllScopes(response: TokenResponse, scope: string): boolean;
      revoke(token: string, done?: () => void): void;
    };
  };
};

let script: Promise<GoogleIdentity> | null = null;

/** Loads Google's script once, on the first click (nothing is loaded before). */
function loadGoogleIdentity(): Promise<GoogleIdentity> {
  script ??= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = GIS_SCRIPT;
    tag.async = true;
    tag.onload = () => {
      const google = (window as unknown as { google?: GoogleIdentity }).google;
      if (google?.accounts?.oauth2) resolve(google);
      else reject(new Error("Google sign-in didn't load"));
    };
    tag.onerror = () => {
      script = null;
      reject(new Error("Google sign-in didn't load"));
    };
    document.head.append(tag);
  });
  return script;
}

function requestToken(google: GoogleIdentity, clientId: string): Promise<TokenResponse & { access_token: string }> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: CONTACTS_SCOPE,
      callback: (r) => (r.access_token ? resolve(r as TokenResponse & { access_token: string }) : reject(new Error(r.error ?? "no token"))),
      error_callback: (e) => reject(new Error(e.type ?? "popup failed")),
    });
    client.requestAccessToken();
  });
}

async function readAllConnections(token: string, fetcher: typeof fetch): Promise<unknown[]> {
  const all: unknown[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(CONNECTIONS);
    url.searchParams.set("personFields", PERSON_FIELDS);
    url.searchParams.set("pageSize", PAGE_SIZE);
    url.searchParams.set("sortOrder", "FIRST_NAME_ASCENDING");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetcher(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`People API answered ${res.status}`);
    const body = (await res.json()) as { connections?: unknown[]; nextPageToken?: string };
    all.push(...(body.connections ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return all;
}

export async function loadGoogleContacts(
  clientId: string,
  deps: { google?: () => Promise<GoogleIdentity>; fetch?: typeof fetch } = {},
): Promise<GoogleContact[]> {
  const google = await (deps.google ?? loadGoogleIdentity)();
  const response = await requestToken(google, clientId);
  const token = response.access_token;
  try {
    // Google lets people untick a scope in the popup.
    if (!google.accounts.oauth2.hasGrantedAllScopes(response, CONTACTS_SCOPE)) {
      throw new Error("No contacts access was granted");
    }
    return contactsFromPeopleApi(await readAllConnections(token, deps.fetch ?? fetch));
  } finally {
    google.accounts.oauth2.revoke(token, () => {});
  }
}
