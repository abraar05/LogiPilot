/**
 * http/router.js — minimal router over node:http.
 * Path params (`/api/v1/orders/:id`), JSON bodies, CORS, error contract.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function createRouter() {
  const routes = [];

  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:[A-Za-z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })}$`);
    routes.push({ method, regex, keys, handler, opts });
  };

  return {
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    patch: (p, h, o) => add('PATCH', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
    routes,
  };
}

/** Translate a service error into the HTTP error contract. */
export const toHttp = (err, traceId) => {
  const status = err.status || (err.code === 'VALIDATION' ? 400 : 500);
  return {
    status,
    body: { error: { code: err.code || 'INTERNAL', message: err.message || 'Unexpected error', detail: err.detail, traceId } },
  };
};

export function readBody(req, limit = config.maxUploadBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'TOO_LARGE', 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export const parseJson = (buf) => {
  if (!buf || !buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON');
  }
};

export const corsHeaders = (origin) => {
  const allow = config.corsOrigins.includes('*') ? '*' : (origin && config.corsOrigins.includes(origin) ? origin : '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key, x-device',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
};

export const traceId = () => randomUUID();

/** Very small in-memory rate limiter (per key, sliding window). */
const buckets = new Map();
export function rateLimit(key, limit = 120, windowMs = 60e3) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (hits.length > limit) {
    const err = new HttpError(429, 'RATE_LIMITED', 'Too many requests — slow down and try again shortly.');
    throw err;
  }
  if (buckets.size > 5000) buckets.clear(); // crude memory bound
}