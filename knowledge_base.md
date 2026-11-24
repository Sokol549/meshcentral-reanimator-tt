# База знаний инфраструктуры розничных точек «Реаниматор ТТ»
# Версия: 4.1 (Полная энциклопедия диагностики, аварийного восстановления Windows и аптечной сети)

Данный документ автоматически встроен в системный контекст автономного ИИ-агента `ai-rescue.exe`. Содержит исчерпывающие правила, регламенты розничной сети (200+ аптек КЗВС / Юсова / Юг-Биосфера), таблицы кодов ошибок BSOD, загрузчика BCD, файловой системы, реестра, сетевого стека, кассового оборудования и служб Windows с готовыми командами восстановления в среде WinPE.

---

> [!IMPORTANT]
> **ПРАВИЛО ОПРЕДЕЛЕНИЯ БУКВ ДИСКОВ В СРЕДЕ WinPE:**
> - **Откуда в скриптах развертывания берется диск `W:`:**
>   Буква `W:` назначается исключительно в процессе чистой заливки системы через скрипт `deploy_image.cmd` (`W` = Windows, а `S` = System/ESP), чтобы гарантированно не конфликтовать с буквами флешки и виртуального RAM-диска `X:`.
> - **Буква диска при обычной аварийной загрузке в WinPE:**
>   При диагностике и ремонте существующей системы буквы `W:` в системе **нет**! Диск с установленной Windows чаще всего получает букву **`C:`** (или **`D:`**, если скрытый раздел загрузчика System Reserved занял букву `C:`).
> - **Как гарантированно определить реальную букву диска Windows в WinPE:**
>   Выполнить команду: `dir C:\Windows\System32\ntoskrnl.exe D:\Windows\System32\ntoskrnl.exe` (где файл обнаружен — тот диск и является системным), либо вызвать команду агента `check_disks_and_smart`.
> - **В командах ниже по умолчанию указана буква `C:`** — если в вашей системе Windows оказалась под буквой `D:`, просто замените `C:` на `D:`.

---

## 1. Общие сведения об инфраструктуре сети аптек
- **Масштаб:** 200+ территориально распределенных аптечных пунктов и ветеринарных центров.
- **Типовые конфигурации ОС:** Windows 8.1 Pro (x64), Windows 10 LTSC / Pro (x64), Windows 11 Pro.
- **Организации в сети:**
  - `ООО КЗВС`
  - `ИП Юсова ГИ`
  - `ООО Юг-Биосфера`
  - `ИП Юсов ВВ`
- **Серверы удаленного управления:**
  - **MeshCentral:** доступен через веб-интерфейс сервера (HTTPS/WSS).
  - **RustDesk:** корпоративный сервер удаленного доступа.
- **Локальные администраторы рабочих станций:**
  - `admin` (учетная запись локального администратора)

---

## 2. 1С:Предприятие 8.3 и специфика баз данных аптек

