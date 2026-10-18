import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { PaperStocksView, StockQuote } from '../trading.models';
import { Nifty50StocksPanelComponent } from './nifty50-stocks-panel.component';

const quote = (overrides: Partial<StockQuote>): StockQuote => ({
  symbol: 'RELIANCE',
  sector: 'Oil Gas & Consumable Fuels',
  instrumentKey: 'NSE_EQ|INE002A01018',
  lastPrice: null,
  prevClose: null,
  change: null,
  changePct: null,
  lastTickAt: null,
  ticks: 0,
  ...overrides,
});

const VIEW: PaperStocksView = {
  enabled: true,
  streaming: true,
  reason: null,
  tradeDate: '2026-10-19',
  stocks: [
    quote({
      symbol: 'RELIANCE',
      lastPrice: 1214,
      prevClose: 1200,
      change: 14,
      changePct: 1.17,
      ticks: 9,
    }),
    quote({
      symbol: 'TCS',
      sector: 'Information Technology',
      lastPrice: 2440,
      prevClose: 2465,
      change: -25,
      changePct: -1.01,
      ticks: 4,
    }),
    // Not ticked yet.
    quote({ symbol: 'HDFCBANK', sector: 'Financial Services' }),
  ],
};

describe('Nifty50StocksPanelComponent', () => {
  let fixture: ComponentFixture<Nifty50StocksPanelComponent>;
  const el = () => fixture.nativeElement as HTMLElement;
  const symbols = () =>
    [...el().querySelectorAll('tbody tr td.sym')].map((td) => td.textContent?.trim());

  beforeEach(() => {
    fixture = TestBed.createComponent(Nifty50StocksPanelComponent);
  });

  it('says the stocks are streaming and lists each with its price', () => {
    fixture.componentRef.setInput('view', VIEW);
    fixture.detectChanges();

    expect(el().querySelector('.pill')?.textContent).toContain('Streaming');
    expect(symbols()).toEqual(['HDFCBANK', 'RELIANCE', 'TCS']);
    const reliance = [...el().querySelectorAll('tbody tr')][1]?.textContent ?? '';
    expect(reliance).toContain('1,214.00');
    expect(reliance).toContain('+14.00');
    expect(reliance).toContain('+1.17%');
    // A stock with no tick yet shows dashes, not zeros.
    expect([...el().querySelectorAll('tbody tr')][0]?.textContent).toContain('—');
  });

  it('shows why the stocks are not streaming', () => {
    fixture.componentRef.setInput('view', {
      ...VIEW,
      streaming: false,
      reason: 'paper trading is not running: no strategies enabled',
    });
    fixture.detectChanges();

    expect(el().querySelector('.pill')?.textContent).toContain('Not streaming');
    expect(el().textContent).toContain('no strategies enabled');
  });

  it('sorts by % change, biggest gainer first, with unticked stocks last', () => {
    fixture.componentRef.setInput('view', VIEW);
    fixture.componentInstance.sortBy('changePct');
    fixture.detectChanges();

    expect(symbols()).toEqual(['RELIANCE', 'TCS', 'HDFCBANK']);
  });

  it('filters by sector', () => {
    fixture.componentRef.setInput('view', VIEW);
    fixture.componentInstance.sector.set('Information Technology');
    fixture.detectChanges();

    expect(symbols()).toEqual(['TCS']);
  });

  it('shows the load error when the backend could not answer', () => {
    fixture.componentRef.setInput('error', 'The backend does not serve NIFTY 50 stocks yet');
    fixture.detectChanges();

    expect(el().textContent).toContain('does not serve NIFTY 50 stocks yet');
  });
});
