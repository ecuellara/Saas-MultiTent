# Copias de seguridad

La base de datos y los archivos subidos son lo irrecuperable: este documento
describe qué se copia, dónde, cada cuánto y cómo se restaura. Todo lo de aquí
está **ejecutado**, no es checklist.

> Medido el 2026-10-08 en local (PostgreSQL 16 en Docker, BD de pruebas con
> 4658 filas de auditoría): volcado de **408 KB**, restauración en **2,9 s**,
> simulacro completo en **3,7 s**. Archivos (6 ficheros, 111 KB):
> paquete de **112 KB**, restauración en **0,1 s**. El RTO crece con el tamaño:
> hay que re-medirlo cuando los datos crezcan.

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
- **No** se copian los secretos: nunca viajan en el volcado.
- En ningún log, nombre de archivo ni manifiesto aparece `DATABASE_URL`: solo
  el **nombre** de la base.
- Los **archivos subidos** tienen su propio respaldo (ver §8): mismo
  directorio, paquete `archivos-*.tar.gz` con el mismo árbol
  `tenants/{tenantId}/...`.

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

---

## 8. Archivos subidos (`uploads/`)

Hoy viven en **disco local** (`StorageService` → `uploads/`, configurable con
`UPLOADS_DIR`), no en almacenamiento de objetos: este respaldo es su única
copia hasta que se migren a un bucket (sigue siendo la opción estratégica;
ver deuda nº 13).

```bash
cd backend
npm run archivos:backup               # empaqueta UPLOADS_DIR en BACKUP_DIR
npm run archivos:restaurar -- --archivo <paquete> --destino <dir> --confirmo-restauracion
npm run archivos:prueba-restauracion  # simulacro hermético (ver abajo)
```

- Paquete `archivos-AAAAMMDD-HHMMSS.tar.gz` con **exactamente** el árbol
  `tenants/{tenantId}/...` (el mismo que espera la aplicación y la migración).
- Verificación antes de darlo por bueno: `tar -tzf` debe listar el mismo
  conjunto de ficheros empaquetado; el paquete defectuoso se elimina.
- Manifiesto `<paquete>.manifiesto.json`: fecha, bytes, sha256, número de
  ficheros, bytes sumados y **número de ficheros por tenant** (conteos, nunca
  nombres ni rutas: nada de datos de pacientes).
- Si no hay ficheros, **falla** (salvo `PERMITIR_SIMULACRO_VACIO=1`).
- Retención con `BACKUP_RETENCION_DIAS`, igual que la base.
- La restauración se niega si el destino es el `UPLOADS_DIR` en uso (o lo
  solapa) y si ya tiene ficheros (salvo `--permitir-merge`); al terminar
  informa ficheros y bytes.
- Frecuencia: la misma que la base (mismo cron); el RPO es el mismo.

**Simulacro hermético** (también en CI): crea fixtures binarios en un temporal
propio, empaqueta, extrae en un directorio limpio y compara **sha256 por
fichero** + bytes + conteos del manifiesto. Nunca toca el `uploads/` real y lo
borra todo al terminar, pase o falle.

---

## 9. Respaldo externo (deuda nº 14)

TODO lo anterior queda en `BACKUP_DIR`, en la misma máquina que protege: si
muere el host (o el disco), se pierden los datos y las copias a la vez.
`npm run db:backup-remoto` copia los 4 artefactos más recientes (volcado,
paquete y sus dos manifiestos) a `RESPALDO_REMOTO`, **y verifica la copia
contra el `sha256` del manifiesto**. Sin verificación no hay copia: si el
remoto no coincide, el script falla con código != 0.

```bash
cd backend
RESPALDO_REMOTO="D:\respaldos" npm run db:backup-remoto
npm run db:backup-remoto -- --verificar   # solo comprueba lo que ya hay fuera
npm run db:prueba-respaldo-remoto         # simulacro de la cadena (ver abajo)
```

Variables (sin valores por defecto donde importa: si falta una, falla):

