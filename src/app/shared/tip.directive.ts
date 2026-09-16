import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, OnDestroy, inject, input } from '@angular/core';

let nextId = 0;

/**
 * A styled tooltip for a label: `<span [appTip]="'What this means'">`.
 *
 * Not the native `title` attribute, which waits most of a second, cannot wrap a
 * sentence to a readable width and looks like an error message on a dark page.
 * Not a CSS `::after` either: the panels that need explaining sit inside
 * scrolling, clipped containers, and a pseudo-element is cut off by exactly the
 * edge it most needs to cross. So the card is a fixed-position element on
 * `body`, placed below its host — or above it, when below would leave the
 * window — and removed the moment the pointer or focus leaves.
 *
 * An empty text shows nothing, so a caller can bind a help string that is
 * sometimes absent without an `@if` around every label.
 */
@Directive({
  selector: '[appTip]',
  standalone: true,
  host: {
    '(mouseenter)': 'show()',
    '(focusin)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
    '[class.has-tip]': '!!appTip()',
  },
})
export class TipDirective implements OnDestroy {
  readonly appTip = input<string | null | undefined>('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private card: HTMLElement | null = null;
  private readonly id = `app-tip-${nextId++}`;

  show(): void {
    const text = this.appTip();
    if (!text || this.card) return;

    const card = this.document.createElement('div');
    card.id = this.id;
    card.setAttribute('role', 'tooltip');
    card.textContent = text;
    Object.assign(card.style, {
      position: 'fixed',
      zIndex: '1000',
      maxWidth: '300px',
      padding: '6px 9px',
      borderRadius: '6px',
      border: '1px solid #2f4459',
      background: 'rgba(13, 19, 26, 0.97)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      color: '#d6e0ea',
      font: '400 11.5px/1.45 system-ui, sans-serif',
      whiteSpace: 'pre-line',
      pointerEvents: 'none',
      left: '0px',
      top: '0px',
    });
    this.document.body.appendChild(card);
    this.card = card;
    this.host.nativeElement.setAttribute('aria-describedby', this.id);
    this.place(card);
  }

  hide(): void {
    this.card?.remove();
    this.card = null;
    this.host.nativeElement.removeAttribute('aria-describedby');
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private place(card: HTMLElement): void {
    const view = this.document.defaultView;
    const width = view?.innerWidth ?? 1024;
    const height = view?.innerHeight ?? 768;
    const anchor = this.host.nativeElement.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const gap = 6;

    const below = anchor.bottom + gap;
    const top = below + box.height > height ? Math.max(gap, anchor.top - gap - box.height) : below;
    const left = Math.min(Math.max(gap, anchor.left), Math.max(gap, width - box.width - gap));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }
}
