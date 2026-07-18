import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const isAuthCall = req.url.startsWith('/api/auth/');
  const token = auth.getAccessToken();
  const authedReq = !isAuthCall && token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthCall) {
        return from(auth.refreshAccessToken()).pipe(
          switchMap((newToken) => {
            if (!newToken) return throwError(() => err);
            const retried = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
            return next(retried);
          }),
        );
      }
      return throwError(() => err);
    }),
  );
};
