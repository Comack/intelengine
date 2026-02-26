/**
 * RPC: ListWhaleTransfers
 * Fetches large on-chain cryptocurrency transfers from Whale Alert API.
 * Falls back to synthetic data when the API key is unavailable or the fetch fails.
 */

declare const process: { env: Record<string, string | undefined> };

import type {
  ServerContext,
  ListWhaleTransfersRequest,
  ListWhaleTransfersResponse,
  WhaleTransfer,
  WhaleTransferType,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';

const EXCHANGE_COORDS: Record<string, { lat: number; lon: number }> = {
  Binance: { lat: 1.3, lon: 103.8 },
  Coinbase: { lat: 37.8, lon: -122.4 },
  Kraken: { lat: 37.8, lon: -122.4 },
  OKX: { lat: 22.3, lon: 114.2 },
  Bybit: { lat: 1.3, lon: 103.8 },
};

interface WhaleAlertTransaction {
  id: string;
  blockchain: string;
  symbol: string;
  from: {
    address: string;
    owner: string;
    owner_type: string;
  };
  to: {
    address: string;
    owner: string;
    owner_type: string;
  };
  amount_usd: number;
  timestamp: number;
  hash: string;
}

interface WhaleAlertResponse {
  transactions: WhaleAlertTransaction[];
}

function resolveTransferType(tx: WhaleAlertTransaction): WhaleTransferType {
  if (tx.to.owner === 'US Government' || tx.from.owner === 'US Government') {
    return 'WHALE_TRANSFER_TYPE_GOVERNMENT_SEIZURE';
  }
  if (tx.from.owner_type === 'exchange') {
    return 'WHALE_TRANSFER_TYPE_EXCHANGE_INFLOW';
  }
  if (tx.to.owner_type === 'exchange') {
    return 'WHALE_TRANSFER_TYPE_EXCHANGE_OUTFLOW';
  }
  return 'WHALE_TRANSFER_TYPE_WALLET_TO_WALLET';
}

function resolveCoords(tx: WhaleAlertTransaction): { lat: number; lon: number } {
  if (tx.from.owner_type === 'exchange') {
    const coords = EXCHANGE_COORDS[tx.from.owner];
    if (coords) return coords;
  }
  if (tx.to.owner_type === 'exchange') {
    const coords = EXCHANGE_COORDS[tx.to.owner];
    if (coords) return coords;
  }
  return { lat: 0, lon: 0 };
}

function syntheticFallback(): WhaleTransfer[] {
  const now = Date.now();
  return [
    {
      id: 'whale-001',
      blockchain: 'bitcoin',
      amountUsd: 250000000,
      fromLabel: 'Unknown Wallet',
      toLabel: 'Binance 1',
      transferType: 'WHALE_TRANSFER_TYPE_EXCHANGE_INFLOW',
      lat: 1.3,
      lon: 103.8,
      occurredAt: String(now - 3600000),
      txHash: 'abc123...',
    },
    {
      id: 'whale-002',
      blockchain: 'ethereum',
      amountUsd: 180000000,
      fromLabel: 'Coinbase 4',
      toLabel: 'Cold Wallet',
      transferType: 'WHALE_TRANSFER_TYPE_EXCHANGE_OUTFLOW',
      lat: 37.8,
      lon: -122.4,
      occurredAt: String(now - 7200000),
      txHash: 'def456...',
    },
    {
      id: 'whale-003',
      blockchain: 'tron',
      amountUsd: 95000000,
      fromLabel: 'Unknown Wallet',
      toLabel: 'Unknown Wallet',
      transferType: 'WHALE_TRANSFER_TYPE_WALLET_TO_WALLET',
      lat: 0,
      lon: 0,
      occurredAt: String(now - 14400000),
      txHash: 'ghi789...',
    },
  ];
}

async function fetchWhaleTransfers(req: ListWhaleTransfersRequest): Promise<WhaleTransfer[]> {
  const apiKey = process.env.WHALE_ALERT_API_KEY;
  if (!apiKey) {
    return syntheticFallback();
  }

  const minValue = req.minValueUsd || 50000000;
  const limit = Math.min(req.limit || 20, 50);
  const url = `https://api.whale-alert.io/v1/transactions?api_key=${apiKey}&min_value=${minValue}&limit=${limit}&cursor=0`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    return syntheticFallback();
  }

  const data = (await response.json()) as WhaleAlertResponse;
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];

  return transactions.map((tx): WhaleTransfer => {
    const transferType = resolveTransferType(tx);
    const coords = resolveCoords(tx);
    const fromLabel = tx.from.owner || tx.from.owner_type || tx.from.address.slice(0, 8);
    const toLabel = tx.to.owner || tx.to.owner_type || tx.to.address.slice(0, 8);
    return {
      id: String(tx.id),
      blockchain: tx.blockchain,
      amountUsd: tx.amount_usd,
      fromLabel,
      toLabel,
      transferType,
      lat: coords.lat,
      lon: coords.lon,
      occurredAt: String(tx.timestamp * 1000),
      txHash: tx.hash,
    };
  });
}

export async function listWhaleTransfers(
  _ctx: ServerContext,
  req: ListWhaleTransfersRequest,
): Promise<ListWhaleTransfersResponse> {
  try {
    const transfers = await fetchWhaleTransfers(req);
    return { transfers, fetchedAt: String(Date.now()) };
  } catch {
    return { transfers: syntheticFallback(), fetchedAt: String(Date.now()) };
  }
}
