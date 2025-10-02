import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});

// --- Helpers
function allowlistRegex(): RegExp {
  const def = '^https:\\/\\/(?:[a-z0-9-]+\\.)?(?:ucarecdn\\.com|ucarecd\\.net)\\/';
  try {
    return new RegExp(process.env.ALLOWLIST_REGEX || def, 'i');
  } catch {
    return new RegExp(def, 'i');
  }
}

function parseJSONSafe<T = any>(txt?: string): T | null {
  try {
    if (!txt) return null;
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

type FrontDesign = {
  placement: string; // 'front' | 'back' | ...
  technique?: string;
  layers: Array<{ type: 'file'; url: string; filename?: string }>;
};

// Map designs[] -> Printful "files"[] (very permissive; placement kept as "type")
function buildPrintfulFiles(designs: FrontDesign[], urlAllow: RegExp) {
  const files: Array<{ url: string; type?: string }> = [];
  for (const d of designs || []) {
    for (const l of d.layers || []) {
      if (l.type !== 'file' || !l.url) continue;
      if (!urlAllow.test(l.url)) continue;
      files.push({ url: l.url, type: d.placement }); // Printful accepte 'type' (front/back/…)
    }
  }
