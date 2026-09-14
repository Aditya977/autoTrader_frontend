import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { SessionLookupComponent } from './session-lookup.component';

const base = environment.apiBase;

/**
 * What the lookup does when there is nothing to look up.
 *
 * This is the case that actually reached a user: the journal held no captured
 * bars, `/symbols` answered `{ symbols: [] }`, and because an empty list is a
 * *successful* response it never reached the error branch. The panel rendered
 * three dead dropdowns and no explanation, which reads as a broken page rather
 * than an empty one.
 *
 * Both empty lists are pinned here because both are silent by default and
 * neither is a fault worth throwing over.
 */
describe('SessionLookupComponent', () => {
  let fixture: ComponentFixture<SessionLookupComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionLookupComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionLookupComponent);
    fixture.componentRef.setInput('k', 4);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const text = () => fixture.nativeElement.textContent as string;

  const symbols = (list: string[]) => {
    fixture.detectChanges();
    http
      .expectOne(`${base}/strategy/day-shapes/symbols`)
      .flush({ symbols: list });
    fixture.detectChanges();
  };

  it('says why the picker is empty when nothing has been captured', () => {
    symbols([]);
    expect(text()).toContain('No instrument has enough captured history');
    // The cause, not just the symptom: a reader has to know where the data
    // comes from to know what to do about it.
    expect(text()).toContain('1-minute bars');
  });

  it('says so when the instrument has no session long enough to shape', () => {
    symbols(['NIFTY']);
    http
      .expectOne((r) => r.url.startsWith(`${base}/strategy/day-shapes/dates`))
      .flush({ dates: [] });
    fixture.detectChanges();

    expect(text()).toContain('NIFTY has no captured session long enough');
  });

  /**
   * The happy path still has to reach the session request, or the guard above
   * would be satisfied by a component that never loads anything at all.
   */
  it('loads the newest date once an instrument has one', () => {
    symbols(['NIFTY']);
    http
      .expectOne((r) => r.url.startsWith(`${base}/strategy/day-shapes/dates`))
      .flush({ dates: ['2026-09-04', '2026-09-03'] });
    fixture.detectChanges();

    const session = http.expectOne((r) =>
      r.url.startsWith(`${base}/strategy/day-shapes/session`),
    );
    const query = new URL(
      session.request.urlWithParams,
      'http://localhost',
    ).searchParams;
    expect(query.get('symbol')).toBe('NIFTY');
    expect(query.get('date')).toBe('2026-09-04');
    session.flush({ error: 'nothing to show, and that is not what is tested' });
    fixture.detectChanges();
  });
});
