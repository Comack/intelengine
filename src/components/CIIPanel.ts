import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { calculateCII, getLearningProgress, type CountryScore } from '@/services/country-instability';

export class CIIPanel extends Panel {
  private scores: CountryScore[] = [];

  constructor() {
    super({
      id: 'cii',
      title: 'Country Instability Index',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>CII Methodology</strong>
        Score (0-100) per country based on:
        <ul>
          <li>40% baseline geopolitical risk</li>
          <li>Unrest: protests, fatalities, internet outages</li>
          <li>Security: military flights/vessels over territory</li>
          <li>Information: news velocity and alerts</li>
          <li>Hotspot proximity boost (strategic locations)</li>
        </ul>
        Event multipliers adjust for media coverage bias.`,
    });
    this.refresh();
  }

  private getLevelColor(level: CountryScore['level']): string {
    switch (level) {
      case 'critical': return '#ff4444';
      case 'high': return '#ff8800';
      case 'elevated': return '#ffaa00';
      case 'normal': return '#88aa44';
      case 'low': return '#22aa88';
    }
  }

  private getLevelEmoji(level: CountryScore['level']): string {
    switch (level) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'elevated': return '🟡';
      case 'normal': return '🟢';
      case 'low': return '⚪';
    }
  }

  private getTrendArrow(trend: CountryScore['trend'], change: number): string {
    if (trend === 'rising') return `<span class="trend-up">↑${change > 0 ? change : ''}</span>`;
    if (trend === 'falling') return `<span class="trend-down">↓${Math.abs(change)}</span>`;
    return '<span class="trend-stable">→</span>';
  }

  private renderLearningBanner(): string {
    const { inLearning, remainingMinutes, progress } = getLearningProgress();
    if (!inLearning) return '';

    return `
      <div class="cii-learning-banner">
        <div class="learning-icon">📊</div>
        <div class="learning-text">
          <div class="learning-title">Learning Mode</div>
          <div class="learning-desc">Calibrating scores (~${remainingMinutes}m remaining)</div>
        </div>
        <div class="learning-progress">
          <div class="learning-bar" style="width: ${progress}%"></div>
        </div>
      </div>
    `;
  }

  private renderCountry(country: CountryScore): string {
    const barWidth = country.score;
    const color = this.getLevelColor(country.level);
    const emoji = this.getLevelEmoji(country.level);
    const trend = this.getTrendArrow(country.trend, country.change24h);

    return `
      <div class="cii-country" data-code="${escapeHtml(country.code)}">
        <div class="cii-header">
          <span class="cii-emoji">${emoji}</span>
          <span class="cii-name">${escapeHtml(country.name)}</span>
          <span class="cii-score">${country.score}</span>
          ${trend}
        </div>
        <div class="cii-bar-container">
          <div class="cii-bar" style="width: ${barWidth}%; background: ${color};"></div>
        </div>
        <div class="cii-components">
          <span title="Unrest">U:${country.components.unrest}</span>
          <span title="Security">S:${country.components.security}</span>
          <span title="Information">I:${country.components.information}</span>
        </div>
      </div>
    `;
  }

  public async refresh(): Promise<void> {
    this.showLoading();

    try {
      this.scores = calculateCII();
      const withData = this.scores.filter(s => s.score > 0);
      this.setCount(withData.length);

      const { inLearning } = getLearningProgress();
      const learningBanner = this.renderLearningBanner();
      const learningClass = inLearning ? 'cii-learning' : '';

      if (withData.length === 0) {
        this.content.innerHTML = learningBanner + '<div class="empty-state">Collecting data...</div>';
        return;
      }

      const html = withData.map(s => this.renderCountry(s)).join('');
      this.content.innerHTML = learningBanner + `<div class="cii-list ${learningClass}">${html}</div>`;
    } catch (error) {
      console.error('[CIIPanel] Refresh error:', error);
      this.showError('Failed to calculate CII');
    }
  }

  public getScores(): CountryScore[] {
    return this.scores;
  }
}
