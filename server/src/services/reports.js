/**
 * services/reports.js — operational reports computed from events and orders.
 */
import { getDb } from '../db/index.js';

const H = 3600e3;
const since = (ts, days) => (ts ? ts >= Date.now() - days * 864e5 : false);

export async function run(kind, { orgId = 'default', from, to, warehouse } = {}) {
  const db = getDb();
  const orders = (await db.filter('orders')).filter((o) => o.orgId === orgId);
  const proofs = (await db.filter('proofs')).filter((p) => p.orgId === orgId);
  const auditLog = (await db.filter('audit', (a) => a.orgId === orgId));

  const inRange = (ts) => (from ? ts >= from : true) && (to ? ts <= to : true);

  switch (kind) {
    case 'summary': {
      const delivered = orders.filter((o) => o.status === 'delivered');
      const failed = orders.filter((o) => o.status === 'failed');
      return {
        orders: orders.length,
        delivered: delivered.length,
        failed: failed.length,
        inFlight: orders.filter((o) => !['delivered', 'cancelled', 'returned'].includes(o.status)).length,
        proofs: proofs.length,
        qcRejected: orders.filter((o) => o.history.some((h) => h.action === 'qc_rejected')).length,
        codOutstanding: orders.filter((o) => o.cod?.amount && !o.codCollected).reduce((s, o) => s + Number(o.cod.amount || 0), 0),
        codCollected: orders.filter((o) => o.codCollected).reduce((s, o) => s + Number(o.cod?.amount || 0), 0),
      };
    }

    case 'throughput': {
      const days = 7;
      const out = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const next = d.getTime() + 86400e3;
        out.push({
          date: new Date(d.getTime()).toISOString().slice(0, 10),
          packed: orders.filter((o) => o.history.some((h) => h.action === 'packed' && h.at >= d.getTime() && h.at < next)).length,
          qcApproved: orders.filter((o) => o.history.some((h) => h.action === 'qc_approved' && h.at >= d.getTime() && h.at < next)).length,
          delivered: orders.filter((o) => o.history.some((h) => h.action === 'delivered' && h.at >= d.getTime() && h.at < next)).length,
          failed: orders.filter((o) => o.history.some((h) => h.action === 'failed' && h.at >= d.getTime() && h.at < next)).length,
        });
      }
      return out;
    }

    case 'cycle_times': {
      const first = (o, a) => o.history.find((h) => h.action === a)?.at ?? null;
      const pack = orders.filter((o) => first(o, 'packed')).map((o) => (first(o, 'packed') - o.createdAt) / H);
      const qc = orders.filter((o) => first(o, 'packed') && first(o, 'qc_approved')).map((o) => (first(o, 'qc_approved') - first(o, 'packed')) / H);
      const del = orders.filter((o) => first(o, 'out_for_delivery') && first(o, 'delivered')).map((o) => (first(o, 'delivered') - first(o, 'out_for_delivery')) / H);
      const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
      return { avgPackToQc: avg(pack), avgQc: avg(qc), avgDelivery: avg(del), samples: { pack: pack.length, qc: qc.length, delivery: del.length } };
    }

    case 'performance': {
      const people = new Map();
      const bump = (name, key) => {
        if (!name) return;
        if (!people.has(name)) people.set(name, { name, packed: 0, qc: 0, delivered: 0, failed: 0 });
        people.get(name)[key] += 1;
      };
      for (const o of orders) {
        for (const h of o.history) {
          if (h.action === 'packed') bump(h.by, 'packed');
          if (['qc_approved', 'qc_rejected'].includes(h.action)) bump(h.by, 'qc');
          if (h.action === 'delivered') bump(h.by, 'delivered');
          if (h.action === 'failed') bump(h.by, 'failed');
        }
      }
      return [...people.values()].sort((a, b) => b.delivered - a.delivered);
    }

    case 'proofs': {
      const rows = proofs.filter((p) => inRange(p.at)).map((p) => ({
        ref: p.ref, order: p.orderRef, stage: p.stage, by: p.byName, role: p.role,
        at: new Date(p.at).toISOString(),
        gps: p.gps ? `${p.gps.lat.toFixed(5)},${p.gps.lng.toFixed(5)}` : 'unavailable',
        sha256: p.sha256.slice(0, 16),
      }));
      return { rows, total: rows.length, missingGps: rows.filter((r) => r.gps === 'unavailable').length };
    }

    case 'orders': {
      return orders.filter((o) => inRange(o.createdAt)).map((o) => ({
        ref: o.ref, createdAt: new Date(o.createdAt).toISOString(), status: o.status,
        customer: o.customer?.name, units: (o.items || []).reduce((s, i) => s + i.qty, 0),
        proofs: proofs.filter((p) => p.orderId === o.id).length,
        deliveredAt: o.history.find((h) => h.action === 'delivered')?.at
          ? new Date(o.history.find((h) => h.action === 'delivered').at).toISOString() : '',
      }));
    }

    case 'audit':
      return auditLog.filter((a) => inRange(a.at)).slice(0, 1000)
        .map((a) => ({ at: new Date(a.at).toISOString(), actor: a.actor, action: a.action, target: a.target, detail: a.detail, hash: a.hash.slice(0, 12) }));

    case 'cod':
      return orders.filter((o) => o.cod?.amount).map((o) => ({
        ref: o.ref, customer: o.customer?.name, amount: o.cod.amount,
        collected: !!o.codCollected, status: o.status,
      }));

    default: {
      const err = new Error(`Unknown report "${kind}".`);
      err.status = 404; err.code = 'NOT_FOUND';
      throw err;
    }
  }
}

export const KINDS = ['summary', 'throughput', 'cycle_times', 'performance', 'proofs', 'orders', 'audit', 'cod'];

/** CSV rendering for any report result. */
export function toCsv(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}