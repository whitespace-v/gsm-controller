#!/usr/bin/bash

# Получаем список всех ttyUSB-устройств
devices=(/dev/ttyUSB*)

# Проверяем, есть ли вообще такие устройства
if [[ ! -e "${devices[0]}" ]]; then
  echo "Устройства /dev/ttyUSB* не найдены."
  exit 0
fi

echo "Список /dev/ttyUSB* устройств и их статус:"
printf "%-15s %s\n" "Устройство" "Статус"
echo "-------------------------------"

for dev in "${devices[@]}"; do
  if lsof "$dev" &>/dev/null; then
    # Если lsof нашёл процесс, использующий устройство
    status="ACTIVE"
  else
    status="free"
  fi
  printf "%-15s %s\n" "$(basename "$dev")" "$status"
done
