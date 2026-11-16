import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, model, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Observable, finalize } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Bar } from '../../../components/bar/bar';
import { Tag } from '../../../components/tag/tag';
import { ZoneMap } from '../../../components/zone-map/zone-map';
import { PlatformState, saveBlob } from '../../../services/platform/platform';
import { PublicHealthService } from '../../../services/public-health/public-health';
import { SHARED_READ_MS } from '../../../services/shared-read/shared-read';
import { AdminService } from '../../../services/admin/admin';
import { MedicineService } from '../../../services/medicines/medicines';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiAdminUser, ApiControlledMedicine, ApiMedicine, ApiMedicinePayload, ApiOverview, ApiReport, ApiStructure, ApiTrendPoint, ApiTrends } from '../../../interfaces/api';
import { Tension, ZoneInfo } from '../../../interfaces/models';

import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
import { TableLabels } from '../../../directives/table-labels/table-labels';
/** Une fiche a une DCI exploitable (le backend ne propose aucun équivalent sans elle). */
function hasDci(m: ApiMedicine): boolean { return !!m.dci?.trim(); }

/** Message lisible d'un refus de l'API catalogue (422 de validation, doublon nom/forme/dosage…). */
function medicineError(e: HttpErrorResponse): string {
  if (e.status === 0) return 'Serveur injoignable : vérifiez la connexion puis réessayez.';
  if (e.status === 403) return "Action réservée à l'administration nationale.";
  const body = e.error as { message?: string; errors?: Record<string, string[]> } | null;
  const first = body?.errors ? Object.values(body.errors)[0]?.[0] : undefined;
  if (first) return first;
  if (e.status === 409 || /unique|duplicate|23505/i.test(body?.message ?? '')) return 'Ce médicament existe déjà au catalogue (même nom, forme et dosage).';
  if (e.status === 422 && body?.message) return body.message;
  return 'Enregistrement impossible pour le moment. Réessayez.';
}

type BarTone = 'green' | 'amber' | 'red' | 'blue';

/** Rapport enrichi de son libellé d'état et de la couleur du tag. */
interface ReportRow extends ApiReport { statusLabel: string; s: string; }

/* ============================================================
   SANTÉ PUBLIQUE — vue nationale, zones, tensions, rapports (API réelle)
   ============================================================ */
@Component({
  selector: 'app-sante-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ModalA11y, FieldLabel, TableLabels, Icon, Card, PageHead, Stat, Bar, Tag, ZoneMap],
  templateUrl: './sante.html',
  styleUrl: './sante.css',
})
export class SanteDash {
  private readonly ph = inject(PublicHealthService);
  private readonly platform = inject(PlatformState);
  private readonly admin = inject(AdminService);
  private readonly medicines = inject(MedicineService);

  readonly section = model.required<string>();
  /** Premier chargement seulement. */
  readonly loading = signal(true);
  /** La vue nationale n'a pas pu être lue : écran « Réessayer » (des zéros partout seraient trompeurs). */
  readonly overviewError = signal(false);
  /** Données secondaires en échec : bandeau ambre avec « Réessayer ». */
  readonly failedLoads = signal<ReadonlySet<string>>(new Set());
  readonly failedLabel = computed(() => [...this.failedLoads()].join(', '));
  readonly lastSync = signal<Date | null>(null);
  readonly inFlight = signal(0);

