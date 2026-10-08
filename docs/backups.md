# Copias de seguridad

La base de datos es lo único irrecuperable: este documento describe qué se
copia, dónde, cada cuánto y cómo se restaura. Todo lo de aquí está
**ejecutado**, no es checklist.

> Medido el 2026-10-08 en local (PostgreSQL 16 en Docker, BD de pruebas con
> 4658 filas de auditoría): volcado de **408 KB**, restauración en **2,9 s**,
> simulacro completo en **3,7 s**. El RTO crece con el tamaño: hay que
> re-medirlo cuando la base crezca.

---

## 1. Qué se copia (y qué no)

- `npm run db:backup` vuelca la base de `DATABASE_URL` con
  `pg_dump --format=custom` (comprimido, restaurable con `pg_restore`).
- El volcado **incluye `_prisma_migrations`**: sin esa tabla la restauración
  pierde el estado de migraciones y el siguiente `migrate deploy` se confunde.
  El backup lo verifica antes de darse por bueno (`pg_restore --list` debe
  mencionarla).
- Cada volcado lleva al lado un manifiesto `<volcado>.manifiesto.json`: fecha,
  tamaño, `sha256`, base de datos y última migración aplicada.
- **No** se copia: los archivos subidos (viven en Supabase Storage; ahí rigen
  sus backups + PITR) ni los secretos (nunca viajan en el volcado).
- En ningún log, nombre de archivo ni manifiesto aparece `DATABASE_URL`: solo
  el **nombre** de la base.

## 2. Dónde y retención

- Destino: `BACKUP_DIR` (por defecto `backend/backups/`).
- Nombre: `<base>-AAAAMMDD-HHMMSS.dump` (UTC, sin `:` para que valga en Windows).
- Retención: `BACKUP_RETENCION_DIAS` (por defecto 14). Al terminar cada backup
  se borran los volcados más antiguos **con su manifiesto** y se informa de
  qué se borró.
- `backups/` está en `.gitignore`: un volcado **nunca** entra al repositorio.

## 3. Comandos

```bash
cd backend
npm run db:backup             # vuelca DATABASE_URL (en dev viene de .env)
npm run db:restaurar -- --archivo <volcado> --destino <bd> --confirmo-restauracion
npm run db:prueba-restauracion  # simulacro completo (ver §5)
```

Variables (sin valores por defecto: si falta una, el script falla):

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | siempre | Origen del backup; servidor del destino |
| `BACKUP_DIR` | no (`./backups`) | Dónde quedan los volcados |
| `BACKUP_RETENCION_DIAS` | no (14) | Días de retención |
| `PG_DOCKER_CONTAINER` | no (`dental-saas-test`) | Contenedor para `docker exec` |
| `PG_DUMP_BIN` + `PG_RESTORE_BIN` | juntos o ninguno | Binarios locales (CI, servidores con cliente) |

Sin Docker (producción/Supabase) se usan los binarios locales contra la URL
directa; en local se ejecutan dentro del contenedor y el archivo se trae con
`docker cp`.

## 4. Frecuencia sugerida (RPO)

Diaria de madrugada + antes de cada migración o despliegue con migraciones.
El RPO es la frecuencia: con backup diario se pierde como máximo un día.

Cron (servidor Linux):

```cron
0 3 * * * cd /opt/dental-saas/backend && DATABASE_URL="$DATABASE_URL" npm run db:backup >> /var/log/dental-backup.log 2>&1
```

Tarea programada (Windows, PowerShell semanal + pre-despliegue manual):

```powershell
$Action = New-ScheduledTaskAction -Execute "npm" -Argument "run db:backup" -WorkingDirectory "E:\SAAS\backend"
$Trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "DentalBackup" -Action $Action -Trigger $Trigger
```

Responsable y alertas: el cron debe avisar si el comando sale != 0 (el script
falla en voz alta a propósito).

## 5. Restauración paso a paso (RTO)

1. Elegir el volcado (`ls` por fecha en `BACKUP_DIR`, comprobar su manifiesto).
2. Restaurar en una base de usar y tirar y **comparar antes de tocar nada**:
   `npm run db:restaurar -- --archivo <volcado> --destino revision --confirmo-restauracion`
   (imprime recuentos por tabla para comparar con producción).
3. Ventana de corte: congelar escritura (parar la API o poner mantenimiento).
4. Restaurar en la base definitiva (vacía o nueva) con el mismo comando.
5. `npx prisma migrate deploy` (no-op si el volcado traía las migraciones),
   rearrange DNS / apuntar la API, smoke (`npm run smoke:arranque`).
6. El script **se niega** a restaurar sobre la base de `DATABASE_URL` y a
   destinos no vacíos; no hay `--clean` sin guarda.

RTO medido: **2,9 s** de `pg_restore` en la base de pruebas. Súmale descarga
del volcado + verificación + corte: en la práctica, minutos, no horas.

## 6. El simulacro (obligatorio en CI)

`npm run db:prueba-restauracion` vuelca, restaura en una base temporal que él
mismo crea y elimina, y **compara fila por fila** (Tenant, User, Paciente,
Cita, Pago, Insumo, Compra, Auditoria + última migración). Falla si algo no
coincide —incluido a propósito en el pipeline para que un backup roto no se
fusione en silencio— y avisa si la base estaba vacía (mecánica verificada,
contenido no exigible).

## 7. Migración de la clínica

`scripts/migrar-clinica.ts` exige `--backup-verificado <ruta>`: pásale el
manifiesto (o el volcado) del backup que acabas de comprobar con el simulacro.
