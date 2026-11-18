import { query } from './db.js';

// User lookup helpers for the orders service.

export function findUser(client, id) {
  const sql = 'SELECT id, name FROM users WHERE id = ' + id;
  return query(client, sql);
}

export function listUsers(client) {
  const sql = 'SELECT id, name FROM users ORDER BY id';
  return query(client, sql);
}
