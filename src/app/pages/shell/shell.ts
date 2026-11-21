import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { PlatformState } from '../../services/platform/platform';
import { AuthService } from '../../services/auth/auth';
import { ICON_TONE, NAV, roleById } from '../../data/mock-data';
import { NavItem, Notif, RoleId } from '../../interfaces/models';
import { GlobalSearchResult } from '../../interfaces/api';
import { MedicineService } from '../../services/medicines/medicines';
import { NotificationService } from '../../services/notifications/notifications';
import { ToastHost } from '../../components/toast-host/toast-host';
import { ScrollChain } from '../../directives/scroll-chain/scroll-chain';
import { PasswordModal } from '../../components/password-modal/password-modal';
import { VoiceLangPicker } from '../../components/voice-lang/voice-lang';
import { PatientDash } from '../dashboards/patient/patient';
import { PharmaDash } from '../dashboards/pharma/pharma';
import { DistribDash } from '../dashboards/distrib/distrib';
import { HopitalDash } from '../dashboards/hopital/hopital';
import { SanteDash } from '../dashboards/sante/sante';

/* ---------------- Shell de l'application ---------------- */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Logo, ToastHost, ScrollChain, PasswordModal, VoiceLangPicker, PatientDash, PharmaDash, DistribDash, HopitalDash, SanteDash],
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
  /** Recherche en échec : message dédié, pas « aucun résultat ». */
  readonly searchError = signal(false);
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
  /** Nom en tête de la barre haute (téléphone) : la structure, ou la personne pour un patient sans structure. */
  readonly topName = computed(() => this.auth.structure() ? this.identity().name : (this.userName() || this.identity().name));
  readonly userEmail = computed(() => this.auth.user()?.email ?? '');
  /** Page profil / structure de l'espace, si elle existe (patient « Mon profil », officine…). */
  readonly profileNav = computed(() => this.nav().find(n => n.id === 'profil') ?? null);
  readonly passwordOpen = signal(false);
  /** Teinte de l'espace (patient bleu, officine teal, distributeur violet, hôpital bleu ciel, santé rose). */
  readonly roleTone = computed(() => ICON_TONE[this.current()?.icon ?? ''] ?? 'blue');
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
  /* ---- Téléphone : présentation « application » (barre d'onglets en bas, feuille « Plus », titre dans la barre haute) ---- */
  /** Onglets de la barre du bas (entrées marquées `tab`), dans l'ordre de la navigation. */
  readonly tabs = computed(() => this.nav().filter(n => n.tab));
  /** Tout le reste de la navigation, rangé dans la feuille « Plus ». */
  readonly moreItems = computed(() => this.nav().filter(n => !n.tab));
  /** Les mêmes entrées, une liste groupée par intitulé (« Comptoir », « Stock »…) comme un réglage natif. */
  readonly moreGroups = computed(() => this.moreItems().reduce<{ label: string; items: NavItem[] }[]>((groups, item) => {
    const label = item.group ?? '';
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item); else groups.push({ label, items: [item] });
    return groups;
  }, []));
  /** Travail en attente dans les sections rangées sous « Plus » : la pastille de l'onglet les additionne. */
  readonly moreBadge = computed(() => this.moreItems().reduce((sum, n) => sum + (n.badge ?? 0), 0));
  /** La section affichée n'est pas un onglet : « Plus » est l'onglet actif. */
  readonly onMore = computed(() => !this.tabs().some(t => t.id === this.sec()));
  readonly moreOpen = signal(false);
  /** Recherche du haut ouverte (sur téléphone le champ remplace la barre, « Annuler » la referme). */
  readonly searchOpen = signal(false);
  /** Page défilée sous la barre haute : le titre de la section y apparaît (le grand titre est sorti de l'écran). */
  readonly scrolled = signal(false);
  readonly sectionTitle = computed(() => this.nav().find(n => n.id === this.sec())?.label ?? '');
  /** iPhone dans Safari (pas encore installée) : on explique comment l'ajouter à l'écran d'accueil. */
  readonly installHint = signal(this.shouldHintInstall());

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
      // Changement de section : le contenu entre en fondu (pas au premier affichage).
      let first = true;
      effect(() => {
        this.sec();
        if (first) { first = false; return; }
        afterNextRender({ write: () => this.animateContent() }, { injector: this.injector });
      });
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
        this.searchError.set(false);
        if (term.length < 2) {
          this.searchLoading.set(false);
          return of([]);
        }
        this.searchLoading.set(true);
        return this.medicines.globalSearch(term).pipe(
          catchError(() => { this.searchError.set(true); return of([]); }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.globalResults.set(results);
      this.searchLoading.set(false);
    });
    if (r) this.notificationService.load(r).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(notifications => this.notifications.set(notifications));
    // Signal écrit seulement au franchissement du seuil : pas de détection de changement à chaque pixel défilé.
    const onScroll = () => { const s = window.scrollY > 56; if (s !== this.scrolled()) this.scrolled.set(s); };
    window.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
  }

  private shouldHintInstall(): boolean {
    try {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      return ios && !standalone && localStorage.getItem('nova-install-hint') !== 'off';
    } catch { return false; }
  }
  dismissInstall(): void {
    this.installHint.set(false);
    try { localStorage.setItem('nova-install-hint', 'off'); } catch { /* navigation privée : ignoré */ }
  }

  /** Feuille « Plus » : le focus entre dans la feuille (pas de contour sur une entrée au doigt), et revient à l'onglet « Plus » à la fermeture. */
  openMore(): void {
    this.closeMenus();
    this.moreOpen.set(true);
    afterNextRender({ read: () => document.querySelector<HTMLElement>('.pf-sheet')?.focus() }, { injector: this.injector });
  }
  closeMore(restoreFocus = true): void {
    this.moreOpen.set(false);
    if (restoreFocus) afterNextRender({ read: () => document.querySelector<HTMLElement>('.pf-tab-more')?.focus() }, { injector: this.injector });
  }
  /** Feuille « Plus » → section, mot de passe, notifications. */
  moreSelect(id: string): void { this.closeMore(false); this.select(id); }
  morePassword(): void { this.closeMore(false); this.passwordOpen.set(true); }
  moreNotifications(e: Event): void { this.closeMore(false); this.toggleNotif(e); }
  openSearch(): void {
    this.closeMenus();
    this.searchOpen.set(true);
    afterNextRender({ read: () => document.querySelector<HTMLInputElement>('.pf-topsearch input')?.focus() }, { injector: this.injector });
  }
  closeSearch(): void {
    this.searchOpen.set(false);
    this.globalQuery.set('');
    this.globalResults.set([]);
    this.searchFocused.set(false);
    afterNextRender({ read: () => document.querySelector<HTMLElement>('.pf-searchbtn')?.focus() }, { injector: this.injector });
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

  /** Fondu court du contenu (Web Animations) ; rien si « réduire les animations » ou sans support. */
  private animateContent(): void {
    const el = document.querySelector<HTMLElement>('.pf-content');
    if (!el || typeof el.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
    window.scrollTo({ top: 0 });
  }

  shortLabel(label: string): string { return label.split(' / ')[0]; }
  select(id: string): void {
    // Onglet déjà actif : comme une app, un nouvel appui remonte en haut de la page.
    if (id === this.sec()) window.scrollTo({ top: 0, behavior: 'smooth' });
    this.sec.set(id);
    this.notifOpen.set(false);
    this.moreOpen.set(false);
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
  /** Croix du champ : vide la recherche, le champ garde le focus (la croix native de Chrome est masquée). */
  clearGlobalSearch(input: HTMLInputElement): void {
    this.globalQuery.set('');
    this.globalResults.set([]);
    this.searchLoading.set(false);
    this.searchInput$.next('');
    input.focus();
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
    this.searchOpen.set(false);
    if (this.role() === 'patient') this.sec.set(result.type === 'pharmacy' ? 'phar' : 'search');
  }
  focusGlobalSearch(): void { this.searchFocused.set(true); }
  closeGlobalSearch(): void { window.setTimeout(() => this.searchFocused.set(false), 120); }
  toggleCollapse(): void { this.collapsed.update(c => !c); }
  /** Menu du compte → section (ferme le menu). */
  openFromMenu(id: string): void { this.profileOpen.set(false); this.select(id); }
  openPassword(): void { this.profileOpen.set(false); this.passwordOpen.set(true); }
  /** Menu du compte → panneau des notifications (même bouton que la cloche). */
  openNotifFromMenu(e: Event): void { e.stopPropagation(); this.profileOpen.set(false); this.notifOpen.set(true); }
  /** Le logo ramène à la première section de l'espace (la déconnexion est dans le menu du compte). */
  goHome(): void { const first = this.nav()[0]; if (first) this.select(first.id); }
  toggleNotif(e: Event): void { e.stopPropagation(); this.profileOpen.set(false); this.notifOpen.update(o => !o); }
  toggleProfile(e: Event): void { e.stopPropagation(); this.notifOpen.set(false); this.profileOpen.update(o => !o); }
  /**
   * Échap : ferme d'abord le panneau ouvert (notifications ou profil) et rend le focus à son bouton,
   * sinon le tiroir de navigation (téléphone). Un seul niveau fermé par appui.
   */
  onEscape(): void {
    const trigger = this.notifOpen() ? '.pf-notifwrap .pf-iconbtn' : this.profileOpen() ? '.pf-roleswbtn' : null;
    if (trigger) {
      this.closeMenus();
      document.querySelector<HTMLElement>(trigger)?.focus();
    } else if (this.moreOpen()) {
      this.closeMore();
    } else if (this.searchOpen()) {
      this.closeSearch();
    } else if (this.drawerOpen()) {
      this.closeDrawer();
    }
  }
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
