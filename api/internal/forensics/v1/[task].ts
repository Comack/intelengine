/**
 * Internal worker endpoint for forensics heavy stages.
 *
 * Routes:
 * - POST /api/internal/forensics/v1/fuse
 * - POST /api/internal/forensics/v1/anomaly
 *
 * Security:
 * - Requires X-Forensics-Worker-Secret when FORENSICS_WORKER_SHARED_SECRET is set.
 * - In production, returns 503 if no shared secret is configured.
 */

export const config = { runtime: 'edge' };

declare const process: { env: Record<string, string | undefined> };

import type {
  ForensicsSignalInput,
} from '../../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import {
  normalizeSignals,
  runConformalAnomalies,
  runWeakSupervisionFusion,
} from '../../../../server/worldmonitor/intelligence/v1/forensics-orchestrator';

type WorkerTask = 'fuse' | 'anomaly';

interface WorkerRequestBody {
  domain?: string;
  signals?: ForensicsSignalInput[];
  alpha?: number;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function getTask(pathname: string): WorkerTask | null {
  const trimmed = pathname.replace(/\/+$/, '');
  const segment = trimmed.split('/').pop() || '';
  if (segment === 'fuse' || segment === 'anomaly') return segment;
  return null;
}

function validateWorkerSecret(req: Request): { ok: boolean; status: number; error: string } {
  const configured = process.env.FORENSICS_WORKER_SHARED_SECRET?.trim() || '';
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        status: 503,
        error: 'Internal worker is disabled: FORENSICS_WORKER_SHARED_SECRET is not configured',
      };
    }
    return { ok: true, status: 200, error: '' };
  }

  const provided = req.headers.get('X-Forensics-Worker-Secret')?.trim() || '';
  if (!provided || provided !== configured) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true, status: 200, error: '' };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Forensics-Worker-Secret',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const auth = validateWorkerSecret(request);
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error });

  const task = getTask(new URL(request.url).pathname);
  if (!task) return jsonResponse(404, { error: 'Unknown worker task' });

  try {
    const body = await request.json() as WorkerRequestBody;
    const domain = body.domain?.trim() || 'infrastructure';
    const alpha = Number.isFinite(body.alpha) && (body.alpha as number) > 0 && (body.alpha as number) <= 1
      ? (body.alpha as number)
      : 0.05;
    const signals = normalizeSignals(domain, Array.isArray(body.signals) ? body.signals : []);

    if (signals.length === 0) {
      return jsonResponse(400, { error: 'No valid forensics signals were provided' });
    }

    if (task === 'fuse') {
      return jsonResponse(200, { fusedSignals: runWeakSupervisionFusion(signals) });
    }

    return jsonResponse(200, { anomalies: await runConformalAnomalies(signals, alpha) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(500, { error: message || 'Internal worker failure' });
  }
}

