// Shared counter persisted through an async storage backend.

export class Counter {
  constructor(storage, key) {
    this.storage = storage;
    this.key = key;
  }

  async increment() {
    const current = await this.storage.readValue(this.key);
    await this.storage.writeValue(this.key, current + 1);
    return current + 1;
  }

  async value() {
    return this.storage.readValue(this.key);
  }
}
