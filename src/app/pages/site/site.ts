import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  afterNextRender, computed, inject, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { FEATURES } from '../../data/mock-data';

import { FieldLabel } from '../../directives/field-label/field-label';
interface ContactForm { nom: string; email: string; tel: string; profil: string; message: string; }
const EMPTY_FORM: ContactForm = { nom: '', email: '', tel: '', profil: 'Patient / Accompagnant', message: '' };

/* ============================================================
   XamSaMed — Site vitrine (public)
   Accueil · Problème · Fonctionnalités · Comment ça marche · Technologies
   Sécurité · Témoignages · À propos · FAQ · Contact · Footer
   ============================================================ */
@Component({
  selector: 'app-site',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FieldLabel, Icon, Logo],
  templateUrl: './site.html',
  styleUrl: './site.css',
  host: { '(window:scroll)': 'onScroll()' },
})
export class SiteVitrine {
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);
  readonly tab = signal(0);
  readonly faqOpen = signal(0);
  readonly sent = signal(false);
  readonly newsOk = signal(false);
  /** Message d'information affiché en pied de page (mentions légales…). */
  readonly notice = signal<string | null>(null);

  readonly features = FEATURES;
  readonly currentFeature = computed(() => this.features[this.tab()]);

  readonly form = signal<ContactForm>({ ...EMPTY_FORM });
  readonly newsMail = signal('');

  readonly navLinks: [string, string][] = [
    ['Fonctionnalités', '#features'], ['Comment ça marche ?', '#how'],
    ['À propos', '#about'], ['FAQ', '#faq'], ['Contact', '#contact'],
  ];
  readonly heroStats: [string, string][] = [['1 200+', 'Officines connectées'], ['48 s', "Délai moyen d'alerte"], ['32', 'Zones suivies en temps réel']];
  readonly heroLines: [string, string, string][] = [
    ['Pharmacie de la Gare', '2,1 km · 24h/24', 'ok'],
    ['Grande Pharmacie', '3,6 km · sur commande', 'low'],
    ['Pharmacie Espoir', '4,2 km · rupture', 'out'],
  ];
  readonly heroLogos = ['PNA', 'PRA', 'Ubipharm', 'IB', 'Hôpitaux publics'];
  readonly problemCards: [string, string, string][] = [
    ['alert', 'Ruptures invisibles', 'Aucune vue partagée entre officines, distributeurs et hôpitaux.'],
    ['clock', "Recherche à l'aveugle", 'Le patient se déplace sans savoir où le médicament est disponible.'],
    ['truck', 'Logistique non anticipée', 'Les distributeurs réagissent au lieu de prévoir les tensions.'],
  ];
  readonly howSteps: [string, string, string][] = [
    ['search', 'Recherchez', 'Saisissez le nom du médicament (le scan de QR code arrive bientôt).'],
    ['pin', 'Localisez', 'La plateforme affiche en temps réel les officines qui l\'ont réellement en stock.'],
    ['cart', 'Réservez', 'Réservez ou commandez ; en cas de rupture, vous êtes orienté vers une autre pharmacie.'],
    ['bell', 'Soyez alerté', 'Pharmaciens et distributeurs reçoivent les alertes pour réapprovisionner à temps.'],
  ];
  readonly secPts: [string, string, string][] = [
    ['lock', 'Chiffrement des données de santé', 'Les données sensibles sont chiffrées de bout en bout.'],
    ['shield', 'Confidentialité des stocks', 'Partage partiel : vos stocks ne sont jamais exposés globalement.'],
    ['user', "Simplicité d'usage", 'Une interface épurée, utilisable même en zones rurales à faible connectivité.'],
    ['desktop', 'Compatibilité totale', "Smartphone, tablette, desktop — l'expérience s'adapte à chaque support."],
    ['layers', 'Intégration publique', 'Compatible avec les structures publiques (PNA, PRA, IB).'],
    ['refresh', 'Disponibilité continue', 'Synchronisation et notifications automatiques en temps réel.'],
  ];
  readonly testimonials: [string, string, string, string][] = [
    ['« Je trouve l\'insuline de mon père sans faire le tour de la ville. Un vrai soulagement. »', 'Awa N.', 'Accompagnante · Dakar', 'user'],
    ['« Les demandes ciblées m\'évitent d\'exposer mon stock tout en aidant les confrères. »', 'Dr. Sow', 'Pharmacien · Thiès', 'pill'],
    ['« Nous anticipons enfin les tensions régionales au lieu de les subir. »', 'M. Ba', 'Distributeur · PNA', 'truck'],
  ];
  readonly aboutVals: [string, string][] = [
    ['Innovation', 'Une technologie au service du réel, pas l\'inverse.'],
    ['Proximité', 'Pensée pour le terrain, y compris les zones rurales.'],
    ['Confiance', 'Sécurité et confidentialité comme principe fondateur.'],
  ];
  readonly faqs: [string, string][] = [
    ['XamSaMed est-il gratuit pour les patients ?', 'Oui. La recherche de médicaments, la localisation des officines et la réservation sont gratuites pour les patients et leurs accompagnants.'],
    ['Mes stocks sont-ils visibles par tout le monde ?', 'Non. Le partage est partiel : les pharmaciens reçoivent des demandes ciblées sans exposer l\'intégralité de leur stock au public ou aux concurrents.'],
    ['Comment fonctionne l\'accès par QR code ?', 'Chaque produit ou officine peut disposer d\'un QR code. Scanné depuis un smartphone, il ouvre directement la fiche de disponibilité — idéal pour un accès rapide.'],
    ['La plateforme fonctionne-t-elle en zone rurale ?', 'Oui. L\'interface est volontairement légère et simple, conçue pour fonctionner même avec une connectivité limitée.'],
    ['Peut-on connecter nos systèmes existants ?', 'Oui. Une API permet de connecter XamSaMed aux structures publiques (PNA, PRA, IB) et aux systèmes hospitaliers.'],
  ];
  readonly contactList: [string, string, string][] = [
    ['mail', 'Email', 'contact@xamsamed.sn'],
    ['phoneCall', 'Téléphone', '+221 33 800 00 00'],
    ['pin', 'Adresse', 'Dakar, Sénégal — Plateau'],
  ];
  readonly profilOptions = ['Patient / Accompagnant', 'Pharmacien', 'Distributeur / Grossiste', 'Hôpital', 'Responsable santé publique', 'Autre'];

  constructor() {
    // Animation d'apparition au défilement : purement visuelle, hors cycle de
    // détection (l'observer ajoute la classe `in` puis se désabonne).
    afterNextRender(() => {
      const io = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        }
      }, { threshold: 0.12 });
      this.host.nativeElement.querySelectorAll<HTMLElement>('.fade-up').forEach(el => io.observe(el));
      this.destroyRef.onDestroy(() => io.disconnect());
    });
  }

  onScroll(): void { this.scrolled.set(window.scrollY > 20); }

  go(hash: string): void {
    if (hash === '#top') { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else { this.host.nativeElement.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' }); }
  }

  launch(): void { this.router.navigateByUrl('/login'); }
  launchLink(e: Event): void { e.preventDefault(); this.launch(); }

  firstWord(s: string): string { return s.split(' ')[0]; }
  stepNum(i: number): string { return String(i + 1).padStart(2, '0'); }
  val(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }
  setField(key: keyof ContactForm, e: Event): void {
    const value = this.val(e);
    this.form.update(f => ({ ...f, [key]: value }));
  }

  submitContact(e: Event): void { e.preventDefault(); this.sent.set(true); }
  resetContact(): void {
    this.sent.set(false);
    this.form.set({ ...EMPTY_FORM });
  }
  subscribe(e: Event): void { e.preventDefault(); this.newsOk.set(true); }
  mentionsLegales(e: Event): void {
    e.preventDefault();
    this.notice.set('Les mentions légales seront disponibles prochainement.');
  }
}
