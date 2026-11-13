# Backup image (spec 12.1 / 12.4): pg_dump | gzip | rclone crypt → Cloudflare R2, every night.
# pg_dump 16 comes with the postgres image and rclone from its official image: no package mirror needed.
FROM rclone/rclone:1.69 AS rclone

FROM postgres:16-alpine
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY backup.sh restore.sh rclone-env.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENV TZ=America/Montevideo BACKUP_TIME=03:30 KEEP_DAILY=14 KEEP_WEEKLY=8
USER postgres
ENTRYPOINT []
CMD ["backup.sh", "daemon"]
