#!/usr/bin/env bash
# Поднимает версию в compose-файлах и примерах окружения.
#
# Зачем скрипт: руками это уже ломалось. В compose у сборки `args` — отображение
# (`VERSION: vX`), а в `environment` — список (`- VERSION=vX`). Если заменить одно на другое,
# YAML перестаёт видеть args как отображение, и сборка падает с «must be a mapping»
# (случилось 26.10.2026 при переходе на v2.2.4: сломались дев и фикс, прод уцелел).
#
# Использование: bash scripts/bump-version.sh v2.2.5
set -euo pipefail

NEW="${1:-}"
if [ -z "${NEW}" ]; then
  echo "Укажите версию, например: bash scripts/bump-version.sh v2.2.5" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

for stand in prod dev fix; do
  case "${stand}" in
    prod) file="docker-compose.yml"; suffix="" ;;
    dev)  file="docker-compose.dev.yml"; suffix="-dev" ;;
    fix)  file="docker-compose.fix.yml"; suffix="-fix" ;;
  esac
  python3 - "${file}" "${NEW}${suffix}" <<'PY'
import re, sys
path, version = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
# args: `VERSION: <...>` — двоеточие; environment: `- VERSION=<...>` — равно.
text = re.sub(r'(VERSION:\s*)v[0-9A-Za-z.\-]+', r'\g<1>' + version, text)
text = re.sub(r'(- VERSION=)v[0-9A-Za-z.\-]+', r'\g<1>' + version, text)
open(path, 'w', encoding='utf-8').write(text)
PY
  echo "${file} → ${NEW}${suffix}"
done

for file in .env.example .env.dev.example .env.fix.example; do
  case "${file}" in
    .env.example) version="${NEW}" ;;
    .env.dev.example) version="${NEW}-dev" ;;
    .env.fix.example) version="${NEW}-fix" ;;
  esac
  python3 - "${file}" "${version}" <<'PY'
import re, sys
path, version = sys.argv[1], sys.argv[2]
text = open(path, encoding='utf-8').read()
text = re.sub(r'^(VERSION=)v[0-9A-Za-z.\-]+', r'\g<1>' + version, text, flags=re.M)
open(path, 'w', encoding='utf-8').write(text)
PY
  echo "${file} → ${version}"
done

# Проверка: compose обязан остаться валидным, а args — отображением.
python3 - <<'PY'
import sys, yaml
for path in ['docker-compose.yml', 'docker-compose.dev.yml', 'docker-compose.fix.yml']:
    data = yaml.safe_load(open(path, encoding='utf-8'))
    args = data['services']['web']['build']['args']
    assert isinstance(args, dict), f'{path}: args должен быть отображением'
    print(f'{path}: args = {args}')
PY
