// Minimal in-memory fake of the chrome.* APIs the extension uses.
// Extend it by adding fields to FakeChrome and createFakeChrome.
type ExternalListener = (
  message: unknown,
  sender: { url?: string; origin?: string },
  sendResponse: (response?: unknown) => void,
) => boolean | void;

type Injection = {
  target: { tabId: number };
  func: (...args: never[]) => unknown;
  args?: unknown[];
};

export interface FakeTab {
  id?: number;
  url?: string;
  title?: string;
}

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
  tabs: {
    /** The tab query({ active, currentWindow }) returns; undefined means none. */
    active: FakeTab | undefined;
    created: { url?: string }[];
    captures: { format?: string; quality?: number }[];
    /** The data URL captureVisibleTab resolves to. */
    screenshotDataUrl: string;
    query(info: { active?: boolean; currentWindow?: boolean }): Promise<FakeTab[]>;
    create(props: { url?: string }): Promise<FakeTab>;
    captureVisibleTab(options: { format?: string; quality?: number }): Promise<string>;
  };
  scripting: {
    /** When true, executeScript throws, as it does on chrome:// or Web Store pages. */
    blocked: boolean;
    calls: Injection[];
    /** Runs the injected func here, against the test's document, and returns its result. */
    executeScript(injection: Injection): Promise<{ result: unknown }[]>;
  };
}

export function createFakeChrome(): FakeChrome {
  const data = new Map<string, string>();
  const listeners: ExternalListener[] = [];
  const tabs: FakeChrome["tabs"] = {
    active: { id: 7, url: "https://shop.test/item", title: "Item" },
    created: [],
    captures: [],
    // Three bytes of "JPEG", enough to check the Blob without a real image.
    screenshotDataUrl: "data:image/jpeg;base64,/9j/",
    async query() {
      return tabs.active ? [tabs.active] : [];
    },
    async create(props) {
      tabs.created.push(props);
      return { id: 99, url: props.url };
    },
    async captureVisibleTab(options) {
      tabs.captures.push(options);
      return tabs.screenshotDataUrl;
    },
  };
  const scripting: FakeChrome["scripting"] = {
    blocked: false,
    calls: [],
    async executeScript(injection) {
      scripting.calls.push(injection);
      if (scripting.blocked) throw new Error("Cannot access contents of the page.");
      const func = injection.func as (...args: unknown[]) => unknown;
      return [{ result: func(...(injection.args ?? [])) }];
    },
  };
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
    tabs,
    scripting,
  };
}

export function installFakeChrome(): FakeChrome {
  const fake = createFakeChrome();
  (globalThis as unknown as { chrome: FakeChrome }).chrome = fake;
  return fake;
}
