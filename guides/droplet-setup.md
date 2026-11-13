# Alta del servidor (Droplet de DigitalOcean)

Guía para dejar la plataforma andando en producción (especificación, secciones 4 y 12). Se hace una vez;
después cada versión se publica sola al empujar un tag (`guides/release-process.md`).

Resultado: un Droplet con Docker Compose que corre Caddy (HTTPS), la web, la API, PostgreSQL y el backup
nocturno cifrado a Cloudflare R2. Costo inicial ≈ USD 16/mes (sección 4.1).

> Nada de lo que aparece acá como `CHANGE_ME` o similar va al repositorio. Las claves viven solo en el
> servidor, en los secretos de GitHub y en el gestor de contraseñas del dueño.

## 1. Crear el Droplet

- **Imagen:** Ubuntu 24.04 LTS (x64).
- **Plan:** Basic Regular, 1 vCPU, 2 GB RAM, 50 GB SSD (USD 12).
- **Región:** **NYC1 o NYC3**: DigitalOcean no tiene región en Sudamérica y estas son las de menor latencia
  desde Uruguay (4.4). Las imágenes y estáticos se sirven desde Cloudflare.
- **Autenticación:** solo **clave SSH** (sin contraseña).
- **Backups semanales de DigitalOcean:** activados (+20 %, USD 2,40). Son la segunda capa, además del backup
  nocturno a R2.
- Opcional: Firewall de DigitalOcean con entrada solo en 22, 80 y 443 (TCP) y 443 (UDP, HTTP/3).

## 2. Preparar el servidor

Conectarse como `root` una sola vez para crear el usuario de trabajo:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
```

```bash
# SSH solo con clave y sin root
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/; s/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

Desde acá, siempre como `deploy`:

```bash
# Firewall: 22, 80 y 443 (y 443/udp para HTTP/3)
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable
```

```bash
# Actualizaciones de seguridad automáticas
sudo apt-get update && sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

```bash
# 2 GB de swap (los límites de memoria del compose cuentan con ella)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf && sudo sysctl --system
```

```bash
# Docker Engine + plugin compose (repositorio oficial de Docker)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
```

Cerrar la sesión y volver a entrar para que tome el grupo `docker`.

## 3. Carpeta de la plataforma

```bash
sudo mkdir -p /opt/inmo-uy && sudo chown deploy:deploy /opt/inmo-uy && cd /opt/inmo-uy
```

Copiar desde el repositorio (o dejar que el primer release los copie): `docker-compose.prod.yml`,
`deploy/Caddyfile` → `Caddyfile`, `deploy/deploy.sh` → `deploy.sh`. Crear los archivos de configuración a
partir de los ejemplos de `deploy/`:

| Archivo en el servidor | Ejemplo | Contenido |
|---|---|---|
| `.env` | `deploy/env.example` | `PLATFORM_DOMAIN`, `ACME_EMAIL`, `GHCR_OWNER` |
| `.env.api` | `deploy/api.env.example` | base de datos, JWT, email, R2, geocodificación, módulos |
| `.env.web` | `deploy/web.env.example` | casi nada: lo público se compila en la imagen |
| `.env.db` | `deploy/db.env.example` | usuario y contraseña de PostgreSQL |
| `.env.backup` | `deploy/backup.env.example` | R2 de backups y **clave de cifrado** |

```bash
chmod 600 .env*
```

- `POSTGRES_PASSWORD`, `JWT_SECRET` y `BACKUP_ENCRYPTION_KEY`: generarlos con `openssl rand -hex 32`.
- **Guardar `BACKUP_ENCRYPTION_KEY` también fuera del servidor** (gestor de contraseñas). Sin esa clave los
  backups no se pueden leer, aunque estén en R2.
- La misma contraseña de la base va en `.env.db`, en `DATABASE_URL` (`.env.api`) y en `PGPASSWORD`
  (`.env.backup`).

## 4. Cloudflare

1. **DNS de la plataforma** (`PLATFORM_DOMAIN`, por ejemplo `plataforma.uy`):
   - `A  app.plataforma.uy  → IP del Droplet`
   - `A  *.plataforma.uy    → IP del Droplet` (los sitios `{slug}.plataforma.uy`)
   - `A  plataforma.uy      → IP del Droplet` (opcional, portada de la plataforma)
   Estos registros van en **"DNS only" (nube gris)**: el HTTPS lo emite Caddy en el servidor. Si Cloudflare
   hiciera de proxy, el certificado bajo demanda no se podría validar.
2. **R2:** dos buckets.
   - Uno para fotos y documentos (`R2_BUCKET_NAME`), con dominio público detrás de Cloudflare para las fotos
     (`R2_PUBLIC_URL`, por ejemplo `https://img.plataforma.uy`, este sí con proxy/CDN).
   - Otro solo para backups (`BACKUP_R2_BUCKET`), sin acceso público y con un token de API limitado a ese bucket.

