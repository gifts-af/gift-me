// Apart from store.ts so the round steps don't load the server-only admin client.

/** The round's lease is someone else's now (or gone): whatever this run was doing, it must stop. */
export class LeaseLost extends Error {
  constructor() {
    super("Lost the lease on the round");
    this.name = "LeaseLost";
  }
}
