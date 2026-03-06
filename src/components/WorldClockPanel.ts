import { Panel } from './Panel';
import { getLocale } from '@/services/i18n';

interface CityEntry {
  id: string;
  city: string;
  label: string;
  timezone: string;
  marketOpen?: number;
  marketClose?: number;
}

const WORLD_CITIES: CityEntry[] = [
  { id: 'new-york', city: 'New York', label: 'NYSE', timezone: 'America/New_York', marketOpen: 9, marketClose: 16 },
  { id: 'chicago', city: 'Chicago', label: 'CME', timezone: 'America/Chicago', marketOpen: 8, marketClose: 15 },
  { id: 'sao-paulo', city: 'São Paulo', label: 'B3', timezone: 'America/Sao_Paulo', marketOpen: 10, marketClose: 17 },
  { id: 'london', city: 'London', label: 'LSE', timezone: 'Europe/London', marketOpen: 8, marketClose: 16 },
  { id: 'paris', city: 'Paris', label: 'Euronext', timezone: 'Europe/Paris', marketOpen: 9, marketClose: 17 },
  { id: 'frankfurt', city: 'Frankfurt', label: 'XETRA', timezone: 'Europe/Berlin', marketOpen: 9, marketClose: 17 },
  { id: 'zurich', city: 'Zurich', label: 'SIX', timezone: 'Europe/Zurich', marketOpen: 9, marketClose: 17 },
  { id: 'moscow', city: 'Moscow', label: 'MOEX', timezone: 'Europe/Moscow', marketOpen: 10, marketClose: 18 },
  { id: 'istanbul', city: 'Istanbul', label: 'BIST', timezone: 'Europe/Istanbul', marketOpen: 10, marketClose: 18 },
  { id: 'riyadh', city: 'Riyadh', label: 'Tadawul', timezone: 'Asia/Riyadh', marketOpen: 10, marketClose: 15 },
  { id: 'dubai', city: 'Dubai', label: 'DFM', timezone: 'Asia/Dubai', marketOpen: 10, marketClose: 14 },
  { id: 'mumbai', city: 'Mumbai', label: 'NSE', timezone: 'Asia/Kolkata', marketOpen: 9, marketClose: 15 },
  { id: 'bangkok', city: 'Bangkok', label: 'SET', timezone: 'Asia/Bangkok', marketOpen: 10, marketClose: 16 },
  { id: 'singapore', city: 'Singapore', label: 'SGX', timezone: 'Asia/Singapore', marketOpen: 9, marketClose: 17 },
  { id: 'hong-kong', city: 'Hong Kong', label: 'HKEX', timezone: 'Asia/Hong_Kong', marketOpen: 9, marketClose: 16 },
  { id: 'shanghai', city: 'Shanghai', label: 'SSE', timezone: 'Asia/Shanghai', marketOpen: 9, marketClose: 15 },
  { id: 'seoul', city: 'Seoul', label: 'KRX', timezone: 'Asia/Seoul', marketOpen: 9, marketClose: 15 },
  { id: 'tokyo', city: 'Tokyo', label: 'TSE', timezone: 'Asia/Tokyo', marketOpen: 9, marketClose: 15 },
  { id: 'sydney', city: 'Sydney', label: 'ASX', timezone: 'Australia/Sydney', marketOpen: 10, marketClose: 16 },
  { id: 'auckland', city: 'Auckland', label: 'NZX', timezone: 'Pacific/Auckland', marketOpen: 10, marketClose: 16 },
  { id: 'toronto', city: 'Toronto', label: 'TSX', timezone: 'America/Toronto', marketOpen: 9, marketClose: 16 },
  { id: 'mexico-city', city: 'Mexico City', label: 'BMV', timezone: 'America/Mexico_City', marketOpen: 8, marketClose: 15 },
  { id: 'buenos-aires', city: 'Buenos Aires', label: 'BYMA', timezone: 'America/Argentina/Buenos_Aires', marketOpen: 11, marketClose: 17 },
  { id: 'johannesburg', city: 'Johannesburg', label: 'JSE', timezone: 'Africa/Johannesburg', marketOpen: 9, marketClose: 17 },
  { id: 'cairo', city: 'Cairo', label: 'EGX', timezone: 'Africa/Cairo', marketOpen: 10, marketClose: 14 },
  { id: 'lagos', city: 'Lagos', label: 'NGX', timezone: 'Africa/Lagos', marketOpen: 10, marketClose: 14 },
  { id: 'los-angeles', city: 'Los Angeles', label: 'Pacific', timezone: 'America/Los_Angeles' },
  { id: 'jakarta', city: 'Jakarta', label: 'IDX', timezone: 'Asia/Jakarta', marketOpen: 9, marketClose: 16 },
  { id: 'taipei', city: 'Taipei', label: 'TWSE', timezone: 'Asia/Taipei', marketOpen: 9, marketClose: 13 },
  { id: 'kuala-lumpur', city: 'Kuala Lumpur', label: 'Bursa', timezone: 'Asia/Kuala_Lumpur', marketOpen: 9, marketClose: 17 },
];