## 5. GitHub (una vez)

En el repositorio → *Settings* → *Secrets and variables* → *Actions*:

- **Variables:** `PLATFORM_DOMAIN` (ej. `plataforma.uy`) y, opcional, `PLATFORM_NAME`.
- **Secretos** (environment `production`):
  - `DEPLOY_HOST`: la IP del Droplet.
  - `DEPLOY_USER`: `deploy`.
  - `DEPLOY_SSH_KEY`: la clave privada de una clave **dedicada** a los deploys. Su pública va en
    `~deploy/.ssh/authorized_keys`.
  - `DEPLOY_KNOWN_HOSTS`: la salida de `ssh-keyscan IP_DEL_DROPLET`.
- Las imágenes se publican en GHCR (`ghcr.io/OWNER/inmo-uy-{api,web,backup}`). Si el repositorio es privado,
  en el servidor hace falta `docker login ghcr.io` con un token de solo lectura de paquetes.

Mientras `DEPLOY_HOST` no exista, el workflow de release publica las imágenes y saltea el deploy.

## 6. Primer deploy

Empujar un tag (lo hace el dueño, ver `guides/release-process.md`). El workflow `Release`:

1. verifica que el tag coincida con `appVersion` de los dos `package.json`;
2. construye las imágenes linux/amd64 y las publica con el tag y `latest`;
3. copia `docker-compose.prod.yml`, `Caddyfile` y `deploy.sh` al servidor y corre `./deploy.sh vX.Y.Z.W`;
4. `deploy.sh` levanta la versión nueva, espera que `/api/health` responda esa versión y, si no, **vuelve sola
   a la anterior**;
5. por último verifica desde afuera `https://app.PLATFORM_DOMAIN/api/health`.

A mano, en el servidor: `cd /opt/inmo-uy && ./deploy.sh v1.2.0.0`.
Volver a una versión anterior: `./deploy.sh v1.1.0.0`.

## 7. Dominio propio de una inmobiliaria

1. La inmobiliaria (o el administrador) lo carga en **Ajustes > Datos de la inmobiliaria > Dominio propio**.
2. En el DNS del dominio: `A @ → IP del Droplet` y `A www → IP del Droplet`. Si el dominio está en Cloudflare,
   en "DNS only".
3. En la primera visita, Caddy pregunta a la API (`/api/public/domain-check`) si el dominio es de una
   inmobiliaria activa y recién ahí pide el certificado. Los dominios que no están cargados no reciben
   certificado.

## 8. Monitoreo

- **Errores:** Sentry (`SENTRY_DSN` en `.env.api` y `NEXT_PUBLIC_SENTRY_DSN` en la variable del build).
- **Disponibilidad:** un chequeo externo gratuito (UptimeRobot, Better Stack, etc.) sobre
  `https://app.PLATFORM_DOMAIN/api/health`, cada 5 minutos.
- **Backups:** `BACKUP_HEALTHCHECK_URL` (por ejemplo healthchecks.io) avisa si una noche no hubo backup.
- **Disco:** alerta de DigitalOcean (*Monitoring → Create alert policy*) con disco > 80 % y RAM > 75 %.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api`. Rotan solos (10 MB × 5 por contenedor).

## 9. Cuándo agrandar (4.3)

- **Cuándo:** RAM usada > 75 % sostenida, p95 de la API > 500 ms o CPU > 70 % en horario laboral.
- **Primer paso:** *Resize* a 4 GB / 2 vCPU **sin agrandar el disco**, así se puede volver atrás. Todo es
  stateless salvo la base, que vive en el volumen `pg_data` del mismo disco. Después de agrandar, subir los
  límites de memoria del compose.
- **Siguiente paso:** PostgreSQL en un Droplet aparte o en DO Managed PostgreSQL, cambiando solo `DATABASE_URL`.
