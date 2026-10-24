import { Routes } from '@angular/router';
import { sairDoCraft } from './crafts/craft-host.page';

/** Rotas do Estúdio (filhas de /estudio, dentro da barra do Estúdio). */
export const ESTUDIO_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./estudio-home.page').then((m) => m.EstudioHomePageComponent) },
  { path: 'biblioteca', loadComponent: () => import('./biblioteca.page').then((m) => m.BibliotecaPageComponent) },
  { path: 'configuracoes', loadComponent: () => import('./estudio-config.page').then((m) => m.EstudioConfigPageComponent) },
  { path: 'ia/:app', loadComponent: () => import('./ia/gerar.page').then((m) => m.GerarPageComponent) },
  {
    path: 'apps/:craft',
    loadComponent: () => import('./crafts/craft-host.page').then((m) => m.CraftHostPageComponent),
    canDeactivate: [sairDoCraft],
  },
];