  // --- Administration ---
  readonly users = signal<ApiAdminUser[]>([]);
  /** Catalogue national : l'admin décide des médicaments soumis à ordonnance. */
  readonly catalogMeds = signal<ApiMedicine[]>([]);
  readonly catalogFilter = signal<'all' | 'rx' | 'free' | 'nodci'>('all');
  readonly filteredCatalog = computed(() => {
    const f = this.catalogFilter();
    return this.catalogMeds().filter(m =>
      f === 'all' ? true
      : f === 'nodci' ? !hasDci(m)
      : f === 'rx' ? m.requires_prescription : !m.requires_prescription);
  });
  readonly rxCount = computed(() => this.catalogMeds().filter(m => m.requires_prescription).length);
  /** Fiches sans DCI : aucun équivalent ne peut leur être proposé. */
  readonly noDciCount = computed(() => this.catalogMeds().filter(m => !hasDci(m)).length);
  /** Fiche en cours d'édition : `null` = fermé, `'new'` = ajout, sinon le médicament modifié. */
  readonly medModal = signal<ApiMedicine | 'new' | null>(null);
  readonly medSaving = signal(false);
  readonly medError = signal<string | null>(null);
  readonly medEditing = computed(() => { const m = this.medModal(); return m && m !== 'new' ? m : null; });
  readonly structures = signal<ApiStructure[]>([]);
  readonly userModal = signal(false);
  readonly structureModal = signal(false);
  readonly sel = signal<string | null>(null);
  readonly tension = signal<Tension[]>([]);
  readonly zones = signal<ZoneInfo[]>([]);
  readonly overview = signal<ApiOverview>({ ruptures: 0, low: 0, zones_tracked: 0, medicines_in_tension: 0 });

  readonly generateModal = signal(false);
  readonly reportType = signal('national');
  readonly catalog = signal<{ id: number; name: string; label: string }[]>([]);
  readonly regions = computed(() => [...new Set(this.structures().map(s => s.region ?? s.city).filter((c): c is string => !!c))].sort());

  // Tendances des ruptures (7 / 30 jours) reconstituées depuis l'historique réel
  readonly trends = signal<ApiTrends | null>(null);
  readonly trendRange = signal<7 | 30>(30);
  readonly trendPoints = computed<ApiTrendPoint[]>(() => {
    const t = this.trends();
    const points = t ? (this.trendRange() === 7 ? t.last_7_days : t.last_30_days) : [];
    // Les jours antérieurs au premier mouvement enregistré n'ont pas de données : on ne les trace pas.
    const first = points.findIndex(p => p.ruptures + p.low > 0);
    return first > 0 ? points.slice(first) : points;
  });
  readonly trendMax = computed(() => Math.max(1, ...this.trendPoints().map(p => p.ruptures + p.low)));
  readonly trendDelta = computed(() => {
    const t = this.trends();
    return t ? (this.trendRange() === 7 ? t.delta_7 : t.delta_30) : { ruptures: 0, low: 0 };
  });

  // Suivi spécial des médicaments contrôlés (morphine, insuline, stupéfiants)
  readonly controlled = signal<ApiControlledMedicine[]>([]);
  readonly controlledInRupture = computed(() => this.controlled().filter(c => c.ruptures > 0).length);

  readonly topTension = computed(() => this.tension().slice(0, 5));
  readonly critZones = computed(() => this.zones().filter(z => z.niveau === 'crit').length);
  readonly tensionMid = computed(() => this.tension().filter(t => t.pct > 40).length);
  readonly sortedZones = computed(() => [...this.zones()].sort((a, b) => b.ruptures - a.ruptures));

  readonly reports = signal<ReportRow[]>([]);

  /** Vrai seulement pendant le reload() du constructeur : la cloche vient de lire zones et rapports. */
  private firstLoad = true;

  constructor() {
    this.reload();
    this.firstLoad = false;
    // Pastilles = ce qui demande une décision : zones critiques, contrôlés en rupture, fiches sans DCI.
    effect(() => this.platform.navCounts.set({
      zones: this.critZones(),
      ctrl: this.controlledInRupture(),
      catalogue: this.noDciCount(),
    }));
    inject(DestroyRef).onDestroy(() => this.platform.navCounts.set(null));
  }

