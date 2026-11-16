import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Tag } from '../../../components/tag/tag';
import { ExpiryTag } from '../../../components/expiry-tag/expiry-tag';
import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
import { PlatformState } from '../../../services/platform/platform';
import { MedicineService } from '../../../services/medicines/medicines';
import { CabinetService, ThermalState } from '../../../services/cabinet/cabinet';
import {
  ApiCabinetItem, ApiErrorBody, ApiFamilyMember, ApiThermalItem, CabinetItemPayload, CabinetStorage, FamilyRelationship,
} from '../../../interfaces/api';

type CatalogueItem = { id: number; name: string; label: string };
type MemberFilter = 'all' | 'me' | number;
type StateFilter = 'all' | 'soon' | 'expired' | 'heat';
type Tone = 'red' | 'amber' | 'green';

/** Ligne affichée : le médicament de l'armoire et sa situation thermique du moment. */
interface CabinetRow {
  item: ApiCabinetItem;
  thermal: ApiThermalItem | null;
  heat: boolean;
  tone: Tone;
  label: string;
}

/** Formulaire « Ajouter / modifier un médicament ». */
interface ItemForm {
  id: number | null;
  medicine: string;
  /** Médicament de départ (modification) : gardé tant que le champ n'est pas retouché. */
  initialMedicine: { id: number; label: string } | null;
  member: string;
  expiry: string;
  storage: CabinetStorage;
  powerCuts: boolean;
  openedAt: string;
}

export const RELATIONSHIPS: readonly { id: FamilyRelationship; label: string }[] = [
  { id: 'child', label: 'Enfant' },
  { id: 'parent', label: 'Parent' },
  { id: 'spouse', label: 'Conjoint·e' },
  { id: 'sibling', label: 'Frère ou sœur' },
  { id: 'grandparent', label: 'Grand-parent' },
  { id: 'other', label: 'Autre' },
];

const STORAGES: readonly { id: CabinetStorage; label: string; hint: string }[] = [
  { id: 'room', label: 'Pièce de la maison', hint: 'À l\'abri du soleil, loin de la cuisine et de la salle de bain.' },
  { id: 'fridge', label: 'Réfrigérateur', hint: 'Indiquez si les coupures de courant sont fréquentes : la chaleur est alors surveillée.' },
  { id: 'bag', label: 'Sac', hint: 'Un sac posé au soleil chauffe vite : la météo est surveillée.' },
  { id: 'car', label: 'Voiture', hint: 'Une voiture au soleil dépasse souvent 50 °C : à éviter pour tout médicament.' },
];

/** Villes proposées quand la géolocalisation est refusée ou indisponible. */
const CITIES: readonly { name: string; lat: number; lng: number }[] = [
  { name: 'Dakar', lat: 14.6928, lng: -17.4467 },
  { name: 'Pikine', lat: 14.7646, lng: -17.3907 },
  { name: 'Rufisque', lat: 14.7167, lng: -17.2667 },
  { name: 'Thiès', lat: 14.7910, lng: -16.9359 },
  { name: 'Mbour', lat: 14.4198, lng: -16.9639 },
  { name: 'Touba', lat: 14.8667, lng: -15.8833 },
  { name: 'Kaolack', lat: 14.1652, lng: -16.0726 },
  { name: 'Saint-Louis', lat: 16.0179, lng: -16.4896 },
  { name: 'Ziguinchor', lat: 12.5681, lng: -16.2733 },
  { name: 'Tambacounda', lat: 13.7707, lng: -13.6673 },
];

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function medicineLabel(m: { name: string; dosage: string | null; form: string | null }): string {
  return m.dosage ? `${m.name} — ${m.dosage}${m.form ? ' (' + m.form + ')' : ''}` : m.name;
}

/* ============================================================
   PATIENT — Armoire familiale + alertes de conservation thermique
   (GET/POST/PUT/DELETE /cabinet, /cabinet/members, /cabinet/thermal-status)
   ============================================================ */
@Component({
  selector: 'app-patient-cabinet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, Stat, Tag, ExpiryTag, ModalA11y, FieldLabel, DatePipe, DecimalPipe],
  templateUrl: './patient-cabinet.html',
  styleUrl: './patient-cabinet.css',
})
export class PatientCabinet {
  private readonly api = inject(CabinetService);
  private readonly meds = inject(MedicineService);
  private readonly platform = inject(PlatformState);
  /** Liste relue : le tableau de bord patient met à jour la pastille « Armoire familiale ». */
  readonly itemsChange = output<ApiCabinetItem[]>();

