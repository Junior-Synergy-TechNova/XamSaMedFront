import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../icon/icon';
import { Card } from '../card/card';
import { Tag } from '../tag/tag';
import { PlatformState, saveBlob } from '../../services/platform/platform';
import { DeliveryReceiptService } from '../../services/deliveries/deliveries';
import { ApiErrorBody, ApiIncomingDelivery } from '../../interfaces/api';

/* ============================================================
   Réception d'approvisionnement entrant (officine, hôpital, PRA) :
   livraisons attendues, confirmation de réception (stock crédité)
   et bordereau de livraison PDF.
   ============================================================ */
@Component({
  selector: 'pf-incoming-deliveries',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, Tag],
  templateUrl: './incoming-deliveries.html',
  styleUrl: './incoming-deliveries.css',
})
export class IncomingDeliveries {
  private readonly deliveries = inject(DeliveryReceiptService);
  private readonly platform = inject(PlatformState);

  /** Émis après une réception confirmée : le parent recharge son stock. */
  readonly received = output<void>();

  readonly rows = signal<ApiIncomingDelivery[]>([]);
  readonly loading = signal(true);
  readonly busy = signal<number | null>(null);

  readonly expected = computed(() => this.rows().filter(r => r.status !== 'delivered'));
  readonly done = computed(() => this.rows().filter(r => r.status === 'delivered'));

  constructor() { this.reload(); }

  reload(): void {
    this.loading.set(true);
    this.deliveries.incoming().subscribe({
      next: r => { this.rows.set(r); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  receive(d: ApiIncomingDelivery): void {
    this.busy.set(d.id);
    this.deliveries.receive(d.id).subscribe({
      next: r => { this.busy.set(null); this.platform.notify(r.message, 'ok'); this.reload(); this.received.emit(); },
      error: (e: HttpErrorResponse) => { this.busy.set(null); this.platform.notify((e.error as ApiErrorBody | null)?.message ?? 'Échec de la confirmation', 'alert'); },
    });
  }

  slip(d: ApiIncomingDelivery): void {
    this.deliveries.slip(d.id).subscribe({
      next: blob => saveBlob(blob, `${d.slip_number ?? 'bordereau-' + d.id}.pdf`),
      error: () => this.platform.notify('Bordereau indisponible', 'alert'),
    });
  }

  statusLabel(s: string): string { return s === 'in_transit' ? 'En transit' : s === 'planned' ? 'Planifiée' : 'Reçue'; }
  statusTag(s: string): string { return s === 'in_transit' ? 'new' : s === 'planned' ? 'vue' : 'ok'; }
  supplierKind(t: string | null): string { return t === 'pna' ? 'PNA' : t === 'pra' ? 'PRA' : 'Distributeur'; }
}
