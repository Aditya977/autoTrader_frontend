import { addDays, dateTime, money, percent, signedMoney, todayKey, tone } from './format';
import { instrumentLabel, toInstrument } from './ui/instrument-list-editor.component';

describe('trading format', () => {
  it('formats rupees Indian-style, with a real minus sign', () => {
    expect(money(123456.7)).toBe('₹1,23,456.70');
    expect(money(-40)).toBe('−₹40.00');
    expect(money(null)).toBe('—');
    expect(signedMoney(10)).toBe('+₹10.00');
    expect(signedMoney(0)).toBe('₹0.00');
  });

  it('formats percentages with a sign', () => {
    expect(percent(1.234)).toBe('+1.23%');
    expect(percent(-0.5)).toBe('−0.50%');
    expect(percent(null)).toBe('—');
  });

  it('shows times in IST whatever the browser zone', () => {
    // 05:44:58 UTC is 11:14:58 IST.
    expect(dateTime(Date.UTC(2026, 8, 21, 5, 44, 58))).toContain('11:14:58');
  });

  it('dates "today" by the exchange calendar', () => {
    // 20:00 UTC on the 20th is already the 21st in India.
    expect(todayKey(new Date(Date.UTC(2026, 8, 20, 20, 0)))).toBe('2026-09-21');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('colours by sign, treating sub-paisa as flat', () => {
    expect(tone(5)).toBe('pos');
    expect(tone(-5)).toBe('neg');
    expect(tone(0.001)).toBe('flat');
    expect(tone(null)).toBe('flat');
  });
});

describe('instrument rows', () => {
  it('sends only rows the backend can resolve', () => {
    expect(toInstrument({ type: 'CE', underlying: 'NIFTY', expiry: '', strike: '24500' })).toEqual(
      [],
    );
    expect(
      toInstrument({ type: 'CE', underlying: 'NIFTY', expiry: '2026-09-25', strike: '' }),
    ).toEqual([]);
    expect(toInstrument({ type: 'INDEX', underlying: '', expiry: '', strike: '' })).toEqual([]);
  });

  it('builds each instrument type with exactly the fields it needs', () => {
    expect(toInstrument({ type: 'INDEX', underlying: 'NIFTY', expiry: 'x', strike: '1' })).toEqual([
      { instrument: { type: 'INDEX', underlying: 'NIFTY' } },
    ]);
    expect(
      toInstrument({ type: 'FUTURE', underlying: 'NIFTY', expiry: '2026-09-25', strike: '1' }),
    ).toEqual([{ instrument: { type: 'FUTURE', underlying: 'NIFTY', expiry: '2026-09-25' } }]);
    expect(
      toInstrument({ type: 'PE', underlying: 'NIFTY', expiry: '2026-09-25', strike: '24500' }),
    ).toEqual([
      { instrument: { type: 'PE', underlying: 'NIFTY', expiry: '2026-09-25', strike: 24500 } },
    ]);
  });
});

describe('instrument chips', () => {
  it('read the way a trader names the contract', () => {
    expect(
      instrumentLabel({
        instrument: { type: 'CE', underlying: 'NIFTY', expiry: '2026-09-25', strike: 24500 },
      }),
    ).toMatch(/^NIFTY 24500 CE · 25 Sept?$/);
    expect(
      instrumentLabel({
        instrument: { type: 'FUTURE', underlying: 'BANKNIFTY', expiry: '2026-09-25' },
      }),
    ).toMatch(/^BANKNIFTY FUT · 25 Sept?$/);
    expect(instrumentLabel({ instrument: { type: 'INDEX', underlying: 'NIFTY' } })).toBe('NIFTY');
  });
});
