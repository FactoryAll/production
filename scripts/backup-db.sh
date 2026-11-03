#!/usr/bin/env bash
# Резервная копия базы ProdTrack (ОПЭ-33, решение владельца 23.10.2026).
#
# Зачем: до этого копий не делалось вовсе. Перед деплоем полагалось «снять дамп руками»,
# и это правило жило только в инструкции — то есть не выполнялось.
#
# Использование (на сервере, из каталога репозитория):
#   bash scripts/backup-db.sh              # прод
#   bash scripts/backup-db.sh --dev        # дев-стенд
#   bash scripts/backup-db.sh --fix        # фикс-стенд
#   BACKUP_KEEP=30 bash scripts/backup-db.sh   # хранить 30 копий вместо 14
#
# Копия кладётся ВНЕ репозитория (/var/backups/prodtrack по умолчанию): её не должно
# унести ни `git clean`, ни пересоздание контейнера. Путь переопределяется BACKUP_DIR.
#
# Что проверяется после снятия: файл не пустой и gzip целый. Пустой дамп — это не копия,
# и молча оставлять его нельзя: при откате им нечего будет восстанавливать.

set -euo pipefail

APP_DIR="${PRODTRACK_DIR:-/opt/prodtrack}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/prodtrack}"
KEEP="${BACKUP_KEEP:-14}"

STAND="prod"
COMPOSE=(docker compose)
case "${1:-}" in
  "") ;;
  --dev)
    STAND="dev"
    COMPOSE=(docker compose -f docker-compose.dev.yml)
    ;;
  --fix)
    STAND="fix"
    COMPOSE=(docker compose -f docker-compose.fix.yml)
    ;;
  *)
    echo "Неизвестный аргумент: $1" >&2
    echo "Допустимо: --dev, --fix (без аргумента — прод)" >&2
    exit 2
    ;;
esac

cd "${APP_DIR}" || { echo "Нет каталога ${APP_DIR}" >&2; exit 1; }
mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/prodtrack-${STAND}-${STAMP}.sql.gz"

# pg_dump через контейнер: снаружи сервера нет ни клиента нужной версии, ни пароля.
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "${FILE}"

if [ ! -s "${FILE}" ]; then
  echo "ОТКАЗ: дамп пустой (${FILE}) — копия не создана." >&2
  rm -f "${FILE}"
  exit 1
fi
if ! gzip -t "${FILE}" 2>/dev/null; then
  echo "ОТКАЗ: дамп повреждён (${FILE}) — копия не создана." >&2
  rm -f "${FILE}"
  exit 1
fi

# Ротация: держим последние KEEP копий этого стенда, остальные удаляем.
ls -1t "${BACKUP_DIR}"/prodtrack-"${STAND}"-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

COUNT="$(ls -1 "${BACKUP_DIR}"/prodtrack-"${STAND}"-*.sql.gz 2>/dev/null | wc -l)"
echo "Копия снята: ${FILE}"
echo "  размер: $(du -h "${FILE}" | cut -f1), проверка gzip: ок"
echo "  копий стенда ${STAND} в ${BACKUP_DIR}: ${COUNT} (хранится последних ${KEEP})"

# Возраст предыдущей копии — дешёвая защита от молча сломавшегося cron.
# Скрипт не падает (копия снята), но говорит громко: «предыдущая копия была сутки назад»
# означает, что расписание не работало и об этом никто не знал.
PREVIOUS="$(ls -1t "${BACKUP_DIR}"/prodtrack-"${STAND}"-*.sql.gz 2>/dev/null | sed -n '2p' || true)"
if [ -n "${PREVIOUS}" ]; then
  PREV_AGE_HOURS=$(( ( $(date +%s) - $(date -r "${PREVIOUS}" +%s) ) / 3600 ))
  if [ "${PREV_AGE_HOURS}" -gt 24 ]; then
    echo "ВНИМАНИЕ: предыдущая копия стенда ${STAND} старше суток (${PREV_AGE_HOURS} ч): ${PREVIOUS}" >&2
    echo "          Похоже, расписание (cron) не работало. Проверьте: crontab -l и /var/log/prodtrack-backup.log" >&2
  fi
else
  echo "  предыдущих копий стенда ${STAND} нет — это первая."
fi
