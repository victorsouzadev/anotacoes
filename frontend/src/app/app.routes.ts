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
  {
    path: 'tasks',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/list/tasks-list.page').then((m) => m.TasksListPageComponent),
  },
  {
    path: 'tasks/categorias',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/categories/tasks-categories.page').then((m) => m.TasksCategoriesPageComponent),
  },
  {
    path: 'tasks/pomodoro',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/pomodoro/tasks-pomodoro.page').then((m) => m.TasksPomodoroPageComponent),
  },
  {
    path: 'tasks/estatisticas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/statistics/tasks-statistics.page').then((m) => m.TasksStatisticsPageComponent),
  },
  {
    path: 'tasks/lixeira',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/trash/tasks-trash.page').then((m) => m.TasksTrashPageComponent),
  },
  {
    path: 'tasks/kanban',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/kanban/tasks-kanban.page').then((m) => m.TasksKanbanPageComponent),
  },
  {
    path: 'tasks/calendario',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/calendar/tasks-calendar.page').then((m) => m.TasksCalendarPageComponent),
  },
  {
    path: 'tasks/ajuda',
    canActivate: [authGuard],
    loadComponent: () => import('./features/tasks/help/tasks-help.page').then((m) => m.TasksHelpPageComponent),
  },
  {
    path: 'bolo-3d',
    canActivate: [authGuard],
    loadComponent: () => import('./features/cake/cake-simulator.page').then((m) => m.CakeSimulatorPageComponent),
  },
  { path: '**', redirectTo: '' },
];
