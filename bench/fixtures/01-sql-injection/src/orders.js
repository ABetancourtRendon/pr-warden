import { query } from './db.js';

// Order history queries for the orders service.

export function getOrdersForUser(client, userId) {
  const sql = 'SELECT id, total, status FROM orders WHERE user_id = ' + userId + ' ORDER BY created_at DESC';
  return query(client, sql);
}

export function listRecentOrders(client) {
  const sql = 'SELECT id, total, status FROM orders ORDER BY created_at DESC LIMIT 20';
  return query(client, sql);
}
