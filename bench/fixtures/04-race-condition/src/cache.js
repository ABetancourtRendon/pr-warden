// Read-through cache backed by an injected async loader.

export class Cache {
  constructor(loader) {
    this.store = new Map();
    this.loader = loader;
  }

  async get(key) {
    if (!this.store.has(key)) {
      const value = await this.loader(key);
      this.store.set(key, value);
    }
    return this.store.get(key);
  }
}
