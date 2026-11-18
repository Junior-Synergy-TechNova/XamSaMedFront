import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { HospitalService } from '../hospital/hospital';
import { DistributorService } from '../distributor/distributor';
import { OrderService } from '../orders/orders';
import { PublicHealthService } from '../public-health/public-health';
import { SHARED_READ_MS } from './shared-read';
import { environment } from '../../../environments/environment';

const api = environment.apiUrl;

describe('SharedRead — cloche et tableau de bord partagent la même lecture', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem('nova-token', 'tok-A');
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => localStorage.removeItem('nova-token'));

  it('hôpital : deux lecteurs rapprochés = un seul appel /hospital/alerts', async () => {
    const svc = TestBed.inject(HospitalService);
    const bell = firstValueFrom(svc.alerts(SHARED_READ_MS));
    const dash = firstValueFrom(svc.alerts(SHARED_READ_MS)); // requête encore en cours : partagée
    http.expectOne(`${api}/hospital/alerts`).flush({ data: [{ id: 1, medicine: 'Insuline', service: 'Urgences', severity: 'rupture', remaining_quantity: 0 }] });
    expect((await bell).length).toBe(1);
    expect((await dash).length).toBe(1);
    http.verify();
  });

  it('après une action (maxAgeMs = 0), toujours un nouvel appel', () => {
    const svc = TestBed.inject(DistributorService);
    svc.regionalDemands(SHARED_READ_MS).subscribe();
    http.expectOne(`${api}/distributor/regional-demands`).flush({ data: [] });
    svc.regionalDemands().subscribe();
    http.expectOne(`${api}/distributor/regional-demands`).flush({ data: [] });
  });

  it('un autre compte connecté ne réutilise jamais la lecture du précédent', () => {
    const svc = TestBed.inject(OrderService);
    svc.list(SHARED_READ_MS).subscribe();
    http.expectOne(`${api}/orders`).flush({ data: [] });
    localStorage.setItem('nova-token', 'tok-B');
    svc.list(SHARED_READ_MS).subscribe();
    http.expectOne(`${api}/orders`).flush({ data: [] });
  });

  it('une erreur n\'est pas gardée : le lecteur suivant relance l\'appel', () => {
    const svc = TestBed.inject(PublicHealthService);
    svc.zones(SHARED_READ_MS).subscribe({ error: () => { /* attendu */ } });
    http.expectOne(`${api}/public-health/zones`).error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    svc.zones(SHARED_READ_MS).subscribe();
    http.expectOne(`${api}/public-health/zones`).flush({ data: [] });
  });
});
