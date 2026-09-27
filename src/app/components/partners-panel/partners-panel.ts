import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../icon/icon';
import { Card } from '../card/card';
import { PlatformState } from '../../services/platform/platform';
import { PartnerService } from '../../services/partners/partners';
import { ApiErrorBody, ApiPartner, ApiPartnerCandidate } from '../../interfaces/api';

/** Type de structure proposé dans la recherche d'un partenaire. */
export interface PartnerTypeOption { value: string; label: string; }

/* ============================================================
   Réseau de partenaires — commun officine / hôpital / fournisseur.
   Invitations envoyées et reçues (accepter / rejeter), suppression,
   recherche limitée par le backend aux connexions autorisées (§3.3).
   ============================================================ */
@Component({
  selector: 'pf-partners-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card],
  templateUrl: './partners-panel.html',
  styleUrl: './partners-panel.css',
})
export class PartnersPanel {
  private readonly partners = inject(PartnerService);
  private readonly platform = inject(PlatformState);

  /** Types recherchables (ex. distributeurs pour une officine). */
  readonly types = input.required<readonly PartnerTypeOption[]>();
  /** Règle métier rappelée à l'utilisateur. */
  readonly rule = input('');

  readonly list = signal<ApiPartner[]>([]);
  readonly loading = signal(true);
  readonly inviteOpen = signal(false);
  readonly candidates = signal<ApiPartnerCandidate[]>([]);
  readonly searching = signal(false);

  readonly toAnswer = computed(() => this.list().filter(p => p.can_respond));
  readonly active = computed(() => this.list().filter(p => p.status === 'active'));
  readonly waiting = computed(() => this.list().filter(p => p.status === 'pending' && !p.incoming));

  constructor() { this.reload(); }

  reload(): void {
    this.loading.set(true);
    this.partners.list().subscribe({
      next: l => { this.list.set(l); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openInvite(): void {
    this.inviteOpen.set(true);
    this.candidates.set([]);
    this.search('', this.types()[0]?.value ?? '');
  }

  search(q: string, type: string): void {
    this.searching.set(true);
    this.partners.search(q.trim(), type || undefined).subscribe({
      next: c => { this.candidates.set(c); this.searching.set(false); },
      error: () => this.searching.set(false),
    });
  }

  invite(target: { partner_id?: number; identifier?: string }): void {
    if (!target.partner_id && !target.identifier?.trim()) {
      this.platform.notify('Choisissez une structure ou saisissez un email / code', 'alert');
      return;
    }
    this.partners.invite(target).subscribe({
      next: r => { this.platform.notify(`Invitation envoyée à ${r.partner}`, 'ok'); this.inviteOpen.set(false); this.reload(); },
      error: (e: HttpErrorResponse) => this.platform.notify((e.error as ApiErrorBody | null)?.message ?? 'Échec de l\'invitation', 'alert'),
    });
  }

  accept(p: ApiPartner): void {
    this.partners.accept(p.id).subscribe({
      next: () => { this.platform.notify(`${p.partner} ajouté à votre réseau`, 'ok'); this.reload(); },
      error: () => this.platform.notify('Échec de l\'acceptation', 'alert'),
    });
  }

  reject(p: ApiPartner): void {
    this.partners.reject(p.id).subscribe({
      next: () => { this.platform.notify('Invitation refusée', 'info'); this.reload(); },
      error: () => this.platform.notify('Échec du refus', 'alert'),
    });
  }

  remove(p: ApiPartner): void {
    this.partners.remove(p.id).subscribe({
      next: () => { this.platform.notify('Partenariat retiré', 'info'); this.reload(); },
      error: () => this.platform.notify('Échec du retrait', 'alert'),
    });
  }

  icon(type: string | null): string {
    return type === 'pharmacy' ? 'pill' : type === 'hospital' ? 'hospital' : 'truck';
  }
}
