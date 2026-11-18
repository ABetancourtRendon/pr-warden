import http from 'node:http';
import { createMockClient } from './db.js';
import { findUser, listUsers } from './users.js';
import { getOrdersForUser } from './orders.js';

const client = createMockClient();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }
  if (parts[0] === 'users' && parts.length === 1) {
    const result = await listUsers(client);
    return sendJson(res, 200, result.rows);
  }
  if (parts[0] === 'users' && parts.length === 2) {
    const result = await findUser(client, parts[1]);
    return sendJson(res, 200, result.rows);
  }
  if (parts[0] === 'users' && parts.length === 3 && parts[2] === 'orders') {
    const result = await getOrdersForUser(client, parts[1]);
    return sendJson(res, 200, result.rows);
  }
  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: 'internal server error' });
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log('orders service listening');
});
