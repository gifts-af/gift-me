// @vitest-environment jsdom
// Browser code: it checks localStorage stays empty.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTACTS_SCOPE, loadGoogleContacts, type GoogleIdentity } from "../import/google-contacts";

// ALL-24: the browser half of the import. Google's own script is replaced by a
// fake; the token must be revoked however the load ends (AC-8).

function fakeGoogle(answer: { access_token?: string; error?: string; scope?: string }) {
  const revoke = vi.fn((_token: string, done?: () => void) => done?.());
  const requestAccessToken = vi.fn();
  const google: GoogleIdentity = {
    accounts: {
      oauth2: {
        initTokenClient: vi.fn((config) => {
          requestAccessToken.mockImplementation(() =>
            config.callback({ scope: CONTACTS_SCOPE, ...answer } as never),
          );
          return { requestAccessToken };
        }),
        hasGrantedAllScopes: vi.fn((r: { scope?: string }, scope: string) => (r.scope ?? "").split(" ").includes(scope)),
        revoke,
      },
    },
  };
  return { google, revoke, requestAccessToken };
}

const page = (connections: unknown[], nextPageToken?: string) =>
  new Response(JSON.stringify({ connections, nextPageToken }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("loadGoogleContacts", () => {
  it("asks only for read-only contacts, reads every page, and revokes the token", async () => {
    const { google, revoke } = fakeGoogle({ access_token: "tok" });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([{ resourceName: "people/c2", names: [{ displayName: "Zed" }] }], "p2"))
      .mockResolvedValueOnce(page([{ resourceName: "people/c1", names: [{ displayName: "Amy" }] }]));
    const contacts = await loadGoogleContacts("client-id", { google: async () => google, fetch });

    expect(google.accounts.oauth2.initTokenClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "client-id", scope: CONTACTS_SCOPE }),
    );
    expect(CONTACTS_SCOPE).toBe("https://www.googleapis.com/auth/contacts.readonly");
    expect(contacts.map((c) => c.name)).toEqual(["Amy", "Zed"]);
    const [first, second] = fetch.mock.calls.map(([url, init]) => ({ url: new URL(url), init }));
    expect(first.url.origin + first.url.pathname).toBe("https://people.googleapis.com/v1/people/me/connections");
    expect(first.url.searchParams.get("personFields")).toBe("names,nicknames,birthdays,addresses,photos");
    expect(first.url.searchParams.get("pageSize")).toBe("1000");
    expect(first.init.headers).toEqual({ Authorization: "Bearer tok" });
    expect(second.url.searchParams.get("pageToken")).toBe("p2");
    expect(revoke).toHaveBeenCalledWith("tok", expect.any(Function));
  });

  it("revokes the token even when the People API fails", async () => {
    const { google, revoke } = fakeGoogle({ access_token: "tok" });
    const fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(loadGoogleContacts("client-id", { google: async () => google, fetch })).rejects.toThrow();
    expect(revoke).toHaveBeenCalledWith("tok", expect.any(Function));
  });

  it("fails when the buyer says no or doesn't tick contacts access", async () => {
    const denied = fakeGoogle({ error: "access_denied" });
    await expect(loadGoogleContacts("id", { google: async () => denied.google, fetch: vi.fn() })).rejects.toThrow(
      "access_denied",
    );
    const unticked = fakeGoogle({ access_token: "tok", scope: "openid" });
    const fetch = vi.fn();
    await expect(loadGoogleContacts("id", { google: async () => unticked.google, fetch })).rejects.toThrow(
      "contacts access",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(unticked.revoke).toHaveBeenCalledWith("tok", expect.any(Function));
  });

  it("never stores the token in the browser", async () => {
    const { google } = fakeGoogle({ access_token: "tok-secret" });
    localStorage.clear();
    sessionStorage.clear();
    await loadGoogleContacts("id", { google: async () => google, fetch: vi.fn().mockResolvedValue(page([])) });
    expect(JSON.stringify({ ...localStorage })).not.toContain("tok-secret");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("tok-secret");
    expect(document.cookie).not.toContain("tok-secret");
  });
});
