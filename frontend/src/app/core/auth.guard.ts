import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { isDesktop } from './desktop';

export const authGuard: CanActivateFn = async () => {
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
  return router.createUrlTree(['/login']);
};
