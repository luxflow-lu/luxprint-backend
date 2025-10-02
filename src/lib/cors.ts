// src/lib/cors.ts
import { NextRequest, NextResponse } from 'next/server';

function parseOrigins(): string[] {
  const raw = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  return raw.length ? raw : ['*'];
}

export function corsHeaders(origin?: string) {
  const list = parseOrigins();
  const allow = list.includes('*') ? '*' : (origin && list.includes(origin) ? origin : list[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Stripe-Signature',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export function jsonCors(req: NextRequest, data: any, init: ResponseInit = {}) {
  const res = NextResponse.json(data, init);
  const h = corsHeaders(req.headers.get('origin') || undefined);
  Object.entries(h).forEach(([k, v]) => res.headers.set(k, String(v)));
  return res;
}

export function preflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin') || undefined) });
}
