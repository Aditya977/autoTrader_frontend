import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ExportManifest, StoredSeries } from '../trading.models';
import { StoredDataPanelComponent } from './stored-data-panel.component';

const series = (overrides: Partial<StoredSeries>): StoredSeries => ({
  instrumentKey: 'NSE_INDEX|Nifty 50',
  tradingsymbol: 'NIFTY',
  role: 'UNDERLYING',
  underlying: 'NIFTY',
  strike: null,
  expiry: null,
  bars: 3750,
  firstDate: '2026-09-08',
  lastDate: '2026-09-22',
  ...overrides,
});

const MANIFEST: ExportManifest = {
  generatedAt: '2026-11-01T06:00:00.000Z',
  paperTrades: { count: 3, firstDate: '2026-10-06', lastDate: '2026-10-06' },
  tradedContracts: 1,
  datasets: [
    {
      id: 1,
      label: 'daily capture',
      status: 'COMPLETE',
      interval: '1minute',
      fromDate: '2026-09-08',
      toDate: '2026-09-22',
      series: [
        series({}),
        series({
          instrumentKey: 'NSE_FO|65900',
          tradingsymbol: 'NIFTY 24000 CE 29 SEP 26',
          role: 'CE',
          strike: 24000,
          expiry: '2026-09-29',
          bars: 2250,
          firstDate: '2026-09-15',
          lastDate: '2026-09-21',
        }),
      ],
    },
  ],
};

describe('StoredDataPanelComponent', () => {
  let fixture: ComponentFixture<StoredDataPanelComponent>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(StoredDataPanelComponent);
  });

  it('totals the trades, series and bars, and how far each kind reaches', () => {
    fixture.componentRef.setInput('manifest', MANIFEST);
    fixture.detectChanges();

    const totals = [...el().querySelectorAll('.totals dd')].map((dd) =>
      dd.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(totals).toEqual([
      '3 2026-10-06 → 2026-10-06',
      '1',
      '1 to 2026-09-22',
      '1 to 2026-09-21',
      '6,000',
    ]);
  });

  it('lists each dataset’s series, index and options', () => {
    fixture.componentRef.setInput('manifest', MANIFEST);
    fixture.detectChanges();

    expect(el().querySelector('summary')?.textContent).toContain('daily capture');
    const rows = [...el().querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['NIFTY', 'Index', '3,750', '2026-09-08', '2026-09-22'],
      ['NIFTY 24000 CE 29 SEP 26', 'CE', '2,250', '2026-09-15', '2026-09-21'],
    ]);
  });

  it('shows the error when the manifest could not be loaded', () => {
    fixture.componentRef.setInput('error', 'redeploy it');
    fixture.detectChanges();
    expect(el().querySelector('.empty')?.textContent).toContain('redeploy it');
  });
});
