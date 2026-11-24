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
    // Painel de plug-ins (spec 040): a API só responde para HUB_ADMINISTRADORES.
    path: 'plugins',
    canActivate: [authGuard],
    loadComponent: () => import('./features/plugins/plugins.page').then((m) => m.PluginsPageComponent),
  },
  { path: '**', redirectTo: '' },
];
