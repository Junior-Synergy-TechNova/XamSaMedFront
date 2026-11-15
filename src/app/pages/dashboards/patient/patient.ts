import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Tag } from '../../../components/tag/tag';
import { PlatformState } from '../../../services/platform/platform';
import { MedicineService } from '../../../services/medicines/medicines';
import { OrderService } from '../../../services/orders/orders';
import { StructureService } from '../../../services/structures/structures';
import { AuthService } from '../../../services/auth/auth';
import { Med, Pharmacy, ResaRow } from '../../../interfaces/models';
import { ApiErrorBody, ApiGroupedSearch, ApiGroupedSearchStatus } from '../../../interfaces/api';

/** Taille maximale d'une ordonnance acceptée par l'API (5 Mo). */
const PRESCRIPTION_MAX_BYTES = 5 * 1024 * 1024;

/** 422 de POST /orders quand le médicament exige une ordonnance. */
interface PrescriptionRequiredBody extends ApiErrorBody { requires_prescription?: boolean; medicine?: string; }
import { PatientResults } from '../patient-results/patient-results';
import { PatientPharmacies } from '../patient-pharmacies/patient-pharmacies';
import { SimpleProfile } from '../profile/profile';
import { PatientCabinet } from '../patient-cabinet/patient-cabinet';
import { PatientFloods } from '../patient-floods/patient-floods';

import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
/* ============================================================
   PATIENT — recherche, réservations, pharmacies, profil (API réelle)
   ============================================================ */
@Component({
  selector: 'app-patient-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalA11y, FieldLabel, Icon, Card, PageHead, Tag, PatientResults, PatientPharmacies, PatientCabinet, PatientFloods, SimpleProfile, DatePipe],
  templateUrl: './patient.html',
  styleUrl: './patient.css',
})
export class PatientDash {
  private readonly platform = inject(PlatformState);
  private readonly meds = inject(MedicineService);
  private readonly orders = inject(OrderService);
  private readonly structures = inject(StructureService);

  readonly section = model.required<string>();
  readonly q = signal('');
  readonly active = signal<Med | null>(null);
  readonly results = signal<Med[]>([]);
  readonly searching = signal(false);
  readonly resas = signal<ResaRow[]>([]);

  // Ordonnance numérique
  readonly prescriptionModal = signal(false);
  readonly pharmacies = signal<Pharmacy[]>([]);
  readonly prescriptionFile = signal<File | null>(null);
  /** Pharmacie présélectionnée (réservation refusée faute d'ordonnance). */
  readonly prescriptionPharmacy = signal<number | null>(null);
  /** Médicament pour lequel l'ordonnance est demandée (affiché dans la fenêtre). */
  readonly prescriptionFor = signal<string | null>(null);
  readonly prescriptionError = signal<string | null>(null);
  readonly sendingPrescription = signal(false);

  // Recherche groupée
  readonly groupedModal = signal(false);
  readonly groupedSearchId = signal<number | null>(null);
  readonly groupedInfo = signal<ApiGroupedSearch | null>(null);
  readonly groupedStatus = signal<ApiGroupedSearchStatus | null>(null);

  readonly suggestions = ['Morphine', 'Insuline Glargine', 'Paracétamol', 'Ventoline', 'Amlodipine'];
  protected readonly auth = inject(AuthService);

  readonly profilFields = computed<readonly [string, string][]>(() => {
    const u = this.auth.user();
    if (!u) return [];
    return [
      ['Téléphone', u.phone || '+221 77 000 00 00'],
      ['Email', u.email || 'Non renseigné'],
      ['Notifications', 'Activées (rupture & disponibilité)'],
    ];
  });

  constructor() {
    this.loadResas();
    this.structures.pharmacies().subscribe({ next: p => this.pharmacies.set(p), error: () => { /* ignore */ } });
  }

