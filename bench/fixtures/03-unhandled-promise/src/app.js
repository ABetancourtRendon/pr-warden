import { load } from './config.js';
import { notifyAll } from './notify.js';

// Boots the notification worker: parse config, then fan out notifications.

export async function boot(configPath, users) {
  const config = await load(configPath);
  if (config.notify === false) {
    return { queued: 0, reason: 'disabled' };
  }
  const queued = notifyAll(users);
  return { queued, retries: config.retries };
}
