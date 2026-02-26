import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { MarketData, CryptoData } from '@/types';
import { formatPrice, formatChange, getChangeClass, getHeatmapClass } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';

function miniSparkline(data: number[] | undefined, change: number | null, w = 50, h = 16): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const color = change != null && change >= 0 ? 'var(--green)' : 'var(--red)';
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="mini-sparkline"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}



export class MarketPanel extends Panel {
  constructor() {
    super({ id: 'markets', title: t('panels.markets') });
  }

  public renderMarkets(data: MarketData[]): void {
    if (data.length === 0) {
      this.showError(t('common.failedMarketData'));
      return;
    }

    const html = data
      .map(
        (stock) => `
      <div class="market-item">
        <div class="market-info">
          <span class="market-name">${escapeHtml(stock.name)}</span>
          <span class="market-symbol">${escapeHtml(stock.display)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(stock.sparkline, stock.change)}
          <span class="market-price">${formatPrice(stock.price!)}</span>
          <span class="market-change ${getChangeClass(stock.change!)}">${formatChange(stock.change!)}</span>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
  }
}

export class HeatmapPanel extends Panel {
  constructor() {
    super({ id: 'heatmap', title: t('panels.heatmap') });
  }

  public renderHeatmap(data: Array<{ name: string; change: number | null }>): void {
    const validData = data.filter((d) => d.change !== null);

    if (validData.length === 0) {
      this.showError(t('common.failedSectorData'));
      return;
    }

    const html =
      '<div class="heatmap">' +
      validData
        .map(
          (sector) => `
        <div class="heatmap-cell ${getHeatmapClass(sector.change!)}">
          <div class="sector-name">${escapeHtml(sector.name)}</div>
          <div class="sector-change ${getChangeClass(sector.change!)}">${formatChange(sector.change!)}</div>
        </div>
      `
        )
        .join('') +
      '</div>';

    this.setContent(html);
  }
}

export class CommoditiesPanel extends Panel {
  constructor() {
    super({ id: 'commodities', title: t('panels.commodities') });
  }

  public renderCommodities(data: Array<{ display: string; price: number | null; change: number | null; sparkline?: number[] }>): void {
    const validData = data.filter((d) => d.price !== null);

    if (validData.length === 0) {
      this.showError(t('common.failedCommodities'));
      return;
    }

    const html =
      '<div class="commodities-grid">' +
      validData
        .map(
          (c) => `
        <div class="commodity-item">
          <div class="commodity-name">${escapeHtml(c.display)}</div>
          ${miniSparkline(c.sparkline, c.change, 60, 18)}
          <div class="commodity-price">${formatPrice(c.price!)}</div>
          <div class="commodity-change ${getChangeClass(c.change!)}">${formatChange(c.change!)}</div>
        </div>
      `
        )
        .join('') +
      '</div>';

    this.setContent(html);
  }
}

export class CryptoPanel extends Panel {
  private whaleData: Array<{ blockchain: string; valueUsd: number; fromLabel: string; toLabel: string; transferType: string; timestamp: number }> = [];

  constructor() {
    super({ id: 'crypto', title: t('panels.crypto') });
  }

  public setWhaleTransfers(transfers: Array<{ blockchain: string; valueUsd: number; fromLabel: string; toLabel: string; transferType: string; timestamp: number }>): void {
    this.whaleData = transfers;
    this.renderWhaleSection();
  }

  private renderWhaleSection(): void {
    // Remove existing whale section if present
    this.content.querySelector('.whale-section')?.remove();
    if (this.whaleData.length === 0) return;

    const transfers = this.whaleData.slice(0, 10);
    const rows = transfers.map(tr => {
      const typeColor = tr.transferType === 'exchange_deposit' ? '#ff4444' : tr.transferType === 'exchange_withdrawal' ? '#44ff44' : '#8888ff';
      return `<div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px;">
        <span style="color: ${typeColor};">${escapeHtml(tr.blockchain)}</span>
        <span>$${(tr.valueUsd / 1e6).toFixed(1)}M</span>
        <span style="color: var(--text-muted);">${escapeHtml(tr.fromLabel)} → ${escapeHtml(tr.toLabel)}</span>
      </div>`;
    }).join('');

    const section = document.createElement('div');
    section.className = 'whale-section';
    section.style.cssText = 'margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 8px;';
    section.innerHTML = `
      <h4 style="margin: 0 0 6px; font-size: 11px; color: var(--text-secondary); text-transform: uppercase;">🐋 Whale Transfers</h4>
      ${rows}
    `;
    this.content.appendChild(section);
  }

  public renderCrypto(data: CryptoData[]): void {
    if (data.length === 0) {
      this.showError(t('common.failedCryptoData'));
      return;
    }

    const html = data
      .map(
        (coin) => `
      <div class="market-item">
        <div class="market-info">
          <span class="market-name">${escapeHtml(coin.name)}</span>
          <span class="market-symbol">${escapeHtml(coin.symbol)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(coin.sparkline, coin.change)}
          <span class="market-price">$${coin.price.toLocaleString()}</span>
          <span class="market-change ${getChangeClass(coin.change)}">${formatChange(coin.change)}</span>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
    this.renderWhaleSection();
  }
}
