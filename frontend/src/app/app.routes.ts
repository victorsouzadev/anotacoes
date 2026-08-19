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
    path: 'financas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/financas/financas.page').then((m) => m.FinancasPageComponent),
  },
  { path: '**', redirectTo: '' },
];
