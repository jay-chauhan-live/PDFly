import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:public';

/** Marks a route as reachable without a credential (login, register, refresh). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
