import { AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

let nextId = 0;

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/* Toute fenêtre `.pf-modal` devient un vrai dialogue :
   - rôle `dialog` + `aria-modal`, titre (`.pf-modal-head h2`) lié par `aria-labelledby` ;
   - bouton de fermeture nommé « Fermer » ;
   - focus posé sur le premier champ à l'ouverture, piégé dans la fenêtre (Tab / Maj+Tab),
     puis rendu à l'élément qui a ouvert la fenêtre ;
   - Échap déclenche le bouton « Fermer » (même effet que le clic : aucune logique dupliquée). */
@Directive({
  selector: '.pf-modal',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: '-1',
    '(keydown)': 'onKeydown($event)',
  },
})
export class ModalA11y implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Élément actif au moment de l'ouverture (le bouton cliqué), pour y revenir. */
  private readonly opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  ngAfterViewInit(): void {
    const title = this.host.querySelector<HTMLElement>('.pf-modal-head h2');
    if (title) {
      title.id ||= `pf-modal-title-${++nextId}`;
      this.host.setAttribute('aria-labelledby', title.id);
    }
    this.closeButton()?.setAttribute('aria-label', 'Fermer');

    const firstField = this.host.querySelector<HTMLElement>(
      '.pf-modal-body input:not([disabled]):not([type="hidden"]), .pf-modal-body select:not([disabled]), .pf-modal-body textarea:not([disabled])',
    );
    (firstField ?? this.host).focus({ preventScroll: true });
  }

  ngOnDestroy(): void {
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      const close = this.closeButton();
      if (close) {
        event.preventDefault();
        event.stopPropagation();
        close.click();
      }
      return;
    }
    if (event.key !== 'Tab') return;

    const items = Array.from(this.host.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(el => el.getClientRects().length > 0);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.host)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private closeButton(): HTMLButtonElement | null {
    return this.host.querySelector<HTMLButtonElement>('.pf-modal-close');
  }
}