  onSearch(e: Event): void { this.runSearch((e.target as HTMLInputElement).value); }
  setQuery(s: string): void { this.runSearch(s); }
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }
  clear(): void { this.q.set(''); this.results.set([]); this.active.set(null); }

  private runSearch(term: string): void {
    this.q.set(term);
    this.active.set(null);
    const t = term.trim();
    if (!t) { this.results.set([]); return; }
    this.searching.set(true);
    this.meds.search(t).subscribe({
      next: list => { this.results.set(list); this.searching.set(false); },
      error: () => { this.results.set([]); this.searching.set(false); },
    });
  }

  reserve(med: Med, structureId: number): void {
    this.orders.create(Number(med.id), structureId).subscribe({
      next: () => {
        this.platform.notify('Réservation envoyée pour ' + med.nom, 'ok');
        this.active.set(null);
        this.loadResas();
        this.section.set('resa');
      },
      error: (e: HttpErrorResponse) => {
        const body = e.error as PrescriptionRequiredBody | null;
        // Médicament sur ordonnance : on n'échoue pas, on propose d'envoyer l'ordonnance à cette pharmacie.
        if (e.status === 422 && body?.requires_prescription) {
          this.openPrescription(structureId, body.medicine ?? med.nom);
          return;
        }
        this.platform.notify(body?.message ?? 'Échec de la réservation — réessayez', 'alert');
      },
    });
  }

  /** Ouvre l'envoi d'ordonnance, éventuellement pour une pharmacie et un médicament donnés. */
  openPrescription(structureId: number | null = null, medicine: string | null = null): void {
    this.prescriptionPharmacy.set(structureId);
    this.prescriptionFor.set(medicine);
    this.prescriptionFile.set(null);
    this.prescriptionError.set(null);
    this.prescriptionModal.set(true);
  }

  /** Réponses aux équivalents proposés en cours d'envoi (boutons désactivés). */
  readonly answering = signal<number | null>(null);

  /** Le patient accepte ou refuse l'équivalent proposé par son officine pour une ligne d'ordonnance. */
  answerSubstitute(orderId: number, lineId: number, accept: boolean): void {
    if (this.answering() !== null) return;
    this.answering.set(lineId);
    this.orders.answerSubstitute(orderId, lineId, accept).subscribe({
      next: res => { this.answering.set(null); this.platform.notify(res.message, accept ? 'ok' : 'info'); this.loadResas(); },
      error: () => { this.answering.set(null); this.platform.notify('Réponse non envoyée — vérifiez la connexion et réessayez', 'alert'); },
    });
  }

  /** Annule une réservation en attente. */
  cancelResa(orderId: number): void {
    this.orders.cancel(orderId).subscribe({
      next: () => { this.platform.notify('Réservation annulée', 'info'); this.loadResas(); },
      error: () => this.platform.notify('Échec de l’annulation', 'alert'),
    });
  }

  onPrescriptionFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.prescriptionError.set(null);
    if (file && file.size > PRESCRIPTION_MAX_BYTES) {
      this.prescriptionFile.set(null);
      this.prescriptionError.set('Fichier trop lourd (5 Mo maximum) : reprenez la photo en qualité normale ou envoyez un PDF.');
      input.value = '';
      return;
    }
    this.prescriptionFile.set(file);
  }

  /** Envoie l'ordonnance numérique à la pharmacie choisie. */
  submitPrescription(structureId: string, notes: string): void {
    const sid = Number(structureId);
    const file = this.prescriptionFile();
    if (!sid || !file) {
      this.prescriptionError.set('Sélectionnez une pharmacie et un fichier.');
      return;
    }
    if (this.sendingPrescription()) return;
    this.sendingPrescription.set(true);
    this.prescriptionError.set(null);
    this.orders.submitPrescription(sid, file, notes).subscribe({
      next: res => {
        this.sendingPrescription.set(false);
        // Le message de l'API rappelle de présenter l'ordonnance originale au retrait.
        this.platform.notify(res.message ?? 'Ordonnance envoyée à la pharmacie. Présentez l\'ordonnance originale au retrait.', 'ok');
        this.prescriptionModal.set(false);
        this.prescriptionFile.set(null);
        this.loadResas();
        this.section.set('resa');
      },
      error: (e: HttpErrorResponse) => {
        this.sendingPrescription.set(false);
        const body = e.error as ApiErrorBody | null;
        const first = body?.errors ? Object.values(body.errors)[0]?.[0] : undefined;
        this.prescriptionError.set(first ?? body?.message ?? 'Échec de l\'envoi de l\'ordonnance — vérifiez la connexion et réessayez.');
      },
    });
  }

  /** Lance une recherche groupée pour le médicament actif (aucune dispo publique). */
  launchGroupedSearch(med: Med): void {
    this.orders.startGroupedSearch(Number(med.id)).subscribe({
      next: res => {
        if (!res) { this.platform.notify('Aucune pharmacie trouvée dans votre zone', 'alert'); return; }
        this.groupedInfo.set(res);
        this.groupedSearchId.set(res.search_id);
        this.groupedStatus.set(null);
        this.groupedModal.set(true);
        this.platform.notify(this.plural(res.target_count, 'pharmacie alertée', 'pharmacies alertées'), 'ok');
        this.refreshGroupedStatus();
      },
      error: () => this.platform.notify('Échec de la recherche groupée', 'alert'),
    });
  }

  /** Rafraîchit l'état de la recherche groupée en cours. */
  refreshGroupedStatus(): void {
    const id = this.groupedSearchId();
    if (!id) return;
    this.orders.groupedSearchStatus(id).subscribe({ next: s => this.groupedStatus.set(s), error: () => { /* ignore */ } });
  }

  private loadResas(): void {
    this.orders.list().subscribe({ next: r => this.resas.set(r), error: () => { /* ignore */ } });
  }
}