  readonly relationships = RELATIONSHIPS;
  readonly storages = STORAGES;
  readonly cities = CITIES;
  readonly today = isoToday();

  // ── Données ───────────────────────────────────────────────────
  readonly items = signal<ApiCabinetItem[]>([]);
  readonly members = signal<ApiFamilyMember[]>([]);
  readonly thermal = signal<ThermalState | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly thermalError = signal(false);
  readonly thermalLoading = signal(false);
  readonly catalogue = signal<CatalogueItem[]>([]);

  // ── Filtres ───────────────────────────────────────────────────
  readonly memberFilter = signal<MemberFilter>('all');
  readonly stateFilter = signal<StateFilter>('all');

  // ── Écritures en cours (verrou par ligne) ─────────────────────
  readonly busy = signal<ReadonlySet<number>>(new Set());
  readonly saving = signal(false);
  readonly locating = signal(false);

  // ── Modales ───────────────────────────────────────────────────
  readonly form = signal<ItemForm | null>(null);
  readonly formError = signal<string | null>(null);
  readonly toDelete = signal<ApiCabinetItem | null>(null);
  readonly membersOpen = signal(false);
  readonly memberEdit = signal<{ id: number | null; name: string; relationship: FamilyRelationship } | null>(null);
  readonly memberError = signal<string | null>(null);
  readonly locationOpen = signal(false);

  constructor() {
    this.reload();
  }

  // ── Dérivés ───────────────────────────────────────────────────
  readonly thermalById = computed(() => {
    const t = this.thermal();
    const byId = new Map<number, ApiThermalItem>();
    if (t?.kind === 'ready') for (const row of t.status.data) byId.set(row.id, row);
    return byId;
  });

  readonly rows = computed<CabinetRow[]>(() => this.items().map(item => {
    const thermal = this.thermalById().get(item.id) ?? null;
    const heat = thermal?.at_risk ?? false;
    const tone: Tone = heat || item.expiry_level === 'expired' || item.expiry_level === 'crit' ? 'red'
      : item.expiry_level === 'warn' ? 'amber' : 'green';
    return { item, thermal, heat, tone, label: medicineLabel(item.medicine) };
  }));

