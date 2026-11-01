// Minimal in-memory fake of the chrome.* APIs the extension uses.
// Extend it (tabs, scripting, ...) by adding fields to FakeChrome and createFakeChrome.
type ExternalListener = (
  message: unknown,
  sender: { url?: string; origin?: string },
  sendResponse: (response?: unknown) => void,
) => boolean | void;

export interface FakeChrome {
  storage: {
    local: {
      data: Map<string, string>;
      get(key: string): Promise<Record<string, string>>;
      set(items: Record<string, string>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  runtime: {
    onMessageExternal: {
      listeners: ExternalListener[];
      addListener(listener: ExternalListener): void;
    };
  };
}

export function createFakeChrome(): FakeChrome {
  const data = new Map<string, string>();
  const listeners: ExternalListener[] = [];
  return {
    storage: {
      local: {
        data,
        async get(key) {
          return data.has(key) ? { [key]: data.get(key)! } : {};
        },
        async set(items) {
          for (const [k, v] of Object.entries(items)) data.set(k, v);
        },
        async remove(key) {
          data.delete(key);
        },
      },
    },
    runtime: {
      onMessageExternal: {
        listeners,
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
  };
}

export function installFakeChrome(): FakeChrome {
  const fake = createFakeChrome();
  (globalThis as unknown as { chrome: FakeChrome }).chrome = fake;
  return fake;
}
