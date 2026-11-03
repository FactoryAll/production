#!/usr/bin/env bash
# Выгрузка резервной копии базы ЗА ПРЕДЕЛЫ сервера (после потери VPS 03.11.2026).
#
# Зачем: до 03.11.2026 копии лежали в /var/backups/prodtrack на том же диске, где и база,
# и погибли вместе с сервером. Скрипт backup-db.sh снимает дамп правильно, но «вне сервера»
# было советом в документе, а не действием. Здесь — действие.
#
# Использование (на сервере, из каталога репозитория):
#   bash scripts/backup-offsite.sh                 # выгрузить САМЫЙ СВЕЖИЙ дамп прода
#   bash scripts/backup-offsite.sh --dev           # дев-стенд
#   bash scripts/backup-offsite.sh --fix           # фикс-стенд
#   bash scripts/backup-offsite.sh --file /path/to/dump.sql.gz   # конкретный файл
#
# Куда выгружать — задаётся переменными окружения. Поддерживаются два транспорта,
# можно включить оба (тогда делаются обе выгрузки):
#
#   1) rclone (объектное хранилище, диск в облаке, чужой провайдер):
#        export PRODTRACK_OFFSITE_RCLONE_REMOTE="prodtrack-s3:prodtrack-backups"
#        rclone config        # настроить remote заранее (см. docs/disaster_recovery.md §3.6)
#
#   2) scp на второй сервер:
#        export PRODTRACK_OFFSITE_SCP_TARGET="backup@backup.example.org:/srv/prodtrack-backups"
#
# Если не настроено НИ ОДНОГО транспорта, скрипт обязан сказать это громко и вернуть
# ненулевой код: молчаливая «успешная» выгрузка — худший вид лжи, потому что создаёт
# уверенность, что копия есть.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/prodtrack}"
RCLONE_REMOTE="${PRODTRACK_OFFSITE_RCLONE_REMOTE:-}"
SCP_TARGET="${PRODTRACK_OFFSITE_SCP_TARGET:-}"

STAND="prod"
FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) STAND="dev"; shift ;;
    --fix) STAND="fix"; shift ;;
    --file)
      FILE="${2:-}"
      if [ -z "${FILE}" ]; then
        echo "ОТКАЗ: --file без значения." >&2
        exit 2
      fi
      shift 2
      ;;
    *)
      echo "Неизвестный аргумент: $1" >&2
      echo "Допустимо: --dev, --fix, --file <путь> (без аргумента — прод)" >&2
      exit 2
      ;;
  esac
done

# Источник: явный файл или самый свежий дамп нужного стенда.
if [ -z "${FILE}" ]; then
  FILE="$(ls -1t "${BACKUP_DIR}"/prodtrack-"${STAND}"-*.sql.gz 2>/dev/null | head -1 || true)"
  if [ -z "${FILE}" ]; then
    echo "ОТКАЗ: в ${BACKUP_DIR} нет копий стенда ${STAND}." >&2
    echo "        Сначала: bash scripts/backup-db.sh $([ "${STAND}" = "prod" ] || echo "--${STAND}")" >&2
    exit 1
  fi
fi

if [ ! -s "${FILE}" ]; then
  echo "ОТКАЗ: файл ${FILE} отсутствует или пуст." >&2
  exit 1
fi
if ! gzip -t "${FILE}" 2>/dev/null; then
  echo "ОТКАЗ: файл ${FILE} повреждён (gzip -t не проходит) — выгружать нечего." >&2
  exit 1
fi

if [ -z "${RCLONE_REMOTE}" ] && [ -z "${SCP_TARGET}" ]; then
  echo "ОТКАЗ: КОПИЯ НЕ ВЫГРУЖЕНА — не настроен ни один транспорт." >&2
  echo "" >&2
  echo "  Копия на этом сервере погибнет вместе с ним (именно так случилось 03.11.2026)." >&2
  echo "  Настройте хотя бы одно и повторите:" >&2
  echo "    export PRODTRACK_OFFSITE_RCLONE_REMOTE=\"prodtrack-s3:prodtrack-backups\"" >&2
  echo "    export PRODTRACK_OFFSITE_SCP_TARGET=\"backup@backup.example.org:/srv/prodtrack-backups\"" >&2
  echo "" >&2
  echo "  Файл готов к выгрузке вручную: ${FILE}" >&2
  exit 3
fi

STATUS=0

if [ -n "${RCLONE_REMOTE}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "ОТКАЗ: задан PRODTRACK_OFFSITE_RCLONE_REMOTE, но rclone не установлен." >&2
    STATUS=4
  else
    echo "[offsite] rclone copy ${FILE} → ${RCLONE_REMOTE}"
    if rclone copy "${FILE}" "${RCLONE_REMOTE}" --no-traverse; then
      echo "[offsite] rclone: ок"
    else
      echo "ОТКАЗ: rclone завершился с ошибкой — копии в облаке нет." >&2
      STATUS=5
    fi
  fi
fi

if [ -n "${SCP_TARGET}" ]; then
  echo "[offsite] scp ${FILE} → ${SCP_TARGET}"
  if scp -q "${FILE}" "${SCP_TARGET}/"; then
    echo "[offsite] scp: ок"
  else
    echo "ОТКАЗ: scp завершился с ошибкой — копии на втором сервере нет." >&2
    STATUS=6
  fi
fi

if [ "${STATUS}" -ne 0 ]; then
  echo "" >&2
  echo "ИТОГ: выгрузка НЕ ПОЛНОСТЬЮ успешна (код ${STATUS}). Считайте, что копии вне сервера нет." >&2
  exit "${STATUS}"
fi

echo "ИТОГ: копия выгружена за пределы сервера (${FILE}, $(du -h "${FILE}" | cut -f1))."
