import { Routes } from '@angular/router';
import { sairDoCraft } from './crafts/craft-host.page';

/** Rotas do Estúdio (filhas de /estudio, dentro da barra do Estúdio). */
export const ESTUDIO_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./estudio-home.page').then((m) => m.EstudioHomePageComponent) },
  { path: 'biblioteca', loadComponent: () => import('./biblioteca.page').then((m) => m.BibliotecaPageComponent) },
  { path: 'configuracoes', loadComponent: () => import('./estudio-config.page').then((m) => m.EstudioConfigPageComponent) },
  { path: 'ia/:app', loadComponent: () => import('./ia/gerar.page').then((m) => m.GerarPageComponent) },
  { path: 'ferramentas/editar-imagem', loadComponent: () => import('./ferramentas/editar-imagem.page').then((m) => m.EditarImagemPageComponent) },
  { path: 'ferramentas/quadros', loadComponent: () => import('./ferramentas/quadros.page').then((m) => m.QuadrosPageComponent) },
  { path: 'ferramentas/montagem', loadComponent: () => import('./ferramentas/montagem.page').then((m) => m.MontagemPageComponent) },
  { path: 'ferramentas/storyboard', loadComponent: () => import('./ferramentas/storyboard.page').then((m) => m.StoryboardPageComponent) },
  { path: 'ferramentas/moodboard', loadComponent: () => import('./ferramentas/moodboard.page').then((m) => m.MoodboardPageComponent) },
  { path: 'ferramentas/palco', loadComponent: () => import('./ferramentas/palco/palco.page').then((m) => m.PalcoPageComponent) },
  {
    path: 'apps/:craft',
    loadComponent: () => import('./crafts/craft-host.page').then((m) => m.CraftHostPageComponent),
    canDeactivate: [sairDoCraft],
  },
];
