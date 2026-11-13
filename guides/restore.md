# Backups y restauración

Especificación, secciones 3.1 y 12.4. Hay dos capas:

1. **Backup nocturno cifrado en Cloudflare R2.** Lo hace el contenedor `backup` (`deploy/backup/`):
   - todas las noches a las 03:30 de Montevideo (`BACKUP_TIME`) corre `pg_dump`, lo comprime con gzip, lo cifra
     con `rclone crypt` y lo sube a R2;
   - guarda **14 diarios** (`daily/`) y **8 semanales**, los domingos (`weekly/`);
   - un backup que falla nunca reemplaza ni borra uno bueno: se sube con nombre temporal y recién al terminar
     bien pasa a `daily/`.
2. **Backups semanales de DigitalOcean**, con una copia completa del Droplet.

> El contenido en R2 está cifrado (los archivos empiezan con `RCLONE` y no se pueden leer sin la clave). La
> clave `BACKUP_ENCRYPTION_KEY` tiene que estar **también fuera del servidor**: si el servidor se pierde, sin la
> clave no hay restauración.

## Ver qué backups hay

En el servidor:

```bash
cd /opt/inmo-uy && docker compose -f docker-compose.prod.yml exec backup restore.sh list
```

## Forzar un backup ahora (antes de un cambio grande)

```bash
docker compose -f docker-compose.prod.yml exec backup backup.sh now
```

## Restaurar

`restore.sh` siempre restaura en la base que se le indica en `RESTORE_DATABASE_URL`, que **tiene que estar
vacía**. Nunca escribe sobre la base de producción por su cuenta.

### A. Prueba mensual (sin tocar producción)

1. Levantar un PostgreSQL descartable en el mismo servidor:

   ```bash
   docker run -d --name restore-pg -e POSTGRES_PASSWORD=restore -p 127.0.0.1:5544:5432 postgres:16-alpine
   ```

2. Restaurar el último backup en esa base:

   ```bash
   docker run --rm --network host --env-file .env.backup \
     -e RESTORE_DATABASE_URL=postgresql://postgres:restore@127.0.0.1:5544/postgres \
     ghcr.io/OWNER/inmo-uy-backup:latest restore.sh latest
   ```

3. Comparar con producción (cantidad de inmobiliarias, propiedades, clientes):

   ```bash
   for q in Organization Property Client; do
     echo "$q: prod=$(docker compose -f docker-compose.prod.yml exec -T db psql -U inmo -d inmo -tAc "select count(*) from \"$q\"") restaurado=$(docker exec restore-pg psql -U postgres -tAc "select count(*) from \"$q\"")"
   done
   ```

4. Opcional: levantar la API contra la base restaurada y ver que `/api/health` diga `"db":"connected"` y que
   las migraciones estén al día.
5. Borrar la base de prueba (`docker rm -f restore-pg`) y anotar el resultado en la tabla de abajo.

Las diferencias chicas son normales: la copia es de anoche y producción siguió trabajando.

### B. Recuperar producción (servidor nuevo o base dañada)

1. Preparar el servidor según `guides/droplet-setup.md`, con los mismos `.env*`, y sobre todo la misma
   `BACKUP_ENCRYPTION_KEY`.
2. Levantar **solo** la base: `TAG=vX docker compose -f docker-compose.prod.yml up -d db`.
3. Restaurar en ella:

   ```bash
   docker run --rm --network inmo-uy_default --env-file .env.backup \
     -e RESTORE_DATABASE_URL=postgresql://inmo:CONTRASEÑA@db:5432/inmo \
     ghcr.io/OWNER/inmo-uy-backup:vX restore.sh latest
   ```

   Para una fecha en particular se usa `restore.sh daily/inmo-2026-11-13_033000.sql.gz` (o `weekly/...`), con
   el nombre que muestra `restore.sh list`.
4. Levantar el resto: `./deploy.sh vX`. La API aplica las migraciones que falten al arrancar.
5. Revisar que entren el panel y un sitio de inmobiliaria.

Las fotos y documentos no están en este backup: viven en el bucket de R2 de archivos. Si no hay R2 configurado,
están en la base (tabla `UploadedFile`) y se restauran con ella.

## Registro de pruebas de restauración

| Fecha | Quién | Backup usado | Resultado |
|---|---|---|---|
| 2026-11-13 | Claude (fase F4, entorno de prueba) | `daily/` recién generado por el contenedor `backup` del stack de producción levantado en local; destino: un R2 simulado con una carpeta local | ✅ Restaurado en un PostgreSQL 16 limpio: mismas cantidades de inmobiliarias, usuarios, propiedades, precios, clientes y migraciones; la API arrancó contra la base restaurada con las migraciones al día. Con una clave incorrecta, la restauración falla («bad password»). |