### 2.1. Расположение информационных баз 1С
- **Основной стандартный путь к базе (типовая конфигурация аптечной сети):**
  - **`C:\база розница\`** (на подавляющем большинстве рабочих станций кассиров)
  - **`D:\база розница\`** (на ПК с разделением на системный SSD и диск данных D:)
- **Альтернативные пути (встречаются на отдельных рабочих местах):**
  - `C:\база аптека\` / `D:\база аптека\`
  - `C:\Base1C\` / `D:\Base1C\`
  - `C:\Users\<User>\Documents\1C\Base\`
- **Как определить ТОЧНЫЙ путь к рабочей базе кассы, если он нестандартный:**
  1. Посмотреть файл списка баз `ibases.v8i`:
     ```cmd
     findstr /i "Connect=File" "C:\Users\*\AppData\Roaming\1C\1CEStart\ibases.v8i"
     ```
     *(Строка вида `Connect=File="C:\база розница";` указывает точный действующий каталог базы).*
  2. Если файл `ibases.v8i` поврежден — запустить сквозной поиск файла базы `1Cv8.1CD`:
     ```cmd
     dir /s /b C:\1Cv8.1CD D:\1Cv8.1CD
     ```
     *(Команда выведет абсолютные пути ко всем базам 1С на компьютере).*

### 2.2. Платформа и файлы конфигурации
- **Рабочая версия:** 1С:Предприятие 8.3 (релиз 8.3.27.1936 x64).
- **Пути к файлам платформы:**
  `C:\Program Files\1cv8\8.3.27.1936\bin\1cv8c.exe` (тонкий клиент)
  `C:\Program Files\1cv8\common\1cestart.exe` (универсальный стартер)
- **Файл списка информационных баз:**
  `C:\Users\<Имя_Пользователя>\AppData\Roaming\1C\1CEStart\ibases.v8i`
  *(В WinPE проверять всех пользователей в каталоге `Users`!).*
- **Программные лицензии 1С (КРИТИЧНО!):**
  Каталог файлов лицензий (`*.lic`): `C:\ProgramData\1C\licenses\` и `C:\Users\<User>\AppData\Local\1C\1Cv8\licenses\`.
  *Ни в коем случае не удалять файлы .lic при очистке диска! Всегда включать их в резервную копию.*

### 2.3. Аварийные файлы блокировок при сбоях и BSOD
- Основной файл базы: `1Cv8.1CD`.
- **Файлы блокировок при некорректном завершении / аварии / сбое питания:**
  Если после аварии 1С сообщает «Ошибка блокировки метаданных», «База заблокирована» или аварийно закрывается:
  - `1Cv8.cfl`
  - `1Cv8.1CL`
  - `1Cv8tmp.*`
  **Правило:** удаление этих временных файлов блокировок (но **НЕ** самого `1Cv8.1CD`!) полностью восстанавливает открытие базы.
- **Утилита проверки и восстановления поврежденных таблиц базы 1С:**
  `C:\Program Files\1cv8\8.3.27.1936\bin\chdbfl.exe` (запускается для исправления битых страниц `1Cv8.1CD`).

### 2.4. Очистка кэша 1С (причина 80% зависаний интерфейса кассира):
- Каталоги кэша:
  - `%LocalAppData%\1C\1cv8\<GUID-папки>`
  - `%AppData%\1C\1cv8\<GUID-папки>`
- Команда полной очистки кэша в WinPE (для диска `C:`):
  ```cmd
  for /d %p in ("C:\Users\*\AppData\Local\1C\1cv8\*") do @rd /s /q "%p"
  for /d %p in ("C:\Users\*\AppData\Roaming\1C\1cv8\*") do @if not "%~nxp"=="1CEStart" rd /s /q "%p"
  ```

---

## 3. Торговое и кассовое оборудование (ККТ, Сканеры, Эквайринг)

### 3.1. ККТ АТОЛ (Драйвер 10.x, АТОЛ 10.10.8.24)
- **Служба передачи данных в ОФД (Ethernet Over USB — EoU):**
  - Имя службы: `EoUService`
  - Исполняемый файл: `C:\Program Files (x86)\ATOL\Drivers10\KKT\bin\EoU\EthOverUsb.exe`
  - Файл конфигурации портов: `C:\Program Files (x86)\ATOL\Drivers10\KKT\bin\EoU\settings.xml`
- **Типовая проблема:** Касса не передает чеки в ОФД («Не передано ФД > 30 дней»).
  - *Причина:* Служба `EoUService` остановлена или изменился номер виртуального COM-порта в Диспетчере устройств после обновления Windows.
  - *Проверка:* сопоставить номер порта в `settings.xml` с реальным портом ККТ в ветке `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM`.

### 3.2. Сканеры штрихкода (2D DataMatrix)
- Подключение: USB VCOM (эмуляция COM-порта) или USB HID Keyboard.
- Драйвер: Atol USB-COM / STM Virtual COM Port.
- Компонента для 1С: `setup1c.exe` (внешняя компонента сканирования штрихкодов).

### 3.3. Модули Честный Знак и ПИОТ
- Модуль локальной проверки кодов маркировки лекарств (**ESM** / Электронный справочник маркировки).
- Модуль **ПИОТ (Regime)** — служба проверки кодов перед пробитием чека на кассе.
- Остановка этих служб приводит к ошибке 1С: «Ошибка проверки кода маркировки Честный Знак».

### 3.4. Банковский эквайринг (Сбербанк sc552)
- Каталог интеграции: `C:\sc552\`
- Критичные библиотеки: `sbrf.dll`, `sbrfcom.dll`, `pilot_nt.dll`
- Конфигурация пин-пада: `C:\sc552\pinpad.ini` (параметры `ComPort=...`, `Speed=115200`).
- Регистрация COM-библиотеки в живой ОС: `regsvr32 /s C:\sc552\sbrfcom.dll`.

### 3.5. КриптоПро CSP и электронные подписи
- Каталог ключей и контейнеров пользователя: `C:\Users\<User>\AppData\Roaming\Crypto Pro\`
- Реестр контейнеров: `HKLM\SOFTWARE\WOW6432Node\Crypto Pro\Settings\Users\<SID>\Keys`
- Драйверы токенов: Рутокен (`rtDrivers`), JaCarta (`eToken`).

---

## 4. Энциклопедия кодов BSOD (Синих экранов) и их офлайн-лечение из WinPE

### 4.1. INACCESSIBLE_BOOT_DEVICE (0x0000007B)
- **Причины:**
  1. Сброс настроек BIOS/UEFI при разряде батарейки CR2032 (режим SATA переключился с `AHCI` на `IDE` или `RAID`).
  2. Отключение или повреждение драйвера контроллера диска (`storahci.sys`, `iaStorA.sys`, `iaStorV.sys`).
- **Лечение в реестре из WinPE (для диска `C:`):**
  ```cmd
  reg load HKLM\OFFLINE_SYS C:\Windows\System32\config\SYSTEM
  reg add HKLM\OFFLINE_SYS\ControlSet001\Services\storahci /v Start /t REG_DWORD /d 0 /f
  reg add HKLM\OFFLINE_SYS\ControlSet001\Services\iaStorV /v Start /t REG_DWORD /d 0 /f
  reg add HKLM\OFFLINE_SYS\ControlSet001\Services\iaStorA /v Start /t REG_DWORD /d 0 /f
  reg add HKLM\OFFLINE_SYS\ControlSet001\Services\atapi /v Start /t REG_DWORD /d 0 /f
  reg add HKLM\OFFLINE_SYS\ControlSet001\Services\intelide /v Start /t REG_DWORD /d 0 /f
  reg unload HKLM\OFFLINE_SYS
  ```
  *(Значение Start=0 переводит запуск драйверов в режим Boot — Windows стартует при любом SATA-режиме).*

### 4.2. BAD_SYSTEM_CONFIG_INFO (0x00000074) / SYSTEM_LICENSE_VIOLATION (0x0000005C)
- **Причины:**
  Куст реестра `SYSTEM` поврежден, обрезан (размер 0 байт) или транзакционный лог (`SYSTEM.LOG1`) не был зафиксирован при аварийном отключении питания кассы.
- **Лечение:**
  1. Сделать резервную копию: `copy C:\Windows\System32\config\SYSTEM C:\Windows\System32\config\SYSTEM.bad`.
  2. Проверить `C:\Windows\System32\config\RegBack\SYSTEM` (если не 0 байт — скопировать).
  3. Если RegBack пуст (поведение Win10 1803+): извлечь куст из теневой копии VSS (см. Раздел 6).
  4. Если поврежден только лог транзакций: временно переименовать `SYSTEM.LOG1` и `SYSTEM.LOG2` в `.old`, выполнить `chkdsk C: /f`.

### 4.3. CRITICAL_PROCESS_DIED (0x000000EF) / KMODE_EXCEPTION_NOT_HANDLED (0x0000001E)
- **Причины:**
  Убит или поврежден критически важный системный процесс (`csrss.exe`, `lsass.exe`, `services.exe`, `winlogon.exe`) либо поврежден системный бинарник антивируса/фильтра диска.
- **Лечение из WinPE:**
  1. Офлайн проверка системных файлов:
     ```cmd
     sfc /scannow /offbootdir=C:\ /offwindir=C:\Windows
     ```
  2. Восстановление хранилища компонентов DISM из смонтированного образа:
     ```cmd
     dism /Image:C:\ /Cleanup-Image /RestoreHealth /Source:wim:E:\sources\install.wim:1 /LimitAccess
     ```

### 4.4. UNMOUNTABLE_BOOT_VOLUME (0x000000ED) / NTFS_FILE_SYSTEM (0x00000024)
- **Причины:**
  Повреждение метаданных файловой системы ($MFT, $LogFile), внезапное отключение питания, «грязный» бит тома.
- **Лечение:**
  ```cmd
  chkdsk C: /f /r /x
  ```
  Если том заблокирован спящим режимом (Fast Startup / `hiberfil.sys`):
  ```cmd
  del /f /a /q C:\hiberfil.sys
  ```

### 4.5. KERNEL_DATA_INPAGE_ERROR (0x0000007A) / KERNEL_STACK_INPAGE_ERROR (0x00000077)
- **Причины:**
  Страница данных ядра не может быть прочитана с диска в ОЗУ. Указывает на физические бэд-блоки HDD/SSD, плохой контакт SATA-кабеля или деградацию флеш-памяти.
- **Лечение:**
  1. Проверить SMART накопителя (атрибуты 05 Reallocated Sectors, BB Uncorrectable Errors, C7 UltraDMA CRC Errors).
  2. Заменить интерфейсный кабель SATA.
  3. Выполнить `chkdsk C: /r` для изоляции сбойных секторов.

### 4.6. DRIVER_IRQL_NOT_LESS_OR_EQUAL (0x000000D1) / SYSTEM_THREAD_EXCEPTION (0x0000007E)
- **Причины:**
  Сбой драйвера режима ядра (часто сетевой карты, Wi-Fi адаптера или антивируса).
- **Диагностика и лечение:**
  1. Прочитать имя сбойного драйвера в логе дампа `C:\Windows\Minidump\*.dmp` или на экране BSOD.
  2. Отключить службу сбойного драйвера в офлайн-реестре:
     ```cmd
     reg load HKLM\OFFLINE_SYS C:\Windows\System32\config\SYSTEM
     reg add HKLM\OFFLINE_SYS\ControlSet001\Services\<ИмяДрайвера> /v Start /t REG_DWORD /d 4 /f
     reg unload HKLM\OFFLINE_SYS
     ```
     *(Значение Start=4 полностью отключает запуск проблемного драйвера).*

### 4.7. WHEA_UNCORRECTABLE_ERROR (0x00000124) / MACHINE_CHECK_EXCEPTION (0x0000009C)
- **Причины:**
  Аппаратный сбой процессора, контроллера памяти, перегрев CPU (засохшая термопаста, заклинивший вентилятор в компактном кассовом блоке), вздувшиеся конденсаторы цепи питания VRM на материнской плате.
- **Действия:**
  1. Проверить температуру процессора в BIOS/UEFI.
  2. Очистить системный блок от пыли, заменить термопасту.
  3. Проверить стабильность питающих напряжений 12V, 5V, 3.3V в BIOS или заменой блока питания.

### 4.8. PAGE_FAULT_IN_NONPAGED_AREA (0x00000050) / MEMORY_MANAGEMENT (0x0000001A)
- **Причины:**
  Сбойная планка оперативной памяти (ОЗУ), окисление контактов слота DIMM, повреждение системного файла подкачки `pagefile.sys`.
- **Лечение:**
  1. Запустить MemTest86+ из меню загрузки Strelec WinPE для локализации неисправного модуля памяти.
  2. Удалить битый файл подкачки из WinPE:
     ```cmd
     del /f /a /q C:\pagefile.sys
     del /f /a /q C:\swapfile.sys
     ```
  3. Извлечь планки памяти, протереть контакты изопропиловым спиртом или мягким ластиком.

### 4.9. BAD_POOL_HEADER (0x00000019) / BAD_POOL_CALLER (0x000000C2)
- **Причины:**
  Повреждение структуры пула памяти ядра ОС некорректным драйвером (часто антивирусные сетевые фильтры или старые версии драйверов ключей Guardant/Рутокен).
- **Лечение:**
  Загрузиться в WinPE, отключить сторонние службы фильтров в ветке `HKLM\SYSTEM\CurrentControlSet\Control\Class`.

---

## 5. Ошибки загрузчика BCD и структуры разделов (UEFI и Legacy MBR)

### 5.1. Коды ошибок загрузчика Windows Boot Manager
- `0xc000000e` — Устройство загрузки недоступно или поврежден путь `device/osdevice` в BCD.
- `0xc0000001` — Сбой инициализации среды загрузки.
- `0xc0000098` — В хранилище BCD отсутствует запись об операционной системе.
- `0xc0000225` — Не найден файл загрузчика (`winload.efi` или `winload.exe`).
- `0xc0000034` — Хранилище BCD физически отсутствует (удалено).
- `0xc00000bb` — Ошибка проверки микрокода UEFI или Secure Boot.
- `0xc000000f` — Ошибка доступа к BCD или повреждение реестра BCD.

### 5.2. Универсальный ремонт загрузчика для UEFI / GPT
1. Через `diskpart` найти скрытый раздел EFI (FAT32, размер 100–300 МБ) и назначить ему свободную букву (например `S:`):
   ```cmd
   diskpart
   select disk 0
   list volume
   select volume <Номер_EFI_тома>
   assign letter=S
   exit
   ```
2. Отформатировать раздел EFI (по необходимости при сильном повреждении):
   ```cmd
   format S: /FS:FAT32 /Q
   ```
3. Полностью заново сгенерировать загрузочные файлы UEFI и свежий BCD:
   ```cmd
   bcdboot C:\Windows /s S: /f UEFI /v
   ```

### 5.3. Универсальный ремонт загрузчика для Legacy BIOS / MBR
1. Убедиться, что активный системный раздел (System Reserved 500 МБ или диск Windows) помечен как Active:
   ```cmd
   diskpart
   select disk 0
   select partition 1
   active
   exit
   ```
2. Переписать загрузочные секторы MBR и PBR:
   ```cmd
   bootrec /fixmbr
   bootrec /fixboot
   ```
   *(Если bootrec /fixboot выдает «Отказано в доступе», выполнить: `bootsect /nt60 SYS /force /mbr`).*
3. Сгенерировать BCD для BIOS:
   ```cmd
   bcdboot C:\Windows /s C: /f BIOS /v
   ```

---

## 6. Восстановление реестра из теневых копий VSS (когда RegBack пуст)

В Windows 10 1803+ папка `RegBack` пуста по умолчанию (Microsoft отключила периодический бэкап реестра). Единственный шанс спасти кусты без переустановки — вытащить их из теневых копий VSS (Volume Shadow Copy).

### Пошаговый алгоритм в WinPE:
1. Найти список доступных теневых копий:
   ```cmd
   vssadmin list shadows /for=C:
   ```
   В выводе найти строку **Имя устройства теневой копии (Shadow Copy Device Name)**, например:
   `\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1`
2. Создать символическую ссылку на теневую копию:
   ```cmd
   mklink /d X:\VSS_RESTORE \\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1\
   ```
3. Скопировать здоровые кусты реестра:
   ```cmd
   copy /y X:\VSS_RESTORE\Windows\System32\config\SYSTEM C:\Windows\System32\config\SYSTEM
   copy /y X:\VSS_RESTORE\Windows\System32\config\SOFTWARE C:\Windows\System32\config\SOFTWARE
   copy /y X:\VSS_RESTORE\Windows\System32\config\SAM C:\Windows\System32\config\SAM
   copy /y X:\VSS_RESTORE\Windows\System32\config\SECURITY C:\Windows\System32\config\SECURITY
   copy /y X:\VSS_RESTORE\Windows\System32\config\DEFAULT C:\Windows\System32\config\DEFAULT
   ```
4. Удалить временную ссылку:
   ```cmd
   rmdir X:\VSS_RESTORE
   ```

---

## 7. Бесконечный цикл обновлений Windows (Boot Loop / Pending Updates)

### Симптомы:
ПК циклически перезагружается на этапе: «Идет настройка обновлений... Не удалось настроить обновления. Отмена изменений. Не выключайте компьютер».

### Пошаговое лечение в WinPE:
1. Принудительный откат незавершенных транзакций через DISM:
   ```cmd
   dism /Image:C:\ /Cleanup-Image /RevertPendingActions
   ```
2. Очистка файла отложенных примитивных операций `pending.xml`:
   ```cmd
   if exist "C:\Windows\WinSxS\pending.xml" ren "C:\Windows\WinSxS\pending.xml" pending.old
   ```
3. Очистка кэша загруженных битых обновлений:
   ```cmd
   del /q /s "C:\Windows\SoftwareDistribution\Download\*"
   ```
4. Сброс флагов незавершенного обновления в кусте `COMPONENTS`:
   ```cmd
   reg load HKLM\OFFLINE_COMP C:\Windows\System32\config\COMPONENTS
   reg delete HKLM\OFFLINE_COMP /v PendingXmlIdentifier /f
   reg unload HKLM\OFFLINE_COMP
   ```

---

## 8. Быстрый запуск Windows (Fast Startup) и блокировка доступа к диску

### Проблема:
В Windows 10/11 по умолчанию включен Fast Startup (гибридный сон). При выключении ПК ядро не завершает работу, а сбрасывает память в `hiberfil.sys`. При этом файловая система NTFS остается в заблокированном состоянии (`dirty bit`), а кусты реестра могут не читаться из WinPE или повреждаться при попытке записи.

### Решение из WinPE:
1. Удалить файл гибернации:
   ```cmd
   del /f /a /q C:\hiberfil.sys
   ```
2. Отключить Fast Startup в офлайн-реестре, чтобы касса выключалась начисто:
   ```cmd
   reg load HKLM\OFFLINE_SYS C:\Windows\System32\config\SYSTEM
   reg add "HKLM\OFFLINE_SYS\ControlSet001\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f
   reg unload HKLM\OFFLINE_SYS
   ```

---

## 9. Офлайн-восстановление системных файлов (SFC и DISM)

Если повреждены библиотеки DLL, сервисы Windows или системные компоненты:
1. **Проверка и восстановление защищенных файлов:**
   ```cmd
   sfc /scannow /offbootdir=C:\ /offwindir=C:\Windows
   ```
2. **Восстановление хранилища компонентов DISM без интернета:**
   Подключить WIM-образ с флешки реаниматора:
   ```cmd
   dism /Image:C:\ /Cleanup-Image /RestoreHealth /Source:wim:E:\Images\install.wim:1 /LimitAccess
   ```
3. **Очистка поврежденного хранилища WinSxS:**
   ```cmd
   dism /Image:C:\ /Cleanup-Image /StartComponentCleanup
   ```

---

## 10. Аппаратная диагностика дисков (SMART, SATA, TRIM)

- **Критические атрибуты SMART:**
  - `05 Reallocated Sectors Count` — переназначенные секторы (при росте > 50 диск подлежит срочной замене).
  - `0A Spin Retry Count` — проблемы шпинделя или питания HDD.
  - `BB Reported Uncorrectable Errors` — аппаратные ошибки чтения.
  - `C7 UltraDMA CRC Error Count` — сбои передачи по кабелю SATA (требуется переподключить или заменить шлейф SATA).
- **Оптимизация SSD:**
  В живой системе проверка поддержки TRIM:
  ```cmd
  fsutil behavior query DisableDeleteNotify
  ```
  *(0 означает, что TRIM включен и исправно функционирует).*

---

## 11. Обязательный регламент резервного копирования перед любым вмешательством

Перед переустановкой системы, форматированием, применением деструктивных команд или восстановлением из эталонного образа (Deploy) **ОБЯЗАТЕЛЬНО** сохранить на диск D: или внешнюю флешку:

```cmd
:: 1. Основные и альтернативные пути к базам 1С кассы:
if exist "C:\база розница" robocopy "C:\база розница" "D:\Backup_Emergency\база_розница" *.1CD /E /J /MT:8 /R:1 /W:1
if exist "D:\база розница" robocopy "D:\база розница" "E:\Backup_Emergency\база_розница" *.1CD /E /J /MT:8 /R:1 /W:1
if exist "C:\база аптека"  robocopy "C:\база аптека"  "D:\Backup_Emergency\база_аптека"  *.1CD /E /J /MT:8 /R:1 /W:1
if exist "C:\Base1C"       robocopy "C:\Base1C"       "D:\Backup_Emergency\Base1C"       *.1CD /E /J /MT:8 /R:1 /W:1

