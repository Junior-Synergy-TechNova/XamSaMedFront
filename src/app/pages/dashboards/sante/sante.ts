import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Bar } from '../../../components/bar/bar';
import { Tag } from '../../../components/tag/tag';
import { ZoneMap } from '../../../components/zone-map/zone-map';
import { PlatformState, saveBlob } from '../../../services/platform/platform';
import { PublicHealthService } from '../../../services/public-health/public-health';
import { AdminService } from '../../../services/admin/admin';
import { MedicineService } from '../../../services/medicines/medicines';
import { ApiAdminUser, ApiControlledMedicine, ApiMedicine, ApiOverview, ApiReport, ApiStructure, ApiTrendPoint, ApiTrends } from '../../../interfaces/api';
import { Tension, ZoneInfo } from '../../../interfaces/models';

type BarTone = 'green' | 'amber' | 'red' | 'blue';

/** Rapport enrichi de son libellé d'état et de la couleur du tag. */
interface ReportRow extends ApiReport { statusLabel: string; s: string; }

/* ============================================================
   SANTÉ PUBLIQUE — vue nationale, zones, tensions, rapports (API réelle)
   ============================================================ */
@Component({
  selector: 'app-sante-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, Stat, Bar, Tag, ZoneMap],
  templateUrl: './sante.html',
  styleUrl: './sante.css',
})
export class SanteDash {
  private readonly ph = inject(PublicHealthService);
  private readonly platform = inject(PlatformState);
  private readonly admin = inject(AdminService);
  private readonly medicines = inject(MedicineService);

  readonly section = model.required<string>();
  readonly loading = signal(true);

  // --- Administration ---
  readonly users = signal<ApiAdminUser[]>([]);
  /** Catalogue national : l'admin décide des médicaments soumis à ordonnance. */
  readonly catalogMeds = signal<ApiMedicine[]>([]);
  readonly catalogFilter = signal<'all' | 'rx' | 'free'>('all');
  readonly filteredCatalog = computed(() => {
    const f = this.catalogFilter();
    return this.catalogMeds().filter(m => f === 'all' || (f === 'rx' ? m.requires_prescription : !m.requires_prescription));
  });
  readonly rxCount = computed(() => this.catalogMeds().filter(m => m.requires_prescription).length);
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
  readonly keyStats = computed<readonly [string, string, string][]>(() => [
    ['Médicaments en tension', String(this.overview().medicines_in_tension), 'pill'],
    ['Zones critiques actives', String(this.critZones()), 'pin'],
    ['Ruptures signalées', String(this.overview().ruptures), 'alert'],
    ['Alertes du jour', String(this.overview().alerts_today ?? 0), 'bell'],
    ['Ruptures de médicaments contrôlés', String(this.overview().controlled_ruptures ?? 0), 'shield'],
    ['Évolution des ruptures (30 j)', this.signed(this.trends()?.delta_30.ruptures ?? 0), 'trend'],
  ]);

  constructor() {
    this.ph.overview().subscribe({
      next: o => { this.overview.set(o); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.ph.zones().subscribe({ next: z => this.zones.set(z), error: () => { /* ignore */ } });
    this.ph.tension().subscribe({ next: t => this.tension.set(t), error: () => { /* ignore */ } });
    this.ph.trends().subscribe({ next: t => this.trends.set(t), error: () => { /* ignore */ } });
    this.ph.controlled().subscribe({ next: c => this.controlled.set(c), error: () => { /* ignore */ } });
    this.medicines.list().subscribe({ next: c => this.catalog.set(c), error: () => { /* ignore */ } });
    this.loadReports();
    this.loadUsers();
    this.loadStructures();
    this.loadCatalog();
  }

  // ── Catalogue : médicaments sur ordonnance ou en vente libre ─────
  private loadCatalog(): void {
    this.admin.medicines().subscribe({ next: m => this.catalogMeds.set(m), error: () => { /* ignore */ } });
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
  categoryLabel(c: string | undefined): string {
    return c === 'hospital' ? 'Hôpital uniquement' : c === 'pharmaceutical' ? 'Officine uniquement' : 'Officine et hôpital';
  }

  // ── Administration : utilisateurs ──────────────────────────────
  private loadUsers(): void {
    this.admin.users().subscribe({ next: u => this.users.set(u), error: () => { /* ignore */ } });
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
    this.admin.structures().subscribe({ next: s => this.structures.set(s), error: () => { /* ignore */ } });
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
    const scope = r.type === 'regional' ? ' — ' + (r.payload?.region ?? '') : r.type === 'medicine' ? ' — ' + (this.catalog().find(m => m.id === r.payload?.medicine_id)?.name ?? '') : '';
    return (types[r.type] ?? r.type) + scope;
  }
  periodLabel(p: string): string { return p === 'week' ? 'Semaine' : p === 'quarter' ? 'Trimestre' : 'Mois'; }

  private loadReports(): void {
    this.ph.reports().subscribe({
      next: reports => this.reports.set(reports.map((report): ReportRow => ({
        ...report,
        statusLabel: report.status === 'completed' ? 'Prêt' : report.status === 'generating' ? 'En cours' : 'Échec',
        s: report.status === 'completed' ? 'ok' : 'low',
      }))),
    });
  }

}
