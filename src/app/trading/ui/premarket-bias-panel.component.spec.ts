import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { PremarketBiasView, PremarketHistory, PremarketTargetCheck } from '../trading.models';
import { PremarketBiasPanelComponent } from './premarket-bias-panel.component';

const check = (
  movePct: number | null,
  actual: PremarketTargetCheck['actual'],
  correct: boolean | null,
): PremarketTargetCheck => ({ movePct, actual, correct });

/** 2026-10-21 as the scraper published it, with that day's outcome. */
const BULLISH: PremarketBiasView = {
  date: '2026-10-21',
  analysisTime: '2026-10-21T09:14:31+05:30',
  runStatus: 'FINALIZED',
  isFinal: true,
  score: 63.15,
  label: 'Bullish',
  strong: true,
  headline: 'Strong bullish',
  confidence: { label: 'High', score: 85 },
  indexGapPct: 0.43,
  breadthSignal: 0.56,
  advancers: 32,
  decliners: 9,
  outcome: { trade_date: '2026-10-21' },
  evaluation: {
    predicted: 'up',
    openGap: check(0.5551, 'up', true),
    open30m: check(0.3548, 'up', true),
    openToClose: check(-0.8892, 'down', false),
  },
  updatedAt: 0,
  analysis: {
    breadth: {
      top_positive: [{ symbol: 'ICICIBANK', gap_pct: 1.81 }],
      top_negative: [{ symbol: 'TCS', gap_pct: -0.4 }],
    },
    explanations: { conclusion: 'Bullish pre-market bias.' },
  },
};

const NEUTRAL = {
  ...BULLISH,
  date: '2026-10-19',
  score: 6.7,
  label: 'Neutral / mixed',
  evaluation: {
    predicted: 'flat' as const,
    openGap: check(0.0203, 'flat', null),
    open30m: check(-0.0244, 'flat', null),
    openToClose: check(-1.1313, 'down', null),
  },
};

const HISTORY: PremarketHistory = {
  days: [BULLISH, NEUTRAL],
  scorecard: {
    days: 2,
    calls: 1,
    openGap: { checked: 1, correct: 1 },
    open30m: { checked: 1, correct: 1 },
    openToClose: { checked: 1, correct: 0 },
  },
};

describe('PremarketBiasPanelComponent', () => {
  let fixture: ComponentFixture<PremarketBiasPanelComponent>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';

  beforeEach(() => {
    fixture = TestBed.createComponent(PremarketBiasPanelComponent);
  });

  it('shows the call, its confidence and how it turned out on each target', () => {
    fixture.componentRef.setInput('bias', BULLISH);
    fixture.detectChanges();

    const call = el().querySelector('.call')!;
    expect(call.classList).toContain('up');
    expect(call.textContent).toContain('Bullish');
    expect(call.textContent).toContain('+63.15');
    expect(text()).toContain('Final');
    expect(text()).toContain('High confidence');
    expect(text()).toContain('32 up');

    const checks = [...el().querySelectorAll('.checks span')].map((s) => s.textContent?.trim());
    expect(checks).toEqual(['Gap ✓ up', '30m ✓ up', 'Close ✗ down']);
    expect(el().querySelector('.checks .miss')?.textContent).toContain('Close');
    expect(text()).toContain('Bullish pre-market bias.');
    expect(text()).toContain('ICICIBANK +1.81%');
  });

  it('says pending before the outcome is in', () => {
    fixture.componentRef.setInput('bias', {
      ...BULLISH,
      evaluation: {
        predicted: 'up',
        openGap: check(null, null, null),
        open30m: check(null, null, null),
        openToClose: check(null, null, null),
      },
    });
    fixture.detectChanges();
    expect(el().querySelector('.checks')?.textContent).toContain('Gap pending');
  });

  it('lists the track record with the scorecard', () => {
    fixture.componentRef.setInput('bias', BULLISH);
    fixture.componentRef.setInput('history', HISTORY);
    fixture.detectChanges();

    expect(el().querySelector('.score-head')?.textContent).toContain(
      '1 call(s) in 2 day(s) · gap 1/1 · 30m 1/1 · close 0/1',
    );
    const rows = [...el().querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
    );
    expect(rows[0]).toEqual([
      '2026-10-21',
      'Bullish',
      '+63.15',
      'High',
      '+0.56% ✓',
      '+0.35% ✓',
      '−0.89% ✗',
    ]);
    // A neutral day makes no call: moves shown, nothing marked.
    expect(rows[1]?.slice(4)).toEqual(['+0.02%', '−0.02%', '−1.13%']);
  });

  it('shows why there is nothing to show', () => {
    fixture.componentRef.setInput('error', 'No pre-market bias published yet');
    fixture.detectChanges();
    expect(el().querySelector('.empty')?.textContent).toContain('No pre-market bias published yet');
  });
});