const CITY_REGIONS: { name: string; ids: string[] }[] = [
  { name: 'Americas', ids: ['new-york', 'chicago', 'toronto', 'los-angeles', 'mexico-city', 'sao-paulo', 'buenos-aires'] },
  { name: 'Europe', ids: ['london', 'paris', 'frankfurt', 'zurich', 'moscow', 'istanbul'] },
  { name: 'Middle East & Africa', ids: ['riyadh', 'dubai', 'cairo', 'lagos', 'johannesburg'] },
  { name: 'Asia-Pacific', ids: ['mumbai', 'bangkok', 'jakarta', 'kuala-lumpur', 'singapore', 'hong-kong', 'shanghai', 'taipei', 'seoul', 'tokyo', 'sydney', 'auckland'] },
];
const CITY_BY_ID = new Map(WORLD_CITIES.map((city) => [city.id, city]));

const TIMEZONE_TO_CITY: Record<string, string> = {};
for (const c of WORLD_CITIES) {
  TIMEZONE_TO_CITY[c.timezone] = c.id;
}
TIMEZONE_TO_CITY['America/Detroit'] = 'new-york';
TIMEZONE_TO_CITY['US/Eastern'] = 'new-york';
TIMEZONE_TO_CITY['US/Central'] = 'chicago';
TIMEZONE_TO_CITY['US/Pacific'] = 'los-angeles';
TIMEZONE_TO_CITY['US/Mountain'] = 'new-york';
TIMEZONE_TO_CITY['Asia/Calcutta'] = 'mumbai';
TIMEZONE_TO_CITY['Asia/Saigon'] = 'bangkok';
TIMEZONE_TO_CITY['Pacific/Sydney'] = 'sydney';

const STORAGE_KEY = 'worldmonitor-world-clock-cities';
const DEFAULT_CITIES = ['new-york', 'london', 'dubai', 'bangkok', 'tokyo', 'sydney'];

function detectHomeCity(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_TO_CITY[tz] ?? null;
  } catch {
    return null;
  }
}

function loadSelectedCities(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  const home = detectHomeCity();
  const defaults = [...DEFAULT_CITIES];
  if (home && !defaults.includes(home)) defaults.unshift(home);
  return defaults;
}

function saveSelectedCities(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function getTimeInZone(tz: string): { h: number; m: number; s: number; dayOfWeek: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat(getLocale(), {
    timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, weekday: 'short',
    numberingSystem: 'latn',
  }).formatToParts(now);
  let h = 0, m = 0, s = 0, dayOfWeek = '';
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    if (p.type === 'minute') m = parseInt(p.value, 10);
    if (p.type === 'second') s = parseInt(p.value, 10);
    if (p.type === 'weekday') dayOfWeek = p.value;
  }
  if (h === 24) h = 0;
  return { h, m, s, dayOfWeek };
}