  readonly counts = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      soon: rows.filter(r => r.item.expiry_level === 'warn' || r.item.expiry_level === 'crit').length,
      expired: rows.filter(r => r.item.expiry_level === 'expired').length,
      heat: rows.filter(r => r.heat).length,
    };
  });

  readonly visibleRows = computed(() => {
    const member = this.memberFilter();
    const state = this.stateFilter();
    return this.rows().filter(r => {
      if (member === 'me' && r.item.member) return false;
      if (typeof member === 'number' && r.item.member?.id !== member) return false;
      if (state === 'soon') return r.item.expiry_level === 'warn' || r.item.expiry_level === 'crit';
      if (state === 'expired') return r.item.expiry_level === 'expired';
      if (state === 'heat') return r.heat;
      return true;
    });
  });

  /** Nombre de médicaments par proche (« Gérer les proches » : suppression bloquée tant qu'il en reste). */
  readonly itemsByMember = computed(() => {
    const counts = new Map<number, number>();
    for (const i of this.items()) if (i.member) counts.set(i.member.id, (counts.get(i.member.id) ?? 0) + 1);
    return counts;
  });

  readonly storageHint = computed(() => STORAGES.find(s => s.id === this.form()?.storage)?.hint ?? '');

  // ── Chargement ────────────────────────────────────────────────
  reload(): void {
    this.loadItems();
    this.loadThermal();
    this.api.members().subscribe({ next: m => this.members.set(m), error: () => { /* la liste des proches reste vide : seul « Moi » est proposé */ } });
  }

  private loadItems(): void {
    this.api.items().subscribe({
      next: list => { this.items.set(list); this.loading.set(false); this.loadError.set(false); this.itemsChange.emit(list); },
      error: () => { this.loading.set(false); this.loadError.set(true); },
    });
  }

  private loadThermal(): void {
    this.thermalLoading.set(true);
    this.api.thermalStatus().subscribe({
      next: t => { this.thermal.set(t); this.thermalError.set(false); this.thermalLoading.set(false); },
      error: () => { this.thermalError.set(true); this.thermalLoading.set(false); },
    });
  }

  private ensureCatalogue(): void {
    if (this.catalogue().length) return;
    this.meds.list().subscribe(list => this.catalogue.set(list));
  }

  // ── Libellés ──────────────────────────────────────────────────
  relationLabel(r: FamilyRelationship): string { return RELATIONSHIPS.find(x => x.id === r)?.label ?? 'Proche'; }
  forWhom(i: ApiCabinetItem): string { return i.member ? `${i.member.name} (${this.relationLabel(i.member.relationship).toLocaleLowerCase('fr')})` : 'Moi'; }
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }
  isBusy(id: number): boolean { return this.busy().has(id); }

  private lock(id: number, on: boolean): void {
    this.busy.update(s => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next; });
  }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    const body = e.error as ApiErrorBody | null;
    const first = body?.errors ? Object.values(body.errors)[0]?.[0] : undefined;
    return first ?? body?.message ?? fallback;
  }

  // ── Ajouter / modifier un médicament ──────────────────────────
  openAdd(): void {
    this.ensureCatalogue();
    const member = this.memberFilter();
    this.formError.set(null);
    this.form.set({
      id: null, medicine: '', initialMedicine: null,
      member: typeof member === 'number' ? String(member) : '',
      expiry: '', storage: 'room', powerCuts: false, openedAt: '',
    });
  }

  openEdit(i: ApiCabinetItem): void {
    this.ensureCatalogue();
    const label = medicineLabel(i.medicine);
    this.formError.set(null);
    this.form.set({
      id: i.id, medicine: label, initialMedicine: { id: i.medicine.id, label },
      member: i.member ? String(i.member.id) : '',
      expiry: i.expiry_date, storage: i.storage_location, powerCuts: i.fridge_power_cuts ?? false, openedAt: i.opened_at ?? '',
    });
  }

  patchForm(patch: Partial<ItemForm>): void { this.form.update(f => f ? { ...f, ...patch } : f); }

  /** Médicament choisi dans la liste : libellé exact, sinon nom exact et unique — jamais « le premier résultat ». */
  private resolveMedicine(f: ItemForm): number | null {
    const value = f.medicine.trim().toLocaleLowerCase('fr');
    if (f.initialMedicine && f.initialMedicine.label.toLocaleLowerCase('fr') === value) return f.initialMedicine.id;
    const list = this.catalogue();
    const byLabel = list.find(m => m.label.toLocaleLowerCase('fr') === value);
    if (byLabel) return byLabel.id;
    const byName = list.filter(m => m.name.toLocaleLowerCase('fr') === value);
    return byName.length === 1 ? byName[0].id : null;
  }

  saveItem(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    const medicineId = this.resolveMedicine(f);
    if (!medicineId) { this.formError.set('Choisissez le médicament dans la liste proposée.'); return; }
    if (!f.expiry) { this.formError.set('Indiquez la date de péremption inscrite sur la boîte.'); return; }

    const payload: CabinetItemPayload = {
      medicine_id: medicineId,
      family_member_id: f.member ? Number(f.member) : null,
      expiry_date: f.expiry,
      storage_location: f.storage,
      fridge_power_cuts: f.storage === 'fridge' ? f.powerCuts : null,
      opened_at: f.openedAt || null,
    };
    this.saving.set(true);
    this.formError.set(null);
    const request = f.id === null ? this.api.add(payload) : this.api.update(f.id, payload);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.form.set(null);
        this.platform.notify(f.id === null ? 'Médicament ajouté à l\'armoire' : 'Médicament mis à jour', 'ok');
        this.loadItems();
        this.loadThermal();
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.formError.set(this.apiError(e, 'Enregistrement impossible — vérifiez la connexion et réessayez.')); },
    });
  }

  // ── Actions par ligne ─────────────────────────────────────────
  markOpened(i: ApiCabinetItem): void {
    if (this.isBusy(i.id)) return;
    this.lock(i.id, true);
    this.api.markOpened(i.id).subscribe({
      next: updated => {
        this.lock(i.id, false);
        this.items.update(list => list.map(x => x.id === updated.id ? updated : x));
        this.platform.notify(`${i.medicine.name} marqué comme ouvert aujourd'hui`, 'ok');
        this.loadThermal(); // un flacon ouvert n'a plus le même seuil de température
      },
      error: (e: HttpErrorResponse) => { this.lock(i.id, false); this.platform.notify(this.apiError(e, 'Mise à jour impossible'), 'alert'); },
    });
  }

  confirmDelete(): void {
    const i = this.toDelete();
    if (!i || this.isBusy(i.id)) return;
    this.lock(i.id, true);
    this.api.remove(i.id).subscribe({
      next: () => {
        this.lock(i.id, false);
        this.toDelete.set(null);
        this.items.update(list => list.filter(x => x.id !== i.id));
        this.platform.notify(`${i.medicine.name} retiré de l'armoire`, 'info');
        this.loadThermal();
      },
      error: (e: HttpErrorResponse) => { this.lock(i.id, false); this.platform.notify(this.apiError(e, 'Suppression impossible'), 'alert'); },
    });
  }

  // ── Proches ───────────────────────────────────────────────────
  openMembers(): void { this.memberEdit.set(null); this.memberError.set(null); this.membersOpen.set(true); }
  newMember(): void { this.memberError.set(null); this.memberEdit.set({ id: null, name: '', relationship: 'child' }); }
  editMember(m: ApiFamilyMember): void { this.memberError.set(null); this.memberEdit.set({ id: m.id, name: m.name, relationship: m.relationship }); }
  patchMember(patch: Partial<{ name: string; relationship: FamilyRelationship }>): void { this.memberEdit.update(m => m ? { ...m, ...patch } : m); }

  saveMember(): void {
    const m = this.memberEdit();
    if (!m || this.saving()) return;
    const name = m.name.trim();
    if (!name) { this.memberError.set('Indiquez le prénom du proche.'); return; }
    this.saving.set(true);
    const request = m.id === null ? this.api.addMember(name, m.relationship) : this.api.updateMember(m.id, name, m.relationship);
    request.subscribe({
      next: saved => {
        this.saving.set(false);
        this.memberEdit.set(null);
        this.members.update(list => [...list.filter(x => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
        this.platform.notify(m.id === null ? `${saved.name} ajouté à vos proches` : 'Proche mis à jour', 'ok');
        if (m.id !== null) this.loadItems(); // le nom apparaît sur les lignes de l'armoire
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.memberError.set(this.apiError(e, 'Enregistrement impossible — réessayez.')); },
    });
  }

  removeMember(m: ApiFamilyMember): void {
    if (this.isBusy(-m.id)) return;
    this.lock(-m.id, true);
    this.memberError.set(null);
    this.api.removeMember(m.id).subscribe({
      next: () => {
        this.lock(-m.id, false);
        this.members.update(list => list.filter(x => x.id !== m.id));
        if (this.memberFilter() === m.id) this.memberFilter.set('all');
        this.platform.notify(`${m.name} retiré de vos proches`, 'info');
      },
      error: (e: HttpErrorResponse) => { this.lock(-m.id, false); this.memberError.set(this.apiError(e, 'Suppression impossible — réessayez.')); },
    });
  }

  // ── Domicile (surveillance thermique) ─────────────────────────
  useMyPosition(): void {
    if (!('geolocation' in navigator)) { this.platform.notify('La localisation n\'est pas disponible sur cet appareil — choisissez votre ville', 'alert'); return; }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      pos => this.saveLocation(pos.coords.latitude, pos.coords.longitude, 'votre position'),
      () => { this.locating.set(false); this.platform.notify('Position refusée ou introuvable — choisissez votre ville', 'alert'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  useCity(name: string): void {
    const city = CITIES.find(c => c.name === name);
    if (city) this.saveLocation(city.lat, city.lng, city.name);
  }

  private saveLocation(lat: number, lng: number, label: string): void {
    this.locating.set(true);
    this.api.saveHomeLocation(Number(lat.toFixed(5)), Number(lng.toFixed(5))).subscribe({
      next: () => {
        this.locating.set(false);
        this.locationOpen.set(false);
        this.platform.notify(`Domicile enregistré (${label}) — surveillance thermique activée`, 'ok');
        this.loadThermal();
      },
      error: (e: HttpErrorResponse) => { this.locating.set(false); this.platform.notify(this.apiError(e, 'Position non enregistrée — réessayez'), 'alert'); },
    });
  }
}
