import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChartStreamComponent } from './chart-stream.component';

/**
 * The chart panel's header has to fit inside the panel.
 *
 * A layout test rather than a behaviour one, because the failure it guards
 * against was not cosmetic. `.panel` sets `overflow: hidden`, so a header too
 * wide for it does not scroll and does not wrap — it is **clipped**, and the
 * last control on the row stops being clickable. That control is Stop.
 *
 * It happened for real: the toolbar grew to six buttons, and at the width two
 * legs get when they sit side by side the header needed 603px inside a 568px
 * panel, putting Stop's right edge 34px past the end. Nothing failed, nothing
 * logged, and the button was simply gone.
 *
 * 570px is not an arbitrary width. `.grid.pair` splits the page into two
 * columns at a 1180px viewport, which is about what each panel gets.
 */

@Component({
  standalone: true,
  imports: [ChartStreamComponent],
  template: `
    <div class="frame" [style.width.px]="width()">
      <app-chart-stream [label]="label()" [leg]="leg()" [displaySeconds]="60" />
    </div>
  `,
})
class HostComponent {
  readonly width = signal(570);
  readonly label = signal('NIFTY 24350 CE');
  readonly leg = signal<'CE' | 'PE' | null>('CE');
}

interface Mounted {
  element: HTMLElement;
  /** Re-renders after an interaction, so the menu can be opened and read. */
  render: () => void;
}

function mount(width: number): Mounted {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.width.set(width);
  fixture.detectChanges();

  const element = fixture.nativeElement as HTMLElement;
  // Attached to the document, because an element outside it has no layout and
  // every measurement below would read zero and pass.
  document.body.appendChild(element);
  fixture.detectChanges();
  return { element, render: () => fixture.detectChanges() };
}

describe('chart panel header layout', () => {
  let host: HTMLElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
    TestBed.resetTestingModule();
  });

  /** Widths worth checking: two legs side by side, one leg, and a phone. */
  for (const width of [570, 900, 360]) {
    it(`keeps the header inside the panel at ${width}px`, () => {
      host = mount(width).element;
      const head = host.querySelector('.head') as HTMLElement;
      expect(head.scrollWidth).toBeLessThanOrEqual(head.clientWidth);
    });

    it(`keeps Stop reachable at ${width}px`, () => {
      host = mount(width).element;
      const panel = host.querySelector('.panel') as HTMLElement;
      const stop = host.querySelector('.ghost.stop') as HTMLElement;

      const panelBox = panel.getBoundingClientRect();
      const stopBox = stop.getBoundingClientRect();
      // Inside on every side, not merely narrow enough on paper: a wrapped row
      // can still push a control below the header's own height.
      expect(stopBox.right).toBeLessThanOrEqual(panelBox.right);
      expect(stopBox.left).toBeGreaterThanOrEqual(panelBox.left);
      expect(stopBox.width).toBeGreaterThan(0);
    });
  }

  /**
   * One menu, not six buttons.
   *
   * The header fits because the overlay toggles moved behind a single control.
   * A future change that puts them back on the bar would re-create the clipping
   * this file exists to prevent, and the width assertions alone would not say
   * why it broke.
   */
  it('carries one overlay control rather than one per overlay', () => {
    host = mount(570).element;
    const state = host.querySelector('.state') as HTMLElement;
    const buttons = state.querySelectorAll(':scope > button, :scope > .ind > button');
    // The overlay menu and Stop.
    expect(buttons.length).toBe(2);
  });

  it('reaches every overlay toggle from that one control', () => {
    const mounted = mount(570);
    host = mounted.element;

    const trigger = host.querySelector('.ind > button') as HTMLButtonElement;
    trigger.click();
    mounted.render();

    const names = [...host.querySelectorAll('.menu .opt-name')].map((el) =>
      (el.textContent ?? '').trim(),
    );
    // Everything that used to be its own button on the header, plus the
    // indicators that were already behind a menu.
    expect(names).toContain('Support & resistance');
    expect(names).toContain('Previous day range');
    expect(names).toContain('Chart patterns');
    expect(names).toContain('Candlesticks');
    expect(names).toContain('VWAP');
  });
});
