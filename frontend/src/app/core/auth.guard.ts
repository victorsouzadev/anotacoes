import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { isDesktop } from './desktop';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  if (isDesktop()) {
    // Programa desktop: entra sozinho como o usuário local.
    try {
      await auth.loginLocal();
      return true;
    } catch {
      return false;
    }
  }
  // Volta para onde a pessoa ia depois do login (ex.: o app do celular em /capturar).
  return router.createUrlTree(['/login'], state.url && state.url !== '/' ? { queryParams: { voltar: state.url } } : {});
};