:: 2. Сквозной поиск и страховочный бэкап ВСЕХ файлов баз 1Cv8.1CD на диске:
robocopy "C:\" "D:\Backup_Emergency\All_Found_1CD\C" *.1CD /S /XD "Windows" "$RECYCLE.BIN" "System Volume Information" /MT:8 /R:1 /W:1

:: 3. Программные лицензии 1С:
robocopy "C:\ProgramData\1C\licenses" "D:\Backup_Emergency\1C_Licenses" /E /R:1 /W:1

:: 4. Профили, списки информационных баз ibases.v8i и контейнеры КриптоПро:
robocopy "C:\Users" "D:\Backup_Emergency\Users_1C" ibases.v8i /S /R:1 /W:1
robocopy "C:\Users" "D:\Backup_Emergency\Users_CryptoPro" * /S /XD * /IF "*Crypto Pro*" /R:1 /W:1

:: 5. Настройки ККТ АТОЛ и эквайринга Сбера:
robocopy "C:\Program Files (x86)\ATOL\Drivers10\KKT\bin\EoU" "D:\Backup_Emergency\ATOL_EoU" settings.xml /R:1 /W:1
robocopy "C:\sc552" "D:\Backup_Emergency\sc552" /E /R:1 /W:1

:: 6. Рабочие столы кассиров и пользователей:
for /d %u in ("C:\Users\*") do @if exist "%u\Desktop" robocopy "%u\Desktop" "D:\Backup_Emergency\Desktops\%~nxu" /E /R:1 /W:1
```
*(Базы 1С в `c:\база розница\` или любых других папках, лицензии и настройки кассы сохраняются гарантированно и полностью).*

---

## 12. Офлайн-восстановление поврежденных профилей пользователей (User Profile Service failed the sign-in)

### Симптомы:
При входе кассира появляется надпись: «Служба профилей пользователей препятствует входу в систему. Невозможно загрузить профиль пользователя» либо загружается временный пустой профиль (`TEMP`).

### Причина:
Windows создала дублирующий ключ реестра с суффиксом `.bak` в ветке `ProfileList`, а основной профиль пометила поврежденным (`State != 0`).

### Лечение из WinPE:
1. Загрузить куст `SOFTWARE`:
   ```cmd
   reg load HKLM\OFFLINE_SOFT C:\Windows\System32\config\SOFTWARE
   ```
2. Открыть ветку в `regedit` или проверить через командную строку:
   `HKLM\OFFLINE_SOFT\Microsoft\Windows NT\CurrentVersion\ProfileList`
3. Найти проблемный SID (начинается на `S-1-5-21-...`):
   - Если есть папка `S-1-5-21-...` (временная) и `S-1-5-21-....bak` (настоящий профиль):
     - Переименовать `S-1-5-21-...` в `S-1-5-21-....tmp`
     - Стереть суффикс `.bak` у настоящей папки (переименовать в `S-1-5-21-...`)
     - Удалить временную папку `...tmp`
4. Сбросить счетчики ошибок:
   - Внутри восстановленной ветки установить параметр `State` = 0 (тип DWORD).
   - Установить параметр `RefCount` = 0 (тип DWORD).
5. Выгрузить куст:
   ```cmd
   reg unload HKLM\OFFLINE_SOFT
   ```

---

## 13. Зацикливание «Автоматическое восстановление» (Automatic Repair Loop / SrtTrail.txt)

### Симптомы:
ПК не загружается, постоянно перезагружаясь в синий экран: «Автоматическое восстановление не смогло восстановить ваш компьютер».

### 1. Точная диагностика причины через чтение лога WinRE в WinPE:
```cmd
type C:\Windows\System32\LogFiles\Srt\SrtTrail.txt | findstr /i "Root cause Error Corrupt Failure"
```
*(Лог прямо указывает на имя сбойного драйвера, поврежденного файла или битого раздела).*

### 2. Принудительный разрыв бесконечного цикла перезагрузок WinRE:
Если система застряла в цикле вызова среды восстановления, отключить автоматический вход в WinRE:
```cmd
bcdedit /store S:\EFI\Microsoft\Boot\BCD /set {default} recoveryenabled No
bcdedit /store S:\EFI\Microsoft\Boot\BCD /set {default} bootstatuspolicy ignoreallfailures
```
*(Для MBR-систем вместо `S:\EFI\Microsoft\Boot\BCD` указать `C:\boot\bcd` или выполнить `bcdedit /store C:\Boot\BCD ...`).*

---

## 14. Офлайн-управление и удаление сбойных драйверов через DISM

Если после установки драйвера видеокарты, сетевого адаптера или антивируса система перестала загружаться:

### 1. Получение списка всех сторонних установленных драйверов:
```cmd
dism /Image:C:\ /Get-Drivers
```
В выводе найти строку с проблемным устройством и запомнить его опубликованное имя: `oemXX.inf` (например, `oem12.inf`).

### 2. Удаление конфликтующего драйвера из офлайн-системы:
```cmd
dism /Image:C:\ /Remove-Driver /Driver:oem12.inf
```

### 3. Отключение блокирующих драйверов фильтров дисков (UpperFilters / LowerFilters):
В редких случаях антивирусы или виртуальные дисководы ломают доступ к диску через ветку `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e967-e325-11ce-bfc1-08002be10318}`.
Удаление значений `UpperFilters` и `LowerFilters` возвращает загрузку Windows.

---

## 15. Сбои диспетчера печати (Print Spooler) и кассовых чековых принтеров

### Симптомы:
Служба `spoolsv.exe` падает при старте, зависает 1С при попытке печати накладных или чеков, не открывается окно «Устройства и принтеры».

### Лечение из WinPE или живой ОС:
1. Полная очистка зависшей очереди печати (битые файлы `.spl` и `.shd`):
   ```cmd
   del /q /f /s "C:\Windows\System32\spool\PRINTERS\*.*"
   ```
2. Очистка битых кэшированных драйверов:
   ```cmd
   del /q /f /s "C:\Windows\System32\spool\drivers\x64\3\Old\*.*"
   ```
3. Проверка режима запуска службы в офлайн-реестре:
   ```cmd
   reg load HKLM\OFFLINE_SYS C:\Windows\System32\config\SYSTEM
   reg add HKLM\OFFLINE_SYS\ControlSet001\Services\Spooler /v Start /t REG_DWORD /d 2 /f
   reg unload HKLM\OFFLINE_SYS
   ```

---

## 16. Офлайн-сброс паролей и аварийный доступ администратора (SAM / Utilman)

Если кассир заблокировал учетную запись или забыт пароль локального администратора:

### Способ 1: Использование встроенного инструмента NTPWEdit в сборке Стрельца:
1. Запустить `NTPWEdit` из меню «Сброс паролей».
2. Открыть файл `C:\Windows\System32\config\SAM`.
3. Выбрать учетную запись (`0`, `admin` или `Администратор`), нажать **Unlock** и **Change Password** (или оставить пустым).

### Способ 2: Классическая подмена Utilman на CMD (гарантированный доступ без утилит):
1. В WinPE выполнить:
   ```cmd
   copy /y C:\Windows\System32\cmd.exe C:\Windows\System32\utilman.exe
   ```
2. Перезагрузиться в штатную Windows.
3. На экране приветствия нажать сочетание клавиш `Win + U` (или значок «Специальные возможности» в правом нижнем углу).
4. Откроется командная строка с правами `NT AUTHORITY\SYSTEM`:
   ```cmd
   net user admin [НовыйПароль]
   net user admin /active:yes
   ```
5. После входа вернуть оригинальный `utilman.exe` на место из `C:\Windows\System32\utilman.exe.bak`.

---

## 17. Офлайн-восстановление сетевого стека, DHCP и Брандмауэра

Если ПК был перемещен из одной аптеки в другую и настроен на жесткий чужой IP-адрес (или брандмауэр блокирует MeshCentral/RustDesk):

### 1. Перевод сетевых адаптеров на автоматический DHCP через офлайн-реестр:
```cmd
reg load HKLM\OFFLINE_SYS C:\Windows\System32\config\SYSTEM
for /f "tokens=*" %i in ('reg query "HKLM\OFFLINE_SYS\ControlSet001\Services\Tcpip\Parameters\Interfaces"') do (
  reg add "%i" /v EnableDHCP /t REG_DWORD /d 1 /f
  reg delete "%i" /v IPAddress /f >nul 2>&1
  reg delete "%i" /v SubnetMask /f >nul 2>&1
  reg delete "%i" /v DefaultGateway /f >nul 2>&1
)
reg unload HKLM\OFFLINE_SYS
```

### 2. Офлайн-отключение Брандмауэра Windows при сетевой изоляции:
```cmd
reg load HKLM\OFFLINE_SYS C:\Windows\System32\config\SYSTEM
reg add "HKLM\OFFLINE_SYS\ControlSet001\Services\SharedAccess\Parameters\FirewallPolicy\StandardProfile" /v EnableFirewall /t REG_DWORD /d 0 /f
reg add "HKLM\OFFLINE_SYS\ControlSet001\Services\SharedAccess\Parameters\FirewallPolicy\DomainProfile" /v EnableFirewall /t REG_DWORD /d 0 /f
reg add "HKLM\OFFLINE_SYS\ControlSet001\Services\SharedAccess\Parameters\FirewallPolicy\PublicProfile" /v EnableFirewall /t REG_DWORD /d 0 /f
reg unload HKLM\OFFLINE_SYS
```

---

## 18. Шифрование BitLocker и TPM-блокировка дисков в WinPE

Если диск терминала заблокирован BitLocker (показывает значок замка или недоступен для чтения файлов):

### 1. Проверка статуса тома:
```cmd
manage-bde -status C:
```

### 2. Разблокировка диска с помощью 48-значного ключа восстановления:
```cmd
manage-bde -unlock C: -RecoveryPassword XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX
```

### 3. Полная расшифровка накопителя для исключения повторных блокировок:
```cmd
manage-bde -off C:
```

---

## 19. Служба криптографии и повреждение баз Catroot2 / SoftwareDistribution

### Симптомы:
Ошибки `0x80070002`, `0x80070057`, `0x80092004` при установке драйверов торгового оборудования, сертификатов КЭП КриптоПро или накопительных пакетов обновлений.

### Лечение из WinPE:
1. Переименовать поврежденную базу каталогов подписей:
   ```cmd
   if exist "C:\Windows\System32\catroot2" ren "C:\Windows\System32\catroot2" catroot2.old
   ```
2. Очистить хранилище загрузок обновлений:
   ```cmd
   del /q /s "C:\Windows\SoftwareDistribution\DataStore\*"
   del /q /s "C:\Windows\SoftwareDistribution\Download\*"
   ```
*(При следующей загрузке Windows автоматически сгенерирует чистые базы данных).*

---

## 20. Анализ журналов событий Windows Event Log (.evtx) из WinPE

Если компьютер выключается или падает в синий экран без понятных сообщений:
1. **Каталог журналов:** `C:\Windows\System32\winevt\Logs\`
2. **Экспорт последних критических ошибок в файл лога из PowerShell в WinPE:**
   ```powershell
   Get-WinEvent -Path "C:\Windows\System32\winevt\Logs\System.evtx" -MaxEvents 50 | Where-Object { $_.LevelDisplayName -in ('Критический','Ошибка') } | Format-Table TimeCreated, Id, Message -Wrap > X:\crash_report.txt
   ```
3. Сохранение журналов для технической поддержки:
   ```cmd
   robocopy "C:\Windows\System32\winevt\Logs" "D:\Backup_Emergency\Logs" System.evtx Application.evtx /R:1 /W:1
   ```


---

## 21. Системы видеонаблюдения аптек (Dahua XVR / NVR, SmartPSS, IP-камеры)

### 21.1. Инфраструктура и типовое оборудование
- **Видеорегистраторы на точках:** Dahua XVR/NVR (серии `DH_XVR5x04`, `DH_XVR5x04-S2`, `DH_XVR5x08`, `DH-XVR5108HS-I3`).
- **ПО просмотра у фармацевта/кассира:** **Dahua SmartPSS** (`C:\Program Files\Smart Professional Surveillance System\SmartPSS\SmartPSS.exe`) и **SmartPSS-Lite**.
- **Каталог конфигурации SmartPSS:**
  - `C:\Users\Public\SmartPSS\Organization\OrganizationDevice.xml` (база добавленных регистраторов и камер).
  - `C:\Users\Public\SmartPSS\log\` (файлы журналов и ошибок).

### 21.2. Сетевые порты, IP-адреса и MAC-префиксы
- **Критичные порты Dahua:**
  - **`37777`** (TCP/UDP) — основной транспорт передачи видеопотока, управления и протокола Dahua.
  - `37778` (UDP), `8888` (HTTP/Web).
  - Веб-порты администрирования: `80`, `8080`, `8081`, `8082`.
- **Стандартные локальные IP-адреса регистраторов в подсетях аптек (`192.168.1.0/24`):**
  `192.168.1.66`, `192.168.1.67`, `192.168.1.128`, `192.168.1.129`.
- **MAC-префиксы сетевых карт Dahua (поиск по ARP-таблице):**
  `e0:50:8b`, `bc:32:5f`, `a0:bd:1d`, `3c:ef:8c`, `90:02:a9`.
  *(Команда быстрого обнаружения в локальной сети: `arp -a | findstr /i "e0-50-8b bc-32-5f a0-bd-1d 3c-ef-8c 90-02-a9"`).*

### 21.3. Учетные записи и доступы
- **Основной сервисный пользователь:**
  - Логин: `service_user`
  - Пароль: `[Установлен корпоративный пароль]`
- **Аварийный служебный пользователь:**
  - Логин: `emergency_admin`
  - Пароль: `[Установлен аварийный пароль]`

### 21.4. Почтовые оповещения об авариях регистратора (SMTP)
- Сервер: `smtp.example.com`, порт `465` (SSL).
- Учетная запись: `alerts@example.com`.
- Получатели уведомлений: системные администраторы.
- Контролируемые тревоги: отказ жесткого диска (`storage_failure`, `storage_not_exist`), переполнение памяти (`storage_low_space`), конфликт IP-адресов (`ip_conflict`), обрыв сетевого кабеля (`net_abort`), потеря видеосигнала камеры (`video_loss`).

### 21.5. Набор инструментов восстановления и регламенты применения

Все утилиты видеосистемы собраны в каталоге `C:\Tools\Cameras\`:

#### Сбой 1: «Не показывают камеры в SmartPSS на компьютере аптеки»
- **Причина 1:** Брандмауэр Windows заблокировал входящий/исходящий трафик `SmartPSS.exe` или порт `37777`.
- **Причина 2:** Ошибка P2P Cloud SN (код `nState = 8` или `P2P_DeviceStatus:failed` в логах).
- **Диагностика:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Tools\Cameras\diagnose_smartpss.ps1"
  ```
  *(Скрипт проверяет правила firewall, опрашивает открытость порта 37777 и выводит статус устройств).*
