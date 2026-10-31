import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Obrador Mel · Pastelería en Santiago',
    loadComponent: () => import('./negocios/sites/pasteleria').then((m) => m.PasteleriaSite),
  },
  { path: '**', redirectTo: '' },
];
