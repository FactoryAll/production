#!/usr/bin/env bash
# Готовит .env.dev для дев-стенда: пароль базы генерируется заново.
#
# Зачем скрипт, а не «скопируйте из прода»:
#   1. Значения из продового .env — продовые секреты, им нечего делать в дев-базе и в чате.
#   2. DATABASE_URL обязан содержать тот же пароль, что и POSTGRES_PASSWORD; вписывать его
#      руками в два места — верный способ получить «password authentication failed» при первом
#      же запуске. Скрипт делает это одной заменой.
#   3. Пароль НЕ печатается: вывод этого скрипта пересылают в чат, а секрет в чате — утечка.
#
# Использование (на сервере, из каталога репозитория):
#   bash scripts/make-dev-env.sh            # .env.dev — дев-стенд
#   bash scripts/make-dev-env.sh --fix      # .env.fix — фикс-стенд
#   bash scripts/make-dev-env.sh --force    # пересоздать (старые значения будут потеряны)

set -euo pipefail

APP_DIR="${PRODTRACK_DIR:-/opt/prodtrack}"
# Стенд выбирается флагом: по умолчанию дев, с --fix — фикс-стенд (docs/branching_model.md).
STAND_SUFFIX="dev"
FORCE=0
for raw in "$@"; do
  case "${raw}" in
    --fix) STAND_SUFFIX="fix" ;;
  esac
done
TARGET="${APP_DIR}/.env.${STAND_SUFFIX}"
EXAMPLE="${APP_DIR}/.env.${STAND_SUFFIX}.example"

for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=1 ;;
    --fix) ;;
    -h|--help)
      awk '/^#!/ { next } f && !/^#/ { exit } /^#/ { sub(/^# ?/, ""); print; f=1 }' "$0"
      exit 0
      ;;
    *) echo "Неизвестный аргумент: ${arg}" >&2; echo "Допустимо: --fix, --force, --help" >&2; exit 2 ;;
  esac
done

if [ ! -f "${EXAMPLE}" ]; then
  echo "ОТКАЗ: нет ${EXAMPLE} — обновите репозиторий (git pull origin main)." >&2
  exit 1
fi

if [ -f "${TARGET}" ] && [ "${FORCE}" != "1" ]; then
  echo "ОТКАЗ: ${TARGET} уже существует — не перезаписываю."
  echo "       Пересоздать с новыми секретами: bash scripts/make-dev-env.sh --force"
  exit 1
fi

command -v openssl >/dev/null 2>&1 || { echo "ОТКАЗ: нужен openssl (apt-get install openssl)." >&2; exit 1; }

# Пароль: hex — без символов, которые придётся экранировать в DATABASE_URL.
# Секрета сессий здесь нет: сессия — случайный токен, который лежит в базе (см. lib/auth/session.ts),
# подписи на секрете нет. Прежний SECRET_KEY в шаблонах был ложным требованием (аудит 03.11.2026).
DB_PASS="$(openssl rand -hex 24)"

cp "${EXAMPLE}" "${TARGET}"

# Одной заменой закрываем оба места: POSTGRES_PASSWORD и пароль внутри DATABASE_URL.
# Заглушка зависит от стенда: в .env.dev.example — change_me_in_dev, в .env.fix.example —
# change_me_in_fix. Раньше здесь была только девовая строка, и фикс-стенд молча оставался
# с заглушкой (найдено при проверке 03.11.2026).
sed -i -E "s#change_me_in_(dev|fix)#${DB_PASS}#g" "${TARGET}"

chmod 600 "${TARGET}"

echo "Готово: ${TARGET}"
echo "  пароль базы: ${#DB_PASS} символов (подставлен и в DATABASE_URL)"
echo "  файл: права 600"
echo
echo "Значения намеренно не печатаю: вывод этого скрипта пересылают в чат."
echo "Посмотреть позже на сервере:  sudo cat ${TARGET}   (только на самом сервере, не в чате)"
echo
echo "Дальше:"
COMPOSE_FILE="docker-compose.${STAND_SUFFIX}.yml"
STAND_FLAG="--${STAND_SUFFIX}"
echo "  cd ${APP_DIR} && docker compose -f ${COMPOSE_FILE} build"
echo "  docker compose -f ${COMPOSE_FILE} up -d"
echo "  bash scripts/postdeploy-check.sh ${STAND_FLAG}"