| Variable | Obligatoria | Para qué |
|---|---|---|
| `RESPALDO_REMOTO` | **siempre** | Destino externo. Sin ella el script FALLA (una copia "externa" que no sale de la máquina es peor que no tenerla) |
| `BACKUP_DIR` | no (`./backups`) | De dónde salen los artefactos |
| `BACKUP_RETENCION_DIAS` | no (14) | Retención también en el destino (por sello del nombre; solo toca nuestros 4 patrones) |
| `VIGILANCIA_MAX_HORAS_REMOTO` | no (48) | Umbral de `npm run vigilancia` para la copia externa más reciente |

### 9.1 Modos (los decide la forma del destino)

- **Ruta local o disco montado** (`D:\respaldos`, `/mnt/respaldos`, `\\nas\copias`):
  copia con node y verifica por `sha256`. Vale para probar sin nada externo
  y para un disco/NAS montado en el servidor.
- **Remoto `rclone`** (`b2:bucket/dental-saas`): copia con `rclone copy` y
  verifica descargando por `rclone cat` + hash (independiente del backend:
  no se fía del hash que reporte el proveedor). Requiere el binario
  (`rclone config` antes, con el nombre que uses aquí); **si falta, falla**
  en lugar de fingir la copia en local.

Nunca se imprime `DATABASE_URL` (el script ni siquiera la lee) ni credenciales.

### 9.2 Restaurar desde el destino

1. Elige el volcado en el destino y **compruébalo primero**:
   `npm run db:backup-remoto -- --verificar` (con `RESPALDO_REMOTO` apuntando
   al destino).
2. Destino local: restaura directamente de ahí
   (`npm run db:restaurar -- --archivo <destino>/<volcado> --destino <bd> --confirmo-restauracion`,
   y lo mismo con `archivos:restaurar` para el paquete).
3. Destino `rclone`: trae primero los 4 ficheros
   (`rclone copy <remoto>:<dir>/ ./traidos/`) y sigue en el paso 2. La prueba
   de que la copia externa sirve es restaurar DESDE ella, no el `copy` en verde.

### 9.3 RPO real

Local diario 03:00/03:30 + copia externa 04:00 (timers §5 de `despliegue.md`):
un dato escrito a las 04:01 se vuelca a las 03:00 del día siguiente y sale
fuera a las 04:00. **RPO fuera del servidor ≈ 24 h** (el local, el mismo; la
copia añade ~1 h de rezago, no un día más).

### 9.4 Programación y vigilancia

- Timer `dental-saas-backup-remoto` (04:00, `Persistent=true`, `OnFailure`
  como los demás): copia lo último que dejaron los dos respaldos. Si un
  respaldo local falló, copia lo del día anterior (verificado igual); que eso
  no pase desapercibido lo cubre la vigilancia.
- `npm run vigilancia` informa la antigüedad de la copia externa más reciente
  y sale != 0 si supera `VIGILANCIA_MAX_HORAS_REMOTO` (48 h) o si no hay
  destino configurado. En destinos `rclone` exige el binario para comprobar;
  sin él informa "revisar" (no comprobable ≠ correcto).

### 9.5 El simulacro del respaldo externo (obligatorio en CI)

`npm run db:prueba-respaldo-remoto` prueba la CADENA, con destino temporal
(sin nada externo):

1. Vuelca la base y empaqueta fixtures de archivos de verdad.
2. Copia al destino externo temporal.
3. **Corrompe la copia remota y exige que la verificación la rechace** (si la
   aceptara, el simulacro falla: existir no es verificar).
4. **Borra `BACKUP_DIR`** (el host "muere") y restaura la base DESDE LA COPIA
   EXTERNA comparando recuentos + última migración, como `prueba-restauracion`.
5. Extrae el paquete DESDE LA COPIA EXTERNA comparando el mapa de sha256.
6. Limpia la base temporal y los temporales, pase o falle.

Falla con la base origen vacía (salvo `PERMITIR_SIMULACRO_VACIO=1`), igual que
el simulacro local: una comparación que no compara nada no prueba nada.