function getTzAbbr(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat(getLocale(), { timeZone: tz, timeZoneName: 'short' });
    const parts = fmt.formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value ?? '';
  } catch {
    return '';
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const STYLE = `<style>
.wc-container{display:flex;flex-direction:column}
.wc-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;padding:7px 10px;border-bottom:1px solid var(--border-subtle,#1a1a1a);transition:background .15s;gap:0}
.wc-row:last-child{border-bottom:none}
.wc-row:hover{background:var(--surface-hover,#1e1e1e)}
.wc-row.wc-home{border-left:2px solid #44ff88;padding-left:8px;background:rgba(68,255,136,.03)}
.wc-row.wc-night .wc-time{opacity:.65}
.wc-info{display:flex;flex-direction:column;gap:3px;min-width:0}
.wc-name{font-size:12px;font-weight:700;color:var(--text,#e8e8e8);letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-home-tag{font-size:9px;color:#44ff88;margin-left:4px;font-weight:400;opacity:.7}
.wc-detail{display:flex;align-items:center;gap:6px}
.wc-exchange{font-size:10px;color:var(--text-dim,#888);letter-spacing:.5px;text-transform:uppercase}
.wc-status{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:600;letter-spacing:.5px}
.wc-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.wc-dot.open{background:#44ff88;box-shadow:0 0 6px rgba(68,255,136,.6);animation:wc-pulse 2s ease-in-out infinite}
.wc-dot.closed{background:var(--text-muted,#666)}
.wc-status.open{color:#44ff88}
.wc-status.closed{color:var(--text-muted,#666)}
.wc-clock{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0}
.wc-time{font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--text,#e8e8e8);letter-spacing:1.5px;line-height:1;font-variant-numeric:tabular-nums}
.wc-tz{font-size:9px;color:var(--text-dim,#888);display:flex;align-items:center;gap:6px}
.wc-bar-wrap{width:36px;height:3px;background:var(--border,#2a2a2a);border-radius:2px;overflow:hidden}
.wc-bar{height:100%;border-radius:2px;transition:width 1s linear}
.wc-bar.day{background:linear-gradient(90deg,#44ff88,#88ff44)}
.wc-bar.night{background:linear-gradient(90deg,#445,#556)}
@keyframes wc-pulse{0%,100%{opacity:1}50%{opacity:.4}}
.wc-settings-btn{background:none;border:1px solid transparent;color:var(--text-dim,#888);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:all .15s;line-height:1}
.wc-settings-btn:hover{background:var(--overlay-light,rgba(255,255,255,.05));color:var(--text,#e8e8e8);border-color:var(--border,#2a2a2a)}
.wc-settings-btn.wc-active{background:rgba(68,255,136,.1);color:#44ff88;border-color:rgba(68,255,136,.3)}
.wc-settings-view{padding:2px 0}
.wc-region-header{font-size:9px;font-weight:600;color:var(--text-dim,#888);text-transform:uppercase;letter-spacing:1px;padding:8px 10px 4px;border-bottom:1px solid var(--border-subtle,#1a1a1a)}
.wc-region-header:first-child{padding-top:4px}
.wc-region-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
.wc-city-option{display:flex;align-items:center;gap:6px;padding:5px 10px;cursor:pointer;transition:background .1s;font-size:11px}
.wc-city-option:hover{background:var(--surface-hover,#1e1e1e)}
.wc-city-option input[type=checkbox]{accent-color:#44ff88;width:12px;height:12px;flex-shrink:0;cursor:pointer}
.wc-opt-name{font-weight:600;color:var(--text,#e8e8e8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-opt-label{font-size:9px;color:var(--text-muted,#666);margin-left:auto;flex-shrink:0}
.wc-empty{padding:20px 10px;text-align:center;color:var(--text-dim,#888);font-size:11px}
.wc-drag-handle{cursor:grab;color:var(--text-muted,#555);font-size:11px;padding:0 6px 0 2px;user-select:none;opacity:.35;transition:opacity .15s;display:flex;align-items:center}
.wc-row:hover .wc-drag-handle{opacity:.6}
.wc-drag-handle:hover{opacity:1!important;color:var(--text,#e8e8e8);cursor:grab}
.wc-row.wc-dragging{opacity:.3}
.wc-row.wc-drag-over-above{box-shadow:inset 0 2px 0 #44ff88}
.wc-row.wc-drag-over-below{box-shadow:inset 0 -2px 0 #44ff88}
</style>`;

interface ClockRowElements {
  row: HTMLElement;
  time: HTMLElement;
  tz: HTMLElement;
  bar: HTMLElement;
  status: HTMLElement | null;
}

export class WorldClockPanel extends Panel {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private selectedCities: string[] = [];
  private homeCityId: string | null = null;
  private showingSettings = false;
  private settingsBtn: HTMLButtonElement;
  private dragging = false;
  private dragCityId: string | null = null;
  private dragStartY = 0;
  private boundDragMouseMove!: (e: MouseEvent) => void;
  private boundDragMouseUp!: (e: MouseEvent) => void;
  private clockRows = new Map<string, ClockRowElements>();
  private cacheRowsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({ id: 'world-clock', title: 'World Clock', trackActivity: false });
    this.homeCityId = detectHomeCity();
    this.selectedCities = loadSelectedCities();

    this.settingsBtn = document.createElement('button');
    this.settingsBtn.className = 'wc-settings-btn';
    this.settingsBtn.textContent = '\u2699';
    this.settingsBtn.title = 'Select cities';
    this.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettings();
    });
    this.header.appendChild(this.settingsBtn);

    this.content.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.type === 'checkbox' && target.dataset.cityId) {
        const cityId = target.dataset.cityId;
        if (target.checked) {
          if (!this.selectedCities.includes(cityId)) this.selectedCities.push(cityId);
        } else {
          this.selectedCities = this.selectedCities.filter(id => id !== cityId);
        }
        saveSelectedCities(this.selectedCities);
      }
    });

    this.setupDragHandlers();
    this.renderClocks();
    this.startTicking();
  }

  private startTicking(): void {
    if (this.tickInterval !== null) return;
    this.tickInterval = setInterval(() => {
      if (!this.showingSettings && !this.dragging) this.refreshClockValues();
    }, 1000);
  }

  private stopTicking(): void {
    if (this.tickInterval === null) return;
    clearInterval(this.tickInterval);
    this.tickInterval = null;
  }

  protected override onPanelVisibilityChanged(visible: boolean): void {
    if (visible) {
      this.renderClocks();
      this.startTicking();
    } else {
      this.stopTicking();
    }
  }

  private toggleSettings(): void {
    this.showingSettings = !this.showingSettings;
    if (this.showingSettings) {
      this.settingsBtn.textContent = '\u2713';
      this.settingsBtn.title = 'Done';
      this.settingsBtn.classList.add('wc-active');
      this.renderSettings();
    } else {
      this.settingsBtn.textContent = '\u2699';
      this.settingsBtn.title = 'Select cities';
      this.settingsBtn.classList.remove('wc-active');
      this.renderClocks();
    }
  }

  private renderSettings(): void {
    this.clockRows.clear();
    if (this.cacheRowsTimer) {
      clearTimeout(this.cacheRowsTimer);
      this.cacheRowsTimer = null;
    }
    let html = STYLE + '<div class="wc-settings-view">';
    for (const region of CITY_REGIONS) {
      html += `<div class="wc-region-header">${region.name}</div><div class="wc-region-grid">`;
      for (const id of region.ids) {
        const city = CITY_BY_ID.get(id);
        if (!city) continue;
        const checked = this.selectedCities.includes(city.id) ? 'checked' : '';
        html += `<label class="wc-city-option"><input type="checkbox" data-city-id="${city.id}" ${checked}><span class="wc-opt-name">${city.city}</span><span class="wc-opt-label">${city.label}</span></label>`;
      }
      html += '</div>';
    }
    html += '</div>';
    this.setContent(html);
  }

  private setupDragHandlers(): void {
    const content = this.content;

    this.boundDragMouseMove = (e: MouseEvent) => {
      if (!this.dragCityId) return;
      if (!this.dragging && Math.abs(e.clientY - this.dragStartY) < 8) return;
      this.dragging = true;
      e.preventDefault();
      const rows = content.querySelectorAll('.wc-row[data-city-id]');
      rows.forEach(r => r.classList.remove('wc-drag-over-above', 'wc-drag-over-below'));
      for (const row of rows) {
        if ((row as HTMLElement).dataset.cityId === this.dragCityId) continue;
        const rect = row.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'wc-drag-over-above' : 'wc-drag-over-below');
        }
      }
    };

    this.boundDragMouseUp = (e: MouseEvent) => {
      if (!this.dragCityId) return;
      const dragId = this.dragCityId;
      this.dragCityId = null;
      const rows = content.querySelectorAll('.wc-row[data-city-id]');
      rows.forEach(r => r.classList.remove('wc-dragging', 'wc-drag-over-above', 'wc-drag-over-below'));

      if (this.dragging) {
        let targetId: string | null = null;
        let insertBefore = true;
        for (const row of rows) {
          const el = row as HTMLElement;
          if (el.dataset.cityId === dragId) continue;
          const rect = el.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetId = el.dataset.cityId ?? null;
            insertBefore = e.clientY < rect.top + rect.height / 2;
            break;
          }
        }
        if (targetId && targetId !== dragId) {
          const fromIdx = this.selectedCities.indexOf(dragId);
          if (fromIdx !== -1) {
            this.selectedCities.splice(fromIdx, 1);
            let toIdx = this.selectedCities.indexOf(targetId);
            if (!insertBefore) toIdx++;
            this.selectedCities.splice(toIdx, 0, dragId);
            saveSelectedCities(this.selectedCities);
          }
        }
      }
      this.dragging = false;
      this.renderClocks();
      document.removeEventListener('mousemove', this.boundDragMouseMove);
      document.removeEventListener('mouseup', this.boundDragMouseUp);
    };

    content.addEventListener('mousedown', (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest('.wc-drag-handle') as HTMLElement | null;
      if (!handle) return;
      const row = handle.closest('.wc-row') as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      this.dragCityId = row.dataset.cityId ?? null;
      this.dragStartY = e.clientY;
      this.dragging = false;
      row.classList.add('wc-dragging');
      document.addEventListener('mousemove', this.boundDragMouseMove);
      document.addEventListener('mouseup', this.boundDragMouseUp);
    });
  }

  private getSortedCities(): CityEntry[] {
    return this.selectedCities
      .map((id) => CITY_BY_ID.get(id))
      .filter((city): city is CityEntry => city != null);
  }

  private getStatusHtml(city: CityEntry, hour: number, dayOfWeek: string): string {
    if (city.marketOpen === undefined || city.marketClose === undefined) return '';
    const isWeekday = dayOfWeek !== 'Sat' && dayOfWeek !== 'Sun';
    const isOpen = isWeekday && hour >= city.marketOpen && hour < city.marketClose;
    return isOpen
      ? '<span class="wc-status open"><span class="wc-dot open"></span>OPEN</span>'
      : '<span class="wc-status closed"><span class="wc-dot closed"></span>CLSD</span>';
  }

  private cacheClockRows(): void {
    this.clockRows.clear();
    const rows = this.content.querySelectorAll<HTMLElement>('.wc-row[data-city-id]');
    rows.forEach((row) => {
      const cityId = row.dataset.cityId;
      const time = row.querySelector<HTMLElement>('.wc-time');
      const tz = row.querySelector<HTMLElement>('.wc-tz-label');
      const bar = row.querySelector<HTMLElement>('.wc-bar');
      if (!cityId || !time || !tz || !bar) return;
      this.clockRows.set(cityId, {
        row,
        time,
        tz,
        bar,
        status: row.querySelector<HTMLElement>('.wc-status'),
      });
    });
  }

  private renderClocks(): void {
    const sorted = this.getSortedCities();

    if (sorted.length === 0) {
      this.clockRows.clear();
      if (this.cacheRowsTimer) {
        clearTimeout(this.cacheRowsTimer);
        this.cacheRowsTimer = null;
      }
      this.setContent(STYLE + '<div class="wc-empty">No cities selected. Click \u2699 to add cities.</div>');
      return;
    }

    let html = STYLE + '<div class="wc-container">';
    for (const city of sorted) {
      const { h, m, s, dayOfWeek } = getTimeInZone(city.timezone);
      const isDay = h >= 6 && h < 20;
      const pct = ((h * 3600 + m * 60 + s) / 86400) * 100;
      const abbr = getTzAbbr(city.timezone);
      const isHome = city.id === this.homeCityId;
      const statusHtml = this.getStatusHtml(city, h, dayOfWeek);

      const rowCls = ['wc-row'];
      if (isHome) rowCls.push('wc-home');
      if (!isDay) rowCls.push('wc-night');

      html += `<div class="${rowCls.join(' ')}" data-city-id="${city.id}"><div class="wc-drag-handle" title="Drag to reorder">\u22EE</div><div class="wc-info"><div class="wc-name">${city.city}${isHome ? '<span class="wc-home-tag">\u2302</span>' : ''}</div><div class="wc-detail"><span class="wc-exchange">${city.label}</span>${statusHtml}</div></div><div class="wc-clock"><div class="wc-time">${pad2(h)}:${pad2(m)}:${pad2(s)}</div><div class="wc-tz"><div class="wc-bar-wrap"><div class="wc-bar ${isDay ? 'day' : 'night'}" style="width:${pct.toFixed(1)}%"></div></div><span class="wc-tz-label">${dayOfWeek} ${abbr}</span></div></div></div>`;
    }
    html += '</div>';
    this.setContent(html);
    if (this.cacheRowsTimer) clearTimeout(this.cacheRowsTimer);
    this.cacheRowsTimer = setTimeout(() => {
      this.cacheRowsTimer = null;
      this.cacheClockRows();
      this.refreshClockValues();
    }, 180);
  }

  private refreshClockValues(): void {
    const sorted = this.getSortedCities();
    if (sorted.length === 0 || this.clockRows.size === 0) return;
    if (sorted.length !== this.clockRows.size) {
      this.renderClocks();
      return;
    }

    for (const city of sorted) {
      const refs = this.clockRows.get(city.id);
      if (!refs) {
        this.renderClocks();
        return;
      }

      const { h, m, s, dayOfWeek } = getTimeInZone(city.timezone);
      const isDay = h >= 6 && h < 20;
      const pct = ((h * 3600 + m * 60 + s) / 86400) * 100;
      const abbr = getTzAbbr(city.timezone);

      refs.time.textContent = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
      refs.tz.textContent = `${dayOfWeek} ${abbr}`.trim();
      refs.bar.style.width = `${pct.toFixed(1)}%`;
      refs.bar.classList.toggle('day', isDay);
      refs.bar.classList.toggle('night', !isDay);
      refs.row.classList.toggle('wc-night', !isDay);

      if (refs.status) {
        refs.status.outerHTML = this.getStatusHtml(city, h, dayOfWeek);
        refs.status = refs.row.querySelector<HTMLElement>('.wc-status');
      }
    }
  }

  destroy(): void {
    this.stopTicking();
    if (this.cacheRowsTimer) {
      clearTimeout(this.cacheRowsTimer);
      this.cacheRowsTimer = null;
    }
    document.removeEventListener('mousemove', this.boundDragMouseMove);
    document.removeEventListener('mouseup', this.boundDragMouseUp);
    super.destroy();
  }
}
