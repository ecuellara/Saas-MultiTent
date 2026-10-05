import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  tenantId: string;
  userId: string;
  roleIds: string[];
  permissions: string[];
  sedeId?: string;
}

export const tenantContext = new AsyncLocalStorage<TenantStore>();

export function requireTenant(): TenantStore {
  const ctx = tenantContext.getStore();
  if (!ctx?.tenantId) {
    throw new Error('TenantContext no disponible');
  }
  return ctx;
}

export function currentTenantId(): string {
  return requireTenant().tenantId;
}
