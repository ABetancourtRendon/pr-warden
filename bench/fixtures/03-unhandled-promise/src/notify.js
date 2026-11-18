// Notification fan-out used by the worker.

export async function sendNotification(user) {
  if (!user.email.includes('@')) {
    throw new Error('invalid notification address');
  }
  return { delivered: true, email: user.email };
}

// Sends a notification to every user; returns how many were queued.
export function notifyAll(users) {
  users.forEach((user) => sendNotification(user));
  return users.length;
}