- **Автоматическое устранение блокировок:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File "C:\Tools\Cameras\fix_smartpss.ps1"
  ```
  *(Скрипт удаляет блокирующие правила брандмауэра, создает полные правила Inbound/Outbound для SmartPSS и открывает порты 37777, 37778, 8888).*

#### Сбой 2: «Регистратор перестал писать архив / Отвалился жесткий диск (HDD Error / Storage Not Exist)»
- **Причина:** Просадка питания 12В, зависание шины SATA регистратора, повреждение файловой системы DHFS при отключении света или остановка записи из-за отключенной циклической перезаписи.
- **Диагностика и ремонт через `dahua_disk.exe`:**
  1. Проверка состояния дисков (CGI / Web RPC2):
     ```cmd
     dahua_disk.exe --ip 192.168.1.66 --action check
     ```
  2. Программный ребут регистратора (переинициализация зависшей шины SATA без выезда на точку):
     ```cmd
     dahua_disk.exe --ip 192.168.1.66 --action reboot
     ```
  3. Восстановление и форматирование разметки DHFS:
     ```cmd
     dahua_disk.exe --ip 192.168.1.66 --action format --path /dev/sda0 --yes
     ```
  4. Принудительное включение циклической перезаписи (`StorageGlobal.OverWrite=True`).

#### Сбой 3: «Сброс регистратора до заводских настроек / Нет удаленного доступа»
- **Добавление пользователя и включение P2P:**
  Запуск `dahua_add_user.exe` (создает сервисного пользователя и включает P2P-облако).
- **Восстановление параметров:**
  Запуск `dahua_restore.exe`.

#### Сбой 4: Единый пульт управления Dahua Manager
- Исполняемый файл: `dahua_manager.exe` (или `dahua_manager.bat`).
- Интерактивное меню:
  `[1]` Узнать информацию об устройствах (`dahua_info`)
  `[2]` Восстановить параметры устройств (`dahua_restore`)
  `[3]` Добавление сервисного пользователя и включение P2P (`dahua_add_user`)
  `[4]` Обновление прошивки по внешним инструкциям (`dahua_upgrade`)
  `[5]` Проверка и скачивание обновлений
  `[6]` Настройка email-оповещений о сбоях (`dahua_email`)
  `[7]` Диагностика и восстановление отвалившегося диска (`dahua_disk`)
