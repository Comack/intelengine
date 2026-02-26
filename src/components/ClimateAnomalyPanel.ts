import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { type ClimateAnomaly, getSeverityIcon, formatDelta } from '@/services/climate';
import { t } from '@/services/i18n';

export class ClimateAnomalyPanel extends Panel {
  private anomalies: ClimateAnomaly[] = [];
  private airQualityData: Array<{ city: string; aqi: number; dominantPollutant: string; level: string; latitude: number; longitude: number }> = [];
  private deforestationData: Array<{ country: string; areaHectares: number; confidence: number; detectedAt: number; latitude: number; longitude: number }> = [];
  private onZoneClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'climate',
      title: t('panels.climate'),
      showCount: true,
      trackActivity: true,
      infoTooltip: t('components.climate.infoTooltip'),
    });
    this.showLoading(t('common.loadingClimateData'));
  }

  public setZoneClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onZoneClick = handler;
  }

  public setAnomalies(anomalies: ClimateAnomaly[]): void {
    this.anomalies = anomalies;
    this.setCount(anomalies.length);
    this.renderContent();
  }

  public setAirQuality(readings: Array<{ city: string; aqi: number; dominantPollutant: string; level: string; latitude: number; longitude: number }>): void {
    this.airQualityData = readings;
    this.renderContent();
  }

  public setDeforestationAlerts(alerts: Array<{ country: string; areaHectares: number; confidence: number; detectedAt: number; latitude: number; longitude: number }>): void {
    this.deforestationData = alerts;
    this.renderContent();
  }

  private renderContent(): void {
    if (this.anomalies.length === 0) {
      this.setContent(`<div class="panel-empty">${t('components.climate.noAnomalies')}</div>`);
      return;
    }

    const sorted = [...this.anomalies].sort((a, b) => {
      const severityOrder = { extreme: 0, moderate: 1, normal: 2 };
      return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
    });

    const rows = sorted.map(a => {
      const icon = getSeverityIcon(a);
      const tempClass = a.tempDelta > 0 ? 'climate-warm' : 'climate-cold';
      const precipClass = a.precipDelta > 0 ? 'climate-wet' : 'climate-dry';
      const sevClass = `severity-${a.severity}`;
      const rowClass = a.severity === 'extreme' ? ' climate-extreme-row' : '';

      return `<tr class="climate-row${rowClass}" data-lat="${a.lat}" data-lon="${a.lon}">
        <td class="climate-zone"><span class="climate-icon">${icon}</span>${escapeHtml(a.zone)}</td>
        <td class="climate-num ${tempClass}">${formatDelta(a.tempDelta, '°C')}</td>
        <td class="climate-num ${precipClass}">${formatDelta(a.precipDelta, 'mm')}</td>
        <td><span class="climate-badge ${sevClass}">${t(`components.climate.severity.${a.severity}`)}</span></td>
      </tr>`;
    }).join('');

    this.setContent(`
      <div class="climate-panel-content">
        <table class="climate-table">
          <thead>
            <tr>
              <th>${t('components.climate.zone')}</th>
              <th>${t('components.climate.temp')}</th>
              <th>${t('components.climate.precip')}</th>
              <th>${t('components.climate.severityLabel')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);

    // Air Quality Alerts section
    const highAqi = this.airQualityData.filter(r => r.aqi >= 150);
    if (highAqi.length > 0) {
      const aqiRows = highAqi.map(r => {
        const aqiColor = r.aqi >= 300 ? '#8B0000' : r.aqi >= 200 ? '#ff4444' : '#ff8800';
        return `<div class="aqi-row" style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px;">
          <span>${escapeHtml(r.city)}</span>
          <span style="color: ${aqiColor};">AQI ${r.aqi}</span>
          <span style="color: var(--text-muted);">${escapeHtml(r.dominantPollutant)}</span>
        </div>`;
      }).join('');

      const aqiSection = document.createElement('div');
      aqiSection.className = 'air-quality-section';
      aqiSection.style.marginTop = '12px';
      aqiSection.innerHTML = `
        <h4 style="margin: 0 0 6px; font-size: 11px; color: var(--text-secondary); text-transform: uppercase;">Air Quality Alerts</h4>
        <div class="aqi-alerts">${aqiRows}</div>
      `;
      this.content.querySelector('.climate-panel-content')?.appendChild(aqiSection);
    }

    // Deforestation Alerts section
    if (this.deforestationData.length > 0) {
      const deforestRows = this.deforestationData.slice(0, 10).map(a => {
        return `<div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px;">
          <span>${escapeHtml(a.country)}</span>
          <span>${a.areaHectares.toFixed(0)} ha</span>
          <span style="color: var(--text-muted);">${a.confidence}%</span>
        </div>`;
      }).join('');

      const deforestSection = document.createElement('div');
      deforestSection.className = 'deforestation-section';
      deforestSection.style.marginTop = '12px';
      deforestSection.innerHTML = `
        <h4 style="margin: 0 0 6px; font-size: 11px; color: var(--text-secondary); text-transform: uppercase;">Deforestation Alerts</h4>
        <div class="deforestation-alerts">${deforestRows}</div>
      `;
      this.content.querySelector('.climate-panel-content')?.appendChild(deforestSection);
    }

    this.content.querySelectorAll('.climate-row').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) this.onZoneClick?.(lat, lon);
      });
    });
  }
}