  /** Tout recharger : premier affichage et « Actualiser ». */
  reload(): void {
    this.inFlight.update(n => n + 1);
    this.ph.overview().pipe(finalize(() => this.inFlight.update(n => n - 1))).subscribe({
      next: o => { this.overview.set(o); this.overviewError.set(false); this.loading.set(false); this.lastSync.set(new Date()); },
      error: () => {
        this.overviewError.set(this.lastSync() === null);
        this.loading.set(false);
        if (this.lastSync()) this.platform.notify('Vue nationale non actualisée — connexion instable', 'alert');
      },
    });
    this.track('zones', this.ph.zones(this.firstLoad ? SHARED_READ_MS : 0), z => this.zones.set(z));
    this.track('tensions', this.ph.tension(), t => this.tension.set(t));
    this.track('tendance', this.ph.trends(), t => this.trends.set(t));
    this.track('médicaments contrôlés', this.ph.controlled(), c => this.controlled.set(c));
    this.medicines.list().subscribe(c => this.catalog.set(c)); // saisie assistée des rapports (repli silencieux)
    this.loadReports();
    this.loadUsers();
    this.loadStructures();
    this.loadCatalog();
  }

  retry(): void {
    this.loading.set(this.lastSync() === null);
    this.overviewError.set(false);
    this.reload();
  }

  /** Charge une donnée secondaire et note son échec (bandeau) au lieu de l'ignorer. */
  private track<T>(label: string, source: Observable<T>, apply: (value: T) => void): void {
    this.inFlight.update(n => n + 1);
    source.pipe(finalize(() => this.inFlight.update(n => n - 1))).subscribe({
      next: value => { apply(value); this.setFailed(label, false); },
      error: () => this.setFailed(label, true),
    });
  }

  private setFailed(label: string, failed: boolean): void {
    const current = this.failedLoads();
    if (current.has(label) === failed) return;
    const next = new Set(current);
    if (failed) next.add(label); else next.delete(label);
    this.failedLoads.set(next);
  }

  // ── Catalogue : médicaments sur ordonnance ou en vente libre ─────
  private loadCatalog(): void {
    this.track('catalogue', this.admin.medicines(), m => this.catalogMeds.set(m));
  }
  toggleRx(m: ApiMedicine): void {
    const next = !m.requires_prescription;
    this.admin.updateMedicine(m.id, { requires_prescription: next }).subscribe({
      next: () => {
        this.catalogMeds.update(list => list.map(x => x.id === m.id ? { ...x, requires_prescription: next } : x));
        this.platform.notify(`${m.name} ${m.dosage ?? ''} : ${next ? 'sur ordonnance' : 'vente libre'}`, 'ok');
      },
      error: () => this.platform.notify('Échec de la mise à jour du catalogue', 'alert'),
    });
  }
  openMedicine(m: ApiMedicine | 'new'): void {
    this.medError.set(null);
    this.medModal.set(m);
  }
  /**
   * Ajout ou modification d'une fiche. La DCI est exigée ici : sans elle, le
   * backend ne propose jamais d'équivalent (il ne devine pas la molécule).
   * Délivrance « auto » à l'ajout = l'API la propose elle-même.
   */
  submitMedicine(f: { name: string; dci: string; brand: string; form: string; dosage: string; atc: string; category: string; rx: string; controlled: boolean }): void {
    const name = f.name.trim(), dci = f.dci.trim();
    if (!name || !dci) { this.medError.set('Le nom et la DCI sont obligatoires.'); return; }
    const editing = this.medEditing();
    const payload: ApiMedicinePayload = {
      name, dci,
      brand: f.brand.trim() || null, form: f.form.trim() || null, dosage: f.dosage.trim() || null,
      atc_code: f.atc.trim().toUpperCase() || null,
      category: f.category, is_controlled: f.controlled,
    };
    if (f.rx === 'yes' || f.rx === 'no') payload.requires_prescription = f.rx === 'yes';
    this.medSaving.set(true);
    this.medError.set(null);
    const call = editing ? this.admin.updateMedicine(editing.id, payload) : this.admin.createMedicine(payload);
    call.subscribe({
      next: () => {
        this.medSaving.set(false);
        this.medModal.set(null);
        this.platform.notify(editing ? `${name} : fiche mise à jour` : `${name} ajouté au catalogue`, 'ok');
        this.loadCatalog();
      },
      error: (e: HttpErrorResponse) => { this.medSaving.set(false); this.medError.set(medicineError(e)); },
    });
  }
  categoryLabel(c: string | undefined): string {
    return c === 'hospital' ? 'Hôpital uniquement' : c === 'pharmaceutical' ? 'Officine uniquement' : 'Officine et hôpital';
  }

