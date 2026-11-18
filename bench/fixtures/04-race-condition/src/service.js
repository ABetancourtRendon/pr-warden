import { Cache } from './cache.js';
import { Counter } from './counter.js';

// In-memory async storage shared by the counter and the service.

function createStorage(initial) {
  const state = new Map(initial);
  return {
    readValue(key) {
      return Promise.resolve(state.get(key) ?? 0);
    },
    writeValue(key, value) {
      state.set(key, value);
      return Promise.resolve(value);
    }
  };
}

// Wraps a slow lookup in the read-through cache and counts each request.
export function createService(loader) {
  const storage = createStorage([['hits', 0]]);
  const cache = new Cache(loader);
  const counter = new Counter(storage, 'hits');

  return {
    async lookup(key) {
      const value = await cache.get(key);
      await counter.increment();
      return value;
    },
    async hits() {
      return counter.value();
    }
  };
}
