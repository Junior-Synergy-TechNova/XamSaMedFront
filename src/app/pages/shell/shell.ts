import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { PlatformState } from '../../services/platform/platform';
import { AuthService } from '../../services/auth/auth';
import { NAV, roleById } from '../../data/mock-data';
import { NavItem, Notif, RoleId } from '../../interfaces/models';
import { GlobalSearchResult } from '../../interfaces/api';
import { MedicineService } from '../../services/medicines/medicines';
import { NotificationService } from '../../services/notifications/notifications';
import { ToastHost } from '../../components/toast-host/toast-host';
import { PatientDash } from '../dashboards/patient/patient';
import { PharmaDash } from '../dashboards/pharma/pharma';
import { DistribDash } from '../dashboards/distrib/distrib';
import { HopitalDash } from '../dashboards/hopital/hopital';
import { SanteDash } from '../dashboards/sante/sante';

/* ---------------- Shell de l'application ---------------- */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Logo, ToastHost, PatientDash, PharmaDash, DistribDash, HopitalDash, SanteDash],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class AppShell {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platform = inject(PlatformState);
  private readonly auth = inject(AuthService);
  private readonly medicines = inject(MedicineService);
  private readonly notificationService = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly searchInput$ = new Subject<string>();
  /** Point de rupture où la sidebar est toujours repliée (cf. shell.css). */
  private readonly narrowQuery = window.matchMedia('(max-width: 860px)');
  /** Téléphone : la sidebar devient un tiroir ouvert par le bouton menu (cf. shell.css). */
  private readonly phoneQuery = window.matchMedia('(max-width: 760px)');

  readonly role = this.platform.role;
  readonly collapsed = signal(false);
  readonly narrow = signal(this.narrowQuery.matches);
  readonly phone = signal(this.phoneQuery.matches);
  readonly drawerOpen = signal(false);
  /** Sidebar réduite : choix de l'utilisateur ou écran étroit. Sur téléphone le tiroir garde ses libellés. */
  readonly compact = computed(() => !this.phone() && (this.collapsed() || this.narrow()));
  readonly notifOpen = signal(false);
  readonly profileOpen = signal(false);
  readonly sec = signal<string>('search');
  readonly globalQuery = signal('');
  readonly globalResults = signal<GlobalSearchResult[]>([]);
  readonly searchLoading = signal(false);
  readonly searchFocused = signal(false);
  readonly dismissedNotifications = signal<Set<string>>(new Set());
  readonly notifications = signal<Notif[]>([]);

  readonly current = computed(() => { const r = this.role(); return r ? roleById(r) : null; });
  /** Identité affichée en tête de sidebar : la structure connectée et sa nature (lues en base). */
  readonly identity = computed(() => {
    const s = this.auth.structure();
    const role = this.current();
    if (!s) return { name: role ? this.shortLabel(role.label) : '', kind: role?.id === 'sante' ? 'Supervision nationale' : 'Espace personnel' };
    const kinds: Record<string, string> = {
      pharmacy: 'Officine', distributor: 'Distributeur privé', pna: 'PNA, niveau national', pra: 'PRA ' + (s.region ?? s.city ?? ''),
      hospital: s.sector === 'private' ? 'Hôpital privé' : 'Hôpital public',
    };
    const plan = s.type === 'pharmacy' ? (s.plan === 'pro' ? ', offre Pro' : ', offre Starter') : '';
    return { name: s.name, kind: (kinds[s.type] ?? s.type) + plan };
  });
  readonly userName = computed(() => this.auth.user()?.name ?? '');
  readonly nav = computed(() => {
    const r = this.role();
    if (!r) return [];
    const work = this.platform.navCounts();
    const counts = work ?? this.notifs().reduce<Record<string, number>>((result, item) => {
      if (item.target) result[item.target] = (result[item.target] ?? 0) + 1;
      return result;
    }, {});
    return this.navFor(r).map((item, i, all) => ({
      ...item,
      badge: counts[item.id] ?? 0,
      /** Première entrée d'un groupe : la sidebar affiche l'intitulé juste avant. */
      groupStart: !!item.group && item.group !== all[i - 1]?.group,
    }));
  });
  readonly notifs = computed(() => {
    const role = this.role();
    const dismissed = this.dismissedNotifications();
    return this.notifications().filter(n => !dismissed.has(`${role}:${n.t}:${n.d}`));
  });

  constructor() {
    const r = this.platform.role();
    if (!r) { this.router.navigateByUrl('/login'); }
    else {
      // Section de départ : celle de l'URL (lien direct, rechargement), sinon la dernière mémorisée, sinon la première.
      const items = this.navFor(r);
      const known = (id: string | null): id is string => !!id && items.some(n => n.id === id);
      const fromUrl = this.route.snapshot.queryParamMap.get('s');
      const saved = this.platform.restoreSection(r);
      this.sec.set(known(fromUrl) ? fromUrl : known(saved) ? saved : items[0].id);
      // Chaque section a son URL (`/app?s=stock`) : le bouton Retour du navigateur revient à la section précédente.
      effect(() => {
        const s = this.sec();
        const current = this.route.snapshot.queryParamMap.get('s');
        if (current !== s) this.router.navigate([], { relativeTo: this.route, queryParams: { s }, replaceUrl: current === null });
      });
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(q => {
        const s = q.get('s');
        if (known(s) && s !== this.sec()) this.sec.set(s);
      });
      // Persiste chaque changement, qu'il vienne de la sidebar ou d'un bouton du dashboard.
      effect(() => { const role = this.role(); if (role) this.platform.saveSection(role, this.sec()); });
    }
    const onNarrow = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    this.narrowQuery.addEventListener('change', onNarrow);
    this.destroyRef.onDestroy(() => this.narrowQuery.removeEventListener('change', onNarrow));
    const onPhone = (e: MediaQueryListEvent) => { this.phone.set(e.matches); if (!e.matches) this.drawerOpen.set(false); };
    this.phoneQuery.addEventListener('change', onPhone);
    this.destroyRef.onDestroy(() => this.phoneQuery.removeEventListener('change', onPhone));
    this.searchInput$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(query => {
        const term = query.trim();
        if (term.length < 2) {
          this.searchLoading.set(false);
          return of([]);
        }
        this.searchLoading.set(true);
        return this.medicines.globalSearch(term);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.globalResults.set(results);
      this.searchLoading.set(false);
    });
    if (r) this.notificationService.load(r).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(notifications => this.notifications.set(notifications));
  }

  /**
   * Entrées de navigation du rôle, filtrées selon la structure lue en base :
   * ex. « Commandes PRA » réservé aux hôpitaux publics, « Institutionnel » à la PNA / aux PRA.
   */
  private navFor(role: RoleId): NavItem[] {
    const structure = this.auth.structure();
    const sector = structure?.sector ?? (structure?.type === 'hospital' ? 'public' : null);
    return NAV[role].filter(item =>
      (!item.types || (structure !== null && item.types.includes(structure.type)))
      && (!item.sector || item.sector === sector));
  }

  shortLabel(label: string): string { return label.split(' / ')[0]; }
  select(id: string): void {
    this.sec.set(id);
    this.notifOpen.set(false);
    if (this.drawerOpen()) this.closeDrawer(false);
  }
  /** Tiroir de navigation (téléphone) : le focus entre sur l'entrée active, et revient au bouton menu à la fermeture. */
  openDrawer(): void {
    this.closeMenus();
    this.drawerOpen.set(true);
    afterNextRender({ read: () => document.querySelector<HTMLElement>('.pf-side .pf-navitem.on, .pf-side .pf-navitem')?.focus() }, { injector: this.injector });
  }
  closeDrawer(restoreFocus = true): void {
    this.drawerOpen.set(false);
    if (restoreFocus) afterNextRender({ read: () => document.querySelector<HTMLElement>('.pf-burger')?.focus() }, { injector: this.injector });
  }
  openNotification(index: number): void {
    const role = this.role();
    const notification = this.notifs()[index];
    if (role && notification) {
      // Notification persistée → marquer lue côté serveur.
      if (notification.id) this.notificationService.markRead(notification.id).subscribe({ error: () => { /* ignore */ } });
      this.dismissedNotifications.update(items => {
        const next = new Set(items);
        next.add(`${role}:${notification.t}:${notification.d}`);
        return next;
      });
      const items = this.navFor(role);
      const target = notification.target && items.some(n => n.id === notification.target) ? notification.target : items[0].id;
      this.select(target);
    }
  }
  searchGlobal(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.globalQuery.set(query);
    this.searchLoading.set(query.trim().length >= 2);
    this.searchInput$.next(query);
  }
  openGlobalResult(result: GlobalSearchResult): void {
    this.globalQuery.set(result.label);
    this.globalResults.set([]);
    this.searchFocused.set(false);
    if (this.role() === 'patient') this.sec.set(result.type === 'pharmacy' ? 'phar' : 'search');
  }
  focusGlobalSearch(): void { this.searchFocused.set(true); }
  closeGlobalSearch(): void { window.setTimeout(() => this.searchFocused.set(false), 120); }
  toggleCollapse(): void { this.collapsed.update(c => !c); }
  /** Le logo ramène à la première section de l'espace (la déconnexion est dans le menu du compte). */
  goHome(): void { const first = this.nav()[0]; if (first) this.select(first.id); }
  toggleNotif(e: Event): void { e.stopPropagation(); this.profileOpen.set(false); this.notifOpen.update(o => !o); }
  toggleProfile(e: Event): void { e.stopPropagation(); this.notifOpen.set(false); this.profileOpen.update(o => !o); }
  closeMenus(): void {
    if (this.notifOpen()) this.notifOpen.set(false);
    if (this.profileOpen()) this.profileOpen.set(false);
  }
  exit(): void {
    // Révoque le token côté serveur ; le nettoyage local (rôle + token) est
    // assuré par AuthService.logout(). Navigation immédiate vers le site public.
    this.auth.logout().subscribe({ error: () => { /* token déjà invalide : ignoré */ } });
    this.router.navigateByUrl('/');
  }
}
