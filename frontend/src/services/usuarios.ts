import api from './api'

/**
 * Capa de dominio de usuarios (equipo de la clínica).
 *
 * La pantalla `/usuarios` lista el equipo y da de alta; los roles viven en
 * `roles.ts`. La contraseña viaja SOLO hacia el servidor en el alta (mínimo
 * 12, regla del backend): nunca se devuelve ni se registra en el cliente.
 */

export type EstadoUsuario = 'ACTIVE' | 'INACTIVE' | 'BLOCKED'

export interface RolResumen {
  id: string
  codigo: string
  nombre: string
}

export interface SedeResumen {
  id: string
  nombre: string
}

export interface MembresiaUsuario {
  id: string
  tenantId: string
  userId: string
  roleId: string
  sedeId: string | null
  estado: string
  joinedAt: string
  role: RolResumen
  sede: SedeResumen | null
}

export interface UsuarioEquipo {
  id: string
  email: string
  nombre: string
  cop: string | null
  estado: EstadoUsuario
  mfaEnabled: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  memberships: MembresiaUsuario[]
}

export interface NuevoUsuario {
  email: string
  password: string
  nombre: string
  roleId: string
  sedeId: string
}

export const ESTADOS_USUARIO: Record<EstadoUsuario, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  BLOCKED: 'Bloqueado',
}

export function etiquetaEstadoUsuario(estado: string): string {
  return (ESTADOS_USUARIO as Record<string, string>)[estado] ?? estado
}

export async function listarUsuarios(): Promise<UsuarioEquipo[]> {
  const { data } = await api.get<UsuarioEquipo[]>('/usuarios')
  return data
}

export async function crearUsuario(dto: NuevoUsuario): Promise<UsuarioEquipo> {
  const { data } = await api.post<UsuarioEquipo>('/usuarios', dto)
  return data
}