  // ── Administration : utilisateurs ──────────────────────────────
  private loadUsers(): void {
    this.track('utilisateurs', this.admin.users(), u => this.users.set(u));
  }
  submitUser(name: string, email: string, role: string, phone: string, structureId: string): void {
    if (!name.trim() || !email.trim() || !role) { this.platform.notify('Nom, email et rôle requis', 'alert'); return; }
    const structure_id = structureId ? Number(structureId) : null;
    this.admin.createUser({ name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, role, structure_id }).subscribe({
      next: () => { this.platform.notify('Utilisateur créé (mot de passe envoyé par email)', 'ok'); this.userModal.set(false); this.loadUsers(); },
      error: () => this.platform.notify('Échec de la création (email déjà utilisé ?)', 'alert'),
    });
  }
  deleteUser(id: number): void {
    this.admin.deleteUser(id).subscribe({
      next: () => { this.platform.notify('Utilisateur désactivé', 'info'); this.loadUsers(); },
      error: () => this.platform.notify('Échec de la suppression', 'alert'),
    });
  }

  // ── Administration : structures ────────────────────────────────
  private loadStructures(): void {
    this.track('structures', this.admin.structures(), st => this.structures.set(st));
  }
  submitStructure(name: string, type: string, sector: string, plan: string, city: string, region: string, phone: string): void {
    if (!name.trim() || !type) { this.platform.notify('Nom et type requis', 'alert'); return; }
    this.admin.createStructure({
      name: name.trim(), type,
      // Le secteur n'est libre que pour un hôpital (public / privé) ; le backend normalise les autres types.
      sector: type === 'hospital' ? sector : undefined,
      plan: type === 'pharmacy' ? plan : undefined,
      city: city.trim() || undefined, region: region.trim() || undefined, contact_phone: phone.trim() || undefined,
    }).subscribe({
      next: () => { this.platform.notify('Structure créée', 'ok'); this.structureModal.set(false); this.loadStructures(); },
      error: () => this.platform.notify('Échec de la création', 'alert'),
    });
  }
  /** Offre d'une officine : Starter ↔ Pro (module Vente & Comptabilité). */
  togglePlan(s: ApiStructure): void {
    const plan = s.plan === 'pro' ? 'starter' : 'pro';
    this.admin.updateStructure(s.id, { plan }).subscribe({
      next: () => { this.platform.notify(`${s.name} : offre ${plan === 'pro' ? 'Pro' : 'Starter'}`, 'ok'); this.loadStructures(); },
      error: () => this.platform.notify('Échec du changement d\'offre', 'alert'),
    });
  }
  typeLabel(type: string): string {
    const labels: Record<string, string> = { pharmacy: 'Officine', hospital: 'Hôpital', distributor: 'Distributeur', pna: 'PNA', pra: 'PRA' };
    return labels[type] ?? type;
  }
  sectorLabel(s: ApiStructure): string { return s.sector === 'public' ? 'Public' : s.sector === 'private' ? 'Privé' : '—'; }
  planLabel(plan: string | null | undefined): string { return plan === 'pro' ? 'Pro' : plan === 'institutionnel' ? 'Institutionnel' : 'Starter'; }

  deleteStructure(id: number): void {
    this.admin.deleteStructure(id).subscribe({
      next: () => { this.platform.notify('Structure désactivée', 'info'); this.loadStructures(); },
      error: () => this.platform.notify('Échec de la désactivation', 'alert'),
    });
  }

