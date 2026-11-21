import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () => import('./features/hub/hub.page').then((m) => m.HubPageComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPageComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPageComponent),
  },
  {
    // Link somente leitura (spec 023): abre sem login.
    path: 'p/nota/:token',
    loadComponent: () => import('./features/notes/public-note.page').then((m) => m.PublicNotePageComponent),
  },
  {
    path: 'notes',
    canActivate: [authGuard],
    loadComponent: () => import('./features/notes/notes-list.page').then((m) => m.NotesListPageComponent),
  },
  {
    path: 'notes/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/editor/editor.page').then((m) => m.EditorPageComponent),
  },
  {
    // Consentimento do OAuth do MCP do Cérebro (spec 028). Fora de /cerebro, que o Caddy manda ao serviço.
    path: 'autorizar',
    canActivate: [authGuard],
    loadComponent: () => import('./features/conexoes/autorizar.page').then((m) => m.AutorizarPageComponent),
  },
  {
    path: 'configuracoes',
    canActivate: [authGuard],
    loadComponent: () => import('./features/configuracoes/configuracoes.page').then((m) => m.ConfiguracoesPageComponent),
  },
  {
    path: 'financas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/financas/financas.page').then((m) => m.FinancasPageComponent),
  },
  {
    path: 'cerebro',
    canActivate: [authGuard],
    loadComponent: () => import('./features/cerebro/cerebro.page').then((m) => m.CerebroPageComponent),
  },
  {
    // App do Segundo Cérebro para o celular (PWA): captura com texto, áudio e o que vier do WhatsApp.
    path: 'capturar',
    canActivate: [authGuard],
    loadComponent: () => import('./features/cerebro/cerebro-celular.page').then((m) => m.CerebroCelularPageComponent),
  },
  {
    path: 'publicar',
    canActivate: [authGuard],
    loadComponent: () => import('./features/publicar/publicar.page').then((m) => m.PublicarPageComponent),
  },
  {
    // Aprovação das pré-anotações do Claude (mestrado). Só funciona com a pasta do run local.
    path: 'anotacao',
    canActivate: [authGuard],
    loadComponent: () => import('./features/anotacao/anotacao.page').then((m) => m.AnotacaoPageComponent),
  },
  { path: '**', redirectTo: '' },
];
