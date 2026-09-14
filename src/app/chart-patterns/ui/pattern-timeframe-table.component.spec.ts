import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TimeframeRow } from '../engine/timeframe-scan';
import type { DetectedPattern } from '../types';
import { PatternTimeframeTableComponent } from './pattern-timeframe-table.component';

const pattern = (over: Partial<DetectedPattern> = {}): DetectedPattern => ({
  id: 'p1',
  type: 'double_bottom',
  direction: 'bullish',
  status: 'confirmed',
  startTime: 1,
  endTime: 2,
  pivots: [],
  lines: [],
  label: { text: '', anchor: { time: 1, price: 1 }, placement: 'below' },
  confidence: 0.83,
  ...over,
});

const row = (over: Partial<TimeframeRow> = {}): TimeframeRow => ({
  seconds: 60,
  label: '1m',
  name: '1 minute',
  bars: 300,
  patterns: [],
  ...over,
});

describe('PatternTimeframeTableComponent', () => {
  let fixture: ComponentFixture<PatternTimeframeTableComponent>;

  const render = (rows: TimeframeRow[], current: number | null = null) => {
    fixture.componentRef.setInput('timeframes', rows);
    fixture.componentRef.setInput('currentSeconds', current);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PatternTimeframeTableComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(PatternTimeframeTableComponent);
  });

  it('renders one card per timeframe, in the order given', () => {
    render([
      row({ seconds: 60, label: '1m', name: '1 minute' }),
      row({ seconds: 300, label: '5m', name: '5 minutes' }),
      row({ seconds: 1800, label: '30m', name: '30 minutes' }),
      row({ seconds: 3600, label: '1h', name: '1 hour' }),
      row({ seconds: 86_400, label: '1d', name: '1 day' }),
    ]);
    const cards = fixture.nativeElement.querySelectorAll('.card');
    expect(cards.length).toBe(5);
    expect(
      [...cards].map((c: Element) => c.querySelector('.tf')?.textContent?.trim()),
    ).toEqual(['1m', '5m', '30m', '1h', '1d']);
  });

  it('names the pattern, its status and its score', () => {
    const text = render([row({ patterns: [pattern()] })]);
    expect(text).toContain('Double bottom');
    expect(text).toContain('confirmed');
    expect(text).toContain('83%');
  });

  it('marks the timeframe the chart is drawing', () => {
    render([row({ seconds: 60 }), row({ seconds: 300, label: '5m', name: '5 minutes' })], 300);
    const current = fixture.nativeElement.querySelectorAll('.card.current');
    expect(current.length).toBe(1);
    expect(current[0].querySelector('.tf')?.textContent?.trim()).toBe('5m');
  });

  /**
   * The two empty states are different statements and must not read alike.
   *
   * "Nothing forming" means the engine looked and found nothing. "Not enough
   * bars" means it could not look — which is the ordinary case at a daily size
   * on a chart showing one session. A reader who took the second for the first
   * would conclude the market was quiet.
   */
  it('says nothing was found when there were bars to look at', () => {
    const text = render([row({ bars: 300, patterns: [] })]);
    expect(text).toContain('No pattern above 75%');
  });

  it('says so instead when there were barely any bars', () => {
    const text = render([row({ seconds: 86_400, label: '1d', bars: 2, patterns: [] })]);
    expect(text).toContain('Not enough bars');
    expect(text).not.toContain('No pattern above 75%');
  });

  it('lists several patterns under one timeframe', () => {
    render([
      row({
        patterns: [
          pattern({ id: 'a' }),
          pattern({ id: 'b', type: 'double_top', direction: 'bearish' }),
        ],
      }),
    ]);
    expect(fixture.nativeElement.querySelectorAll('.patterns li').length).toBe(2);
  });

  /** The dot colour is what ties a row back to the outline on the chart. */
  it('colours each row by direction', () => {
    render([
      row({
        patterns: [
          pattern({ id: 'a', direction: 'bullish' }),
          pattern({ id: 'b', direction: 'bearish' }),
        ],
      }),
    ]);
    expect(fixture.nativeElement.querySelectorAll('.dot.bullish').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.dot.bearish').length).toBe(1);
  });

  it('renders nothing at all rather than throwing on an empty list', () => {
    render([]);
    expect(fixture.nativeElement.querySelectorAll('.card').length).toBe(0);
  });
});