  tone(pct: number): BarTone { return pct > 70 ? 'red' : pct > 40 ? 'amber' : 'green'; }
  signed(n: number): string { return n > 0 ? '+' + n : String(n); }
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }
  longDate(iso: string): string { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
  /** Mêmes libellés que la légende de la carte. */
  zoneLabel(n: string): string { return n === 'crit' ? 'Critique' : n === 'haute' ? 'Tension haute' : n === 'moyenne' ? 'Modérée' : 'Faible'; }
  roleLabel(role: string): string {
    const labels: Record<string, string> = { patient: 'Patient', pharmacy_user: 'Pharmacien', hospital_user: 'Hôpital', distributor_user: 'Distributeur', admin: 'Administrateur' };
    return labels[role] ?? role;
  }
  /** Variation (points de %) vs il y a 7 jours : hausse = dégradation. */
  varTag(v: number): string { return v > 0 ? 'crit' : v < 0 ? 'ok' : 'vue'; }
  barPct(v: number): number { return Math.round((v / this.trendMax()) * 100); }
  day(iso: string): string { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  ztag(n: string): string { return n === 'crit' ? 'crit' : n === 'haute' ? 'low' : 'ok'; }
  ttag(pct: number): string { return pct > 70 ? 'crit' : pct > 40 ? 'low' : 'ok'; }
  tlabel(pct: number): string { return pct > 70 ? 'Critique' : pct > 40 ? 'Élevée' : 'Modérée'; }

  generateReport(): void { this.generateModal.set(true); }
  exportReport(reportId?: number): void {
    const report = reportId
      ? this.reports().find(item => item.id === reportId)
      : this.reports().find(item => item.status === 'completed');
    if (!report) {
      this.platform.notify('Aucun rapport prêt à exporter', 'alert');
      return;
    }
    this.ph.downloadReport(report.id).subscribe({
      next: blob => { saveBlob(blob, `rapport-xamsamed-${report.id}.pdf`); this.platform.notify('Rapport téléchargé', 'ok'); },
      error: () => this.platform.notify('Impossible de consulter ce rapport', 'alert'),
    });
  }

  submitGenerate(period: string, type: string, region: string, medicineId: string): void {
    if (type === 'regional' && !region) { this.platform.notify('Choisissez une région', 'alert'); return; }
    if (type === 'medicine' && !medicineId) { this.platform.notify('Choisissez un médicament', 'alert'); return; }
    this.ph.generateReport({
      period, type,
      region: type === 'regional' ? region : undefined,
      medicine_id: type === 'medicine' ? Number(medicineId) : undefined,
    }).subscribe({
      next: () => {
        this.platform.notify('Rapport généré — PDF disponible', 'ok');
        this.generateModal.set(false);
        this.loadReports();
      },
      error: () => this.platform.notify('La génération du rapport a échoué', 'alert'),
    });
  }

  reportTitle(r: ApiReport): string {
    const types: Record<string, string> = { national: 'Rapport national', regional: 'Rapport régional', medicine: 'Rapport par médicament', tensions: 'Tensions critiques' };
    const scope = r.type === 'regional' ? r.payload?.region
      : r.type === 'medicine' ? this.catalog().find(m => m.id === r.payload?.medicine_id)?.name : null;
    return (types[r.type] ?? r.type) + (scope ? ' — ' + scope : '');
  }
  periodLabel(p: string): string { return p === 'week' ? 'Semaine' : p === 'quarter' ? 'Trimestre' : 'Mois'; }

  private loadReports(): void {
    this.track('rapports', this.ph.reports(this.firstLoad ? SHARED_READ_MS : 0), reports => this.reports.set(reports.map((report): ReportRow => ({
      ...report,
      statusLabel: report.status === 'completed' ? 'Prêt' : report.status === 'generating' ? 'En cours' : 'Échec',
      s: report.status === 'completed' ? 'ok' : 'low',
    }))));
  }

}
