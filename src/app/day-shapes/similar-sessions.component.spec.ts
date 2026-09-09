import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { SimilarSessionsComponent } from './similar-sessions.component';
import type { SimilarSessionsView } from './day-shapes.models';

const base = environment.apiBase;

/**
 * The lookalike panel.
 *
 * The three behaviours worth pinning are the ones a reader would otherwise
 * have to trust: that the collapsed line reports the *pool* count rather than
 * the returned list's length, that an empty result renders an empty state
 * rather than a weak best-of, and that changing the threshold re-asks the
 * backend instead of filtering what is already on screen.
 */

const view = (over: Partial<SimilarSessionsView> = {}): SimilarSessionsView => ({
  symbol: 'NIFTY',
  date: '2026-09-04',
  timeframeMinutes: 15,
  windowMinutes: 375,
  windowPoints: 25,
  minScore: 75,
  matchCount: 40,
  matches: [
    {
      date: '2026-06-11',
      score: 91.4,
      correlation: 0.9612,
      amplitudeRatio: 0.9509,
      rmseAtr: 0.1837,
      points: 25,
      netAtr: 0.8412,
      amplitudeAtr: 1.0233,
      complete: true,
    },
    {
      date: '2026-03-02',
      score: 78.2,
      correlation: 0.8801,
      amplitudeRatio: 0.8886,
      rmseAtr: 0.3105,
      points: 25,
      netAtr: 0.5109,
      amplitudeAtr: 0.9012,
      complete: false,
    },
  ],
  query: { path: [0, 0.2, 0.5], complete: true, atrPrior: 118.4 },
  pool: {
    sessions: 612,
    from: '2023-02-01',
    to: '2026-09-09',
    priorOnly: false,
    skippedNoAtr: 0,
    skippedTooShort: 9,
  },
  ...over,
});

describe('SimilarSessionsComponent', () => {
  let fixture: ComponentFixture<SimilarSessionsComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SimilarSessionsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SimilarSessionsComponent);
    fixture.componentRef.setInput('symbol', 'NIFTY');
    fixture.componentRef.setInput('date', '2026-09-04');
    fixture.componentRef.setInput('timeframe', 15);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const flush = (body: SimilarSessionsView | { error: string }) => {
    fixture.detectChanges();
    const request = http.expectOne((r) =>
      r.url.startsWith(`${base}/strategy/day-shapes/similar`),
    );
    request.flush(body);
    fixture.detectChanges();
    return request;
  };

  /**
   * The query a request actually carried.
   *
   * Read off the URL, not `request.params`: the service builds its query
   * with `URLSearchParams` and appends it, which is the house style here, so
   * `HttpParams` is empty on every request it makes.
   */
  const queryOf = (request: { request: { urlWithParams: string } }) =>
    new URL(request.request.urlWithParams, 'http://localhost').searchParams;

  const text = () => fixture.nativeElement.textContent as string;

  it('asks for the session under the cursor at the default threshold', () => {
    const request = flush(view());
    expect(queryOf(request).get('symbol')).toBe('NIFTY');
    expect(queryOf(request).get('date')).toBe('2026-09-04');
    expect(queryOf(request).get('timeframe')).toBe('15');
    expect(queryOf(request).get('minScore')).toBe('75');
  });

  /**
   * The count is the pool's, not the list's. A panel that showed "2" because
   * two rows came back would understate the history every time the response
   * was capped.
   */
  it('reports the pool count, not the number of rows returned', () => {
    flush(view({ matchCount: 40 }));
    expect(text()).toContain('40');
    expect(text()).toContain('similar days');
  });

  it('says plainly when nothing clears the threshold', () => {
    flush(view({ matchCount: 0, matches: [] }));
    expect(text()).toContain('No day in this history resembles');
  });

  it('lists the dates only once expanded', () => {
    flush(view());
    expect(text()).not.toContain('2026-06-11');

    (
      fixture.nativeElement.querySelector('.summary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(text()).toContain('2026-06-11');
    expect(text()).toContain('91.4%');
  });

  /**
   * Both halves of the score are shown because they fail in opposite
   * directions: the same shape at a third of the size and a different shape at
   * the same size can both land near 40, and the composite alone cannot say
   * which happened.
   */
  it('shows the form and size components beside the score', () => {
    flush(view());
    (
      fixture.nativeElement.querySelector('.summary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(text()).toContain('form 0.96');
    expect(text()).toContain('size 0.95');
  });

  it('marks a match that was only a part day', () => {
    flush(view());
    (
      fixture.nativeElement.querySelector('.summary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(text()).toContain('part day');
  });

  it('says the score is a resemblance and not a probability', () => {
    flush(view());
    (
      fixture.nativeElement.querySelector('.summary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(text()).toContain('not a probability');
  });

  it('re-asks the backend when the threshold changes rather than filtering', () => {
    flush(view());
    const select = fixture.nativeElement.querySelector(
      '.gate select',
    ) as HTMLSelectElement;
    select.value = '80';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const second = http.expectOne((r) =>
      r.url.startsWith(`${base}/strategy/day-shapes/similar`),
    );
    expect(queryOf(second).get('minScore')).toBe('80');
    second.flush(view({ minScore: 80, matchCount: 12 }));
    fixture.detectChanges();
    expect(text()).toContain('12');
  });

  it('fetches that day’s candles when a match is clicked', () => {
    flush(view());
    (
      fixture.nativeElement.querySelector('.summary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.match') as HTMLButtonElement).click();
    fixture.detectChanges();

    const bars = http.expectOne((r) =>
      r.url.startsWith(`${base}/strategy/day-shapes/bars`),
    );
    expect(queryOf(bars).get('date')).toBe('2026-06-11');
    // Fifteen, not the trajectory grid: the bars endpoint serves the
    // taxonomy's timeframes and would reject a three.
    expect(queryOf(bars).get('timeframe')).toBe('15');
    bars.flush({
      symbol: 'NIFTY',
      date: '2026-06-11',
      timeframeMinutes: 15,
      issues: 0,
      bars: [
        {
          time: 1788244500000,
          open: 100,
          high: 105,
          low: 99,
          close: 104,
          volume: 0,
          sourceBars: 15,
          type: 'marubozu',
          named: 'marubozu',
          typeId: 10,
          sizeClass: 'large',
          direction: 1,
          patterns: [],
        },
      ],
    });
    fixture.detectChanges();
    expect(text()).toContain('marubozu');
  });

  it('shows a message instead of a chart when the day cannot be read', () => {
    flush(view());
    (
      fixture.nativeElement.querySelector('.summary') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.match') as HTMLButtonElement).click();
    fixture.detectChanges();

    http
      .expectOne((r) => r.url.startsWith(`${base}/strategy/day-shapes/bars`))
      .flush({ error: 'No session found for NIFTY on 2026-06-11.' });
    fixture.detectChanges();
    expect(text()).toContain('No session found');
  });

  it('surfaces a backend refusal as a sentence rather than a failure', () => {
    flush({ error: 'No session found for NIFTY on 2026-09-04.' });
    expect(text()).toContain('No session found');
  });
});
