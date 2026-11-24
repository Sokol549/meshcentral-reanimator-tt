'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

const PLUGIN_VERSION = '1.0.1';

function normalizeModelName(m) {
    if (!m || typeof m !== 'string') return 'gpt-6-luna';
    const clean = m.trim();
    switch (clean.toLowerCase()) {
        case 'chatgpt6-luna':
        case 'chatgpt-6-luna':
            return 'gpt-6-luna';
        case 'chatgpt6-astra':
        case 'chatgpt-6-astra':
            return 'gpt-6-astra';
        case 'chatgpt6-sol':
        case 'chatgpt-6-sol':
            return 'gpt-6-sol';
        case 'chatgpt5.6-luna':
        case 'chatgpt-5.6-luna':
            return 'gpt-5.6-luna';
        default:
            return clean;
    }
}

function create(parent) {
    const server = parent.meshServer || parent.parent || parent;
    const obj = {};
    obj.exports = ['onWebUIStartupEnd', 'onDeviceRefreshEnd', 'onReanimatorMessage'];

    const dataPath = (server && server.datapath) || __dirname;
    const settingsFile = path.join(dataPath, 'reanimatortt-settings.json');
    const kbFile = path.join(__dirname, 'knowledge_base.md');

    // Default configuration (no hardcoded keys for public repository)
    let config = {
        apiKey: process.env.REANIMATOR_API_KEY || '',
        baseUrl: process.env.REANIMATOR_BASE_URL || 'https://ai.starimg.ru/v1',
        model: 'gpt-6-luna',
        timeoutSeconds: 60,
        temperature: 0.2,
        maxTokens: 4096,
        requireDangerConfirmation: true
    };

    function loadSettings() {
        try {
            if (fs.existsSync(settingsFile)) {
                const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                config = Object.assign({}, config, data);
            }
        } catch (e) {
            console.error('[ReanimatorTT] Ошибка чтения настроек:', e.message);
        }
    }

    function saveSettings(newSettings) {
        try {
            config = Object.assign({}, config, newSettings);
            fs.writeFileSync(settingsFile, JSON.stringify(config, null, 2), { mode: 0o600 });
            return true;
        } catch (e) {
            console.error('[ReanimatorTT] Ошибка записи настроек:', e.message);
            return false;
        }
    }

    loadSettings();

    // Load knowledge base
    let knowledgeBaseText = '';
    try {
        if (fs.existsSync(kbFile)) {
            knowledgeBaseText = fs.readFileSync(kbFile, 'utf8');
        }
    } catch (e) {
        console.warn('[ReanimatorTT] Не удалось загрузить knowledge_base.md:', e.message);
    }

    function sendToClient(client, data) {
        if (!client) return;
        const payload = Object.assign({
            action: 'plugin',
            plugin: 'reanimatortt',
            method: 'onReanimatorMessage',
            version: PLUGIN_VERSION
        }, data);

        try {
            if (client.ws && typeof client.ws.send === 'function') {
                client.ws.send(JSON.stringify(payload));
            } else if (typeof client.send === 'function') {
                client.send(JSON.stringify(payload));
            }
        } catch (e) {
            console.warn('[ReanimatorTT] Ошибка отправки клиенту:', e.message);
        }
    }

    function getSystemPrompt(deviceContext) {
        return [
            'Ты — автономный монолитный аварийно-восстановительный ИИ-агент «Реаниматор ТТ» (сеть аптек КЗВС / Юсова / Юг-Биосфера).',
            'Твоя задача — экстренная диагностика, устранение сбоев и помощь оператору/первостольнику на удаленном аптечном узле (касса, сервер ТТ, рабочее место).',
            '',
            'КОНТЕКСТ ЦЕЛЕВОГО УСТРОЙСТВА:',
            deviceContext ? JSON.stringify(deviceContext, null, 2) : 'Целевая станция: Windows (Live OS)',
            '',
            'СТРОЖАЙШИЙ ПРИНЦИП ПРОАКТИВНОСТИ И АВТОНОМНОСТИ:',
            '1. За компьютером на точке находится первостольник, кассир или дежурный фармацевт. Они НЕ системные администраторы.',
            '2. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО говорить оператору «введите команду в cmd» или «откройте PowerShell».',
            '3. Все проверки ты выполняешь САМОСТОЯТЕЛЬНО через инструмент `run_readonly_cmd`.',
            '4. Все исправления (перезапуск служб, снятие блокировок, удаление битого кэша, сброс очереди печати, настройка сети) ты вызываешь через инструмент `execute_system_command`, давая краткое и понятное объяснение.',
            '5. Если проблема решена или требуется заключение, выдай четкий итоговый отчет: в чем была причина сбоя, что сделано и каков статус работы кассы/1С.',
            '',
            'БАЗА ЗНАНИЙ АПТЕЧНОЙ СЕТИ:',
            knowledgeBaseText ? knowledgeBaseText.slice(0, 30000) : 'База знаний 1С 8.3, АТОЛ EoUService, сканеров, эквайринга и Windows.'
        ].join('\n');
    }

    function getToolDefinitions() {
        return [
            {
                type: 'function',
                function: {
                    name: 'run_readonly_cmd',
                    description: 'Выполнить безопасную диагностическую команду только для чтения (Get-Service, wevtutil, ipconfig, netstat, Get-Volume, dir, tasklist, sc query и т.д.) без изменения состояния системы.',
                    parameters: {
                        type: 'object',
                        properties: {
                            command: {
                                type: 'string',
                                description: 'Точная диагностическая команда Windows (PowerShell или CMD) для запуска на компьютере'
                            },
                            purpose: {
                                type: 'string',
                                description: 'Краткая цель диагностики на русском языке'
                            }
                        },
                        required: ['command']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'execute_system_command',
                    description: 'Выполнить системную команду, изменяющую состояние системы (Restart-Service, Stop-Process, Remove-Item, reg add, sfc, bcdedit, очистка кэша 1С, удаление блокировок 1CL/cfl, перезапуск Spooler, очистка Temp). Требует подтверждения оператора.',
                    parameters: {
                        type: 'object',
                        properties: {
                            command: {
                                type: 'string',
                                description: 'Команда PowerShell/CMD для выполнения'
                            },
                            explanation: {
                                type: 'string',
                                description: 'Понятное для фармацевта/оператора объяснение: какую проблему решает эта команда и какие параметры/файлы изменит'
                            },
                            danger_level: {
                                type: 'string',
                                enum: ['low', 'medium', 'high'],
                                description: 'Уровень риска изменения'
                            }
                        },
                        required: ['command', 'explanation']
                    }
                }
            }
        ];
    }

    function callLLM(messages, tools, customConfig, callback) {
        const activeCfg = Object.assign({}, config, customConfig || {});
        const targetModel = normalizeModelName(activeCfg.model);
        const reqPayload = JSON.stringify({
            model: targetModel,
            messages: messages,
            tools: tools && tools.length ? tools : undefined,
            temperature: activeCfg.temperature || 0.2,
            max_tokens: activeCfg.maxTokens || 4096,
            stream: false
        });

        let targetUrl = (activeCfg.baseUrl || 'https://ai.starimg.ru/v1').trim();
        if (!targetUrl.endsWith('/chat/completions')) {
            targetUrl = targetUrl.replace(/\/+$/, '') + '/chat/completions';
        }

        let parsedUrl;
        try {
            parsedUrl = new url.URL(targetUrl);
        } catch (e) {
            return callback(new Error('Некорректный Base URL: ' + targetUrl));
        }

        const isHttps = parsedUrl.protocol === 'https:';
        const clientLib = isHttps ? https : http;

        const reqOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(reqPayload),
                'Authorization': 'Bearer ' + (activeCfg.apiKey || '')
            },
            timeout: (activeCfg.timeoutSeconds || 60) * 1000
        };

        const req = clientLib.request(reqOptions, function (res) {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) { body += chunk; });
            res.on('end', function () {
                if (res.statusCode >= 400) {
                    let errMsg = 'HTTP ' + res.statusCode;
                    try {
                        const parsedErr = JSON.parse(body);
                        if (parsedErr.error && parsedErr.error.message) {
                            errMsg += ': ' + parsedErr.error.message;
                        }
                    } catch (_) {
                        errMsg += ': ' + body.slice(0, 300);
                    }
                    return callback(new Error(errMsg));
                }

                try {
                    const parsed = JSON.parse(body);
                    callback(null, parsed);
                } catch (e) {
                    callback(new Error('Не удалось разобрать ответ LLM: ' + e.message));
                }
            });
        });

        req.on('error', function (err) {
            callback(new Error('Ошибка сети при вызове ИИ: ' + err.message));
        });

        req.on('timeout', function () {
            req.destroy();
            callback(new Error('Превышен таймаут ответа ИИ (' + (activeCfg.timeoutSeconds || 60) + ' сек)'));
        });

        req.write(reqPayload);
        req.end();
    }

    // Server-action handler (WebSocket RPC from web client)
    obj.serveraction = function (cmd, client) {
        if (!client || !client.user) return;
        const isAdmin = client.user.siteadmin === -1 || client.user.siteadmin === 0xFFFFFFFF;
        const action = cmd && cmd.pluginaction;
        const requestId = cmd && cmd.requestId;

        if (action === 'getSettings') {
            const safeConfig = Object.assign({}, config);
            if (!isAdmin && safeConfig.apiKey) {
                safeConfig.apiKey = safeConfig.apiKey.slice(0, 6) + '...' + safeConfig.apiKey.slice(-4);
            }
            sendToClient(client, {
                type: 'settings',
                requestId: requestId,
                settings: safeConfig,
                isAdmin: isAdmin,
                kbLoaded: !!knowledgeBaseText,
                kbLength: knowledgeBaseText.length
            });
            return;
        }

        if (action === 'saveSettings') {
            if (!isAdmin) {
                sendToClient(client, { type: 'error', requestId: requestId, error: 'Требуются права администратора MeshCentral для изменения настроек ИИ.' });
                return;
            }
            const s = cmd.settings || {};
            const clean = {};
            if (typeof s.baseUrl === 'string' && s.baseUrl.trim()) clean.baseUrl = s.baseUrl.trim();
            if (typeof s.apiKey === 'string' && s.apiKey.trim() && !s.apiKey.includes('...')) clean.apiKey = s.apiKey.trim();
            if (typeof s.model === 'string' && s.model.trim()) clean.model = normalizeModelName(s.model);
            if (Number.isInteger(s.timeoutSeconds) && s.timeoutSeconds >= 10 && s.timeoutSeconds <= 300) clean.timeoutSeconds = s.timeoutSeconds;
            if (typeof s.temperature === 'number' && s.temperature >= 0 && s.temperature <= 1) clean.temperature = s.temperature;
            if (Number.isInteger(s.maxTokens) && s.maxTokens >= 512 && s.maxTokens <= 32768) clean.maxTokens = s.maxTokens;
            if (typeof s.requireDangerConfirmation === 'boolean') clean.requireDangerConfirmation = s.requireDangerConfirmation;

            const saved = saveSettings(clean);
            sendToClient(client, {
                type: 'settingsSaved',
                requestId: requestId,
                success: saved,
                settings: config
            });
            return;
        }

        if (action === 'chatTurn') {
            const incomingMessages = Array.isArray(cmd.messages) ? cmd.messages : [];
            const deviceContext = cmd.deviceContext || null;
            const useTools = cmd.useTools !== false;

            let finalMessages = [];
            const hasSystem = incomingMessages.some(m => m.role === 'system');
            if (!hasSystem) {
                finalMessages.push({
                    role: 'system',
                    content: getSystemPrompt(deviceContext)
                });
            }
            finalMessages = finalMessages.concat(incomingMessages);

            const tools = useTools ? getToolDefinitions() : null;

            callLLM(finalMessages, tools, null, function (err, result) {
                if (err) {
                    sendToClient(client, {
                        type: 'chatError',
                        requestId: requestId,
                        error: err.message
                    });
                    return;
                }

                const choice = result && result.choices && result.choices[0];
                if (!choice || !choice.message) {
                    sendToClient(client, {
                        type: 'chatError',
                        requestId: requestId,
                        error: 'Пустой ответ от ИИ-модели'
                    });
                    return;
                }

                const msg = choice.message;
                const toolCalls = msg.tool_calls || [];
                const reasoning = msg.reasoning_content || '';
                let content = msg.content || '';

                if (content.includes('<think>')) {
                    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                }

                sendToClient(client, {
                    type: 'chatResponse',
                    requestId: requestId,
                    message: {
                        role: 'assistant',
                        content: content,
                        reasoning: reasoning,
                        tool_calls: toolCalls
                    },
                    finish_reason: choice.finish_reason
                });
            });
            return;
        }

        if (action === 'getQuickScenarios') {
            const scenarios = [
                {
                    id: 'express_diag',
                    icon: '🩺',
                    title: 'Экспресс-диагностика ТТ',
                    description: 'Проверка дисков, свободного места, критических ошибок Windows за 24ч, статуса служб 1С и АТОЛ.',
                    prompt: 'Выполни полную экспресс-диагностику рабочей станции аптеки: проверь свободное место на дисках C: и D:, статус ключевых служб (EoUService, 1C, Spooler), наличие критических ошибок в системном журнале за последние 24 часа. Сформулируй выводы и дай рекомендации.'
                },
                {
                    id: '1c_emergency',
                    icon: '💊',
                    title: 'Авария 1С: кэш и блокировки',
                    description: 'Поиск и очистка битого кэша в AppData, снятие зависших блокировок 1Cv8.1CL и 1Cv8.cfl без потери данных.',
                    prompt: 'Устрани аварию 1С на кассе: проверь наличие зависших процессов 1cv8.exe/1cv8c.exe, найди и проверь временные файлы блокировок базы (*.1CL, *.cfl, 1Cv8tmp.*), проверь кэш 1С у пользователей. Предложи безопасную очистку кэша и снятие блокировок, сохранив файлы лицензий *.lic.'
                },
                {
                    id: 'atol_eou',
                    icon: '🧾',
                    title: 'ККТ АТОЛ / ОФД (EoUService)',
                    description: 'Проверка службы EthernetOverUsb, COM-портов, конфигурации settings.xml и отправки фискальных чеков.',
                    prompt: 'Продиагностируй кассовый аппарат АТОЛ и связь с ОФД: проверь статус службы EoUService, наличие процесса EthOverUsb.exe, конфигурационный файл settings.xml, занятые COM-порты и очередь неотправленных фискальных документов.'
                },
                {
                    id: 'print_spooler',
                    icon: '🖨️',
                    title: 'Сброс диспетчера печати',
                    description: 'Перезапуск службы Spooler и очистка зависшей очереди чеков и документов в System32\\spool\\PRINTERS.',
                    prompt: 'Проверь диспетчер очереди печати Spooler: найди зависшие битые задания печати в C:\\Windows\\System32\\spool\\PRINTERS, перезапусти службу Spooler и очисти очередь, чтобы кассовые чеки и накладные снова печатались.'
                },
                {
                    id: 'disk_cleanup',
                    icon: '🧹',
                    title: 'Очистка диска C: и мусора',
                    description: 'Безопасное удаление временных файлов Temp, дампов отчетов, корзины и освобождение системного диска.',
                    prompt: 'Проведи безопасную очистку системного диска C: удали мусор из папок C:\\Windows\\Temp, локальных Temp пользователей, отчетов об ошибках Windows Error Reporting (WER) и проверь освободившееся место.'
                },
                {
                    id: 'network_vpn',
                    icon: '🌐',
                    title: 'Диагностика сети и связи ТТ',
                    description: 'Проверка шлюза, DNS, связи с серверами 1С/ОФД, пинг и таблица маршрутизации аптеки.',
                    prompt: 'Проверь сетевую связность аптечного узла: IP-адрес, шлюз, доступность DNS-серверов, доступность ключевых серверов аптечной сети, статус сетевых адаптеров и таблицы маршрутов.'
                }
            ];

            sendToClient(client, {
                type: 'quickScenarios',
                requestId: requestId,
                scenarios: scenarios
            });
            return;
        }
    };

    // MeshCentral client-side hook: Entire UI and logic are embedded directly here
    // so MeshCentral prepExports() sends it straight to the browser without extra file loads!
    obj.onWebUIStartupEnd = function () {
        if (window.ReanimatorTT) return;

        // 1. Inject Styles
        var style = document.createElement('style');
        style.id = 'reanimatortt-ui-style';
        style.textContent = `
            .rtt-btn-status-open {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
                color: #ffffff !important;
                border: none;
                border-radius: 6px;
                padding: 7px 14px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(225, 29, 72, 0.35);
                margin: 8px 8px 12px 0;
                vertical-align: middle;
                transition: all 0.2s ease;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            }
            .rtt-btn-status-open:hover {
                background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
                box-shadow: 0 6px 16px rgba(225, 29, 72, 0.5);
                transform: translateY(-1px);
            }
            .rtt-btn-status-open:active {
                transform: translateY(0);
                box-shadow: 0 2px 6px rgba(225, 29, 72, 0.3);
            }
            .rtt-btn-icon-span { font-size: 16px; line-height: 1; }
            #rtt-overlay {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(10, 15, 29, 0.75); backdrop-filter: blur(4px);
                z-index: 99999; display: none; align-items: center; justify-content: center;
                padding: 20px; box-sizing: border-box;
            }
            .rtt-window {
                background: #111827; color: #f3f4f6; width: 100%; max-width: 960px;
                height: 90vh; max-height: 850px; border-radius: 12px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1);
                display: flex; flex-direction: column; overflow: hidden; position: relative;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            }
            .rtt-header {
                background: #1f2937; border-bottom: 1px solid #374151; padding: 14px 20px;
                display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
            }
            .rtt-header-left { display: flex; align-items: center; gap: 12px; }
            .rtt-logo-icon {
                font-size: 26px; background: rgba(225, 29, 72, 0.15); padding: 6px;
                border-radius: 8px; border: 1px solid rgba(225, 29, 72, 0.3);
            }
            .rtt-header-title h3 {
                margin: 0; font-size: 17px; font-weight: 700; color: #ffffff;
                display: flex; align-items: center; gap: 8px;
            }
            .rtt-badge {
                background: #e11d48; color: #ffffff; font-size: 11px; font-weight: 600;
                padding: 2px 8px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px;
            }
            .rtt-header-title p { margin: 3px 0 0 0; font-size: 12px; color: #9ca3af; }
            .rtt-header-actions { display: flex; align-items: center; gap: 8px; }
            .rtt-btn-icon {
                background: #374151; color: #e5e7eb; border: 1px solid #4b5563; border-radius: 6px;
                width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
                cursor: pointer; font-size: 15px; transition: background 0.15s, color 0.15s;
            }
            .rtt-btn-icon:hover { background: #4b5563; color: #ffffff; }
            .rtt-btn-close:hover { background: #e11d48; border-color: #be123c; color: #ffffff; }
            .rtt-scenarios-container {
                background: #182234; border-bottom: 1px solid #2d3748; padding: 10px 16px; flex-shrink: 0;
            }
            .rtt-scenarios-label {
                font-size: 11px; font-weight: 600; text-transform: uppercase; color: #94a3b8;
                margin-bottom: 8px; letter-spacing: 0.5px;
            }
            .rtt-scenarios-list { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
            .rtt-scenarios-list::-webkit-scrollbar { height: 4px; }
            .rtt-scenarios-list::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
            .rtt-scenario-card {
                background: #1e293b; border: 1px solid #334155; color: #f1f5f9; padding: 7px 12px;
                border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
                display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease;
            }
            .rtt-scenario-card:hover { background: #334155; border-color: #64748b; transform: translateY(-1px); }
            .rtt-sc-icon { font-size: 14px; }
            .rtt-chat-body {
                flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column;
                gap: 16px; background: #0f172a;
            }
            .rtt-chat-body::-webkit-scrollbar { width: 6px; }
            .rtt-chat-body::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
            .rtt-welcome-card {
                background: rgba(30, 41, 59, 0.7); border: 1px solid #334155; border-radius: 8px;
                padding: 16px; text-align: center; max-width: 600px; margin: 20px auto;
            }
            .rtt-welcome-icon { font-size: 32px; margin-bottom: 8px; }
            .rtt-welcome-card h4 { margin: 0 0 6px 0; font-size: 15px; color: #f8fafc; }
            .rtt-welcome-card p { margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5; }
            .rtt-message {
                border-radius: 8px; padding: 12px 16px; max-width: 88%; line-height: 1.5;
                font-size: 13px; box-sizing: border-box;
            }
            .rtt-msg-user { align-self: flex-end; background: #2563eb; color: #ffffff; border-bottom-right-radius: 2px; }
            .rtt-msg-assistant {
                align-self: flex-start; background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
                border-bottom-left-radius: 2px;
            }
            .rtt-msg-system {
                align-self: center; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3);
                color: #fca5a5; width: 100%; max-width: 700px;
            }
            .rtt-msg-header { margin-bottom: 6px; font-size: 11px; opacity: 0.8; }
            .rtt-msg-content pre {
                background: #0b1120; border: 1px solid #1e293b; border-radius: 4px; padding: 8px 10px;
                overflow-x: auto; font-size: 12px; font-family: Consolas, Monaco, monospace;
            }
            .rtt-msg-content code {
                background: rgba(0, 0, 0, 0.3); padding: 2px 4px; border-radius: 3px; font-family: Consolas, Monaco, monospace; font-size: 12px;
            }
            .rtt-reasoning-block {
                background: rgba(15, 23, 42, 0.6); border: 1px dashed #475569; border-radius: 4px;
                padding: 8px 10px; margin-bottom: 8px; font-size: 12px;
            }
            .rtt-reasoning-block summary { cursor: pointer; color: #94a3b8; font-weight: 500; }
            .rtt-reasoning-block pre { white-space: pre-wrap; word-break: break-word; color: #cbd5e1; margin: 6px 0 0 0; font-size: 11px; }
            .rtt-action-step { background: #162032; border: 1px solid #2a3a52; border-radius: 6px; padding: 10px 14px; align-self: stretch; font-size: 12px; }
            .rtt-step-running { border-color: #3b82f6; background: rgba(59, 130, 246, 0.08); }
            .rtt-step-success { border-color: #10b981; }
            .rtt-step-error { border-color: #ef4444; }
            .rtt-step-rejected { border-color: #64748b; opacity: 0.7; }
            .rtt-step-header { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #f1f5f9; }
            .rtt-step-cmd {
                background: #090e17; border: 1px solid #1f2d42; border-radius: 4px; padding: 6px 8px;
                margin: 6px 0 0 0; font-family: Consolas, Monaco, monospace; font-size: 11px; color: #38bdf8; overflow-x: auto;
            }
            .rtt-step-output { margin-top: 6px; }
            .rtt-step-output pre {
                background: #06090e; border: 1px solid #172233; border-radius: 4px; padding: 6px 8px;
                margin: 0; font-family: Consolas, Monaco, monospace; font-size: 11px; color: #a5b4fc;
                max-height: 180px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
            }
            .rtt-confirm-card {
                background: #241419; border: 1px solid #be123c; border-radius: 8px; padding: 14px 16px;
                align-self: stretch; box-shadow: 0 4px 14px rgba(190, 18, 60, 0.2);
            }
            .rtt-confirm-header { display: flex; align-items: center; gap: 8px; color: #fda4af; font-size: 14px; margin-bottom: 8px; }
            .rtt-confirm-explanation { color: #fecdd3; font-size: 13px; line-height: 1.5; margin-bottom: 8px; }
            .rtt-confirm-cmd {
                background: #11070a; border: 1px solid #881337; border-radius: 4px; padding: 8px 10px;
                margin: 0 0 12px 0; font-family: Consolas, Monaco, monospace; font-size: 12px; color: #f43f5e; overflow-x: auto;
            }
            .rtt-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
            .rtt-btn { border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
            .rtt-btn-reject { background: #374151; color: #d1d5db; }
            .rtt-btn-reject:hover { background: #4b5563; color: #ffffff; }
            .rtt-btn-accept { background: #10b981; color: #ffffff; }
            .rtt-btn-accept:hover { background: #059669; }
            .rtt-btn-primary { background: #e11d48; color: #ffffff; }
            .rtt-btn-primary:hover { background: #be123c; }
            .rtt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .rtt-footer { background: #1e293b; border-top: 1px solid #334155; padding: 12px 20px; flex-shrink: 0; }
            .rtt-input-wrapper { display: flex; gap: 10px; align-items: flex-end; }
            .rtt-input-wrapper textarea {
                flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 6px;
                color: #f8fafc; padding: 10px 12px; font-size: 13px; resize: none; outline: none;
                font-family: inherit; line-height: 1.4; transition: border-color 0.15s;
            }
            .rtt-input-wrapper textarea:focus { border-color: #e11d48; }
            .rtt-footer-status { margin-top: 6px; font-size: 11px; color: #94a3b8; }
            .rtt-status-busy { color: #38bdf8; animation: rtt-pulse 1.5s infinite; }
            @keyframes rtt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
            .rtt-settings-drawer {
                position: absolute; top: 64px; right: 0; width: 360px; bottom: 0; background: #1f2937;
                border-left: 1px solid #374151; box-shadow: -10px 0 25px rgba(0, 0, 0, 0.5); z-index: 10;
                display: flex; flex-direction: column;
            }
            .rtt-settings-header { padding: 14px 16px; border-bottom: 1px solid #374151; display: flex; align-items: center; justify-content: space-between; }
            .rtt-settings-header h4 { margin: 0; font-size: 14px; color: #ffffff; }
            .rtt-settings-content { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-size: 12px; }
            .rtt-settings-content label { display: flex; flex-direction: column; gap: 4px; color: #d1d5db; font-weight: 500; }
            .rtt-settings-content input[type="text"], .rtt-settings-content input[type="url"], .rtt-settings-content input[type="password"], .rtt-settings-content input[type="number"] {
                background: #111827; border: 1px solid #4b5563; border-radius: 4px; padding: 8px 10px; color: #ffffff; font-size: 13px; outline: none;
            }
            .rtt-settings-content input:focus { border-color: #e11d48; }
            .rtt-settings-row { display: flex; gap: 10px; }
            .rtt-settings-row label { flex: 1; }
            .rtt-checkbox-label { flex-direction: row !important; align-items: center; gap: 8px !important; cursor: pointer; }
            .rtt-settings-actions { margin-top: 10px; display: flex; justify-content: flex-end; }
        `;
        document.head.appendChild(style);

        // 2. Client Controller Logic
        var pendingRequests = new Map();
        var activeNode = null;
        var conversationHistory = [];
        var isProcessing = false;
        var quickScenarios = [];
        var pluginSettings = null;
        var isAdminUser = false;

        function generateId() {
            return 'rtt_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        }

        function encodePowerShell(script) {
            var utf16 = new Uint8Array(script.length * 2);
            for (var i = 0; i < script.length; i++) {
                var code = script.charCodeAt(i);
                utf16[i * 2] = code & 0xff;
                utf16[i * 2 + 1] = code >>> 8;
            }
            var binary = '';
            for (var j = 0; j < utf16.length; j++) binary += String.fromCharCode(utf16[j]);
            return btoa(binary);
        }

        function sendServerAction(pluginaction, data) {
            return new Promise(function (resolve, reject) {
                var reqId = generateId();
                var timer = setTimeout(function () {
                    pendingRequests.delete(reqId);
                    reject(new Error('Таймаут ответа сервера MeshCentral (30 сек)'));
                }, 30000);

                pendingRequests.set(reqId, { resolve: resolve, reject: reject, timer: timer });

                var payload = Object.assign({
                    action: 'plugin',
                    plugin: 'reanimatortt',
                    pluginaction: pluginaction,
                    requestId: reqId
                }, data || {});

                try {
                    if (window.meshserver && typeof window.meshserver.send === 'function') {
                        window.meshserver.send(payload);
                    } else {
                        clearTimeout(timer);
                        pendingRequests.delete(reqId);
                        reject(new Error('Служба meshserver недоступна'));
                    }
                } catch (e) {
                    clearTimeout(timer);
                    pendingRequests.delete(reqId);
                    reject(e);
                }
            });
        }

        function executeRemoteCommand(nodeId, commandText) {
            return new Promise(function (resolve, reject) {
                if (!nodeId) return reject(new Error('Не указан идентификатор узла'));
                var node = (window.getNodeFromId && window.getNodeFromId(nodeId)) || window.currentNode;
                if (node && (node.conn & 1) === 0) {
                    return reject(new Error('Компьютер не подключен (Offline). Проверьте питание и связь.'));
                }

                var attemptId = Math.random().toString(36).substring(2, 10);
                var marker = 'rtt_out_' + attemptId;
                var tempDir = 'C:/Windows/Temp';
                var resultFile = tempDir + '/' + marker + '.json';

                var psBody = [
                    "$ErrorActionPreference = 'Continue';",
                    "$out = @{ stdout = ''; stderr = ''; exit_code = 0; duration_ms = 0 };",
                    "$sw = [System.Diagnostics.Stopwatch]::StartNew();",
                    "try {",
                    "    $res = Invoke-Expression @'\n" + commandText + "\n'@ 2>&1;",
                    "    $sw.Stop();",
                    "    $out.duration_ms = $sw.ElapsedMilliseconds;",
                    "    $stdOutLines = @();",
                    "    $stdErrLines = @();",
                    "    foreach ($item in $res) {",
                    "        if ($item -is [System.Management.Automation.ErrorRecord]) {",
                    "            $stdErrLines += $item.ToString();",
                    "        } else {",
                    "            $stdOutLines += [string]$item;",
                    "        }",
                    "    }",
                    "    $out.stdout = ($stdOutLines -join \"`r`n\");",
                    "    $out.stderr = ($stdErrLines -join \"`r`n\");",
                    "    $out.exit_code = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 };",
                    "} catch {",
                    "    $sw.Stop();",
                    "    $out.duration_ms = $sw.ElapsedMilliseconds;",
                    "    $out.stderr = $_.Exception.ToString();",
                    "    $out.exit_code = 1;",
                    "}",
                    "$json = $out | ConvertTo-Json -Compress;",
                    "[System.IO.File]::WriteAllText('" + resultFile.replace(/\//g, '\\') + "', $json, [System.Text.Encoding]::UTF8);"
                ].join('\r\n');

                var encoded = encodePowerShell(psBody);
                var responseId = 'rtt-run-' + attemptId;
                var redirect = null;
                var settled = false;
                var pollTimer = null;
                var timeoutTimer = null;

                function finish(err, data) {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutTimer);
                    clearInterval(pollTimer);
                    try { if (redirect) redirect.Stop(); } catch (_) { }
                    if (err) reject(err); else resolve(data);
                }

                timeoutTimer = setTimeout(function () {
                    finish(new Error('Таймаут выполнения команды на компьютере (60 сек)'));
                }, 60000);

                if (typeof CreateRemoteFiles !== 'function' || typeof CreateAgentRedirect !== 'function') {
                    try {
                        window.meshserver.send({
                            action: 'runcommands',
                            nodeids: [nodeId],
                            type: 1,
                            runAsUser: 0,
                            cmds: 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + encoded,
                            responseid: responseId
                        });
                        return finish(null, {
                            stdout: 'Команда отправлена на выполнение',
                            stderr: '',
                            exit_code: 0
                        });
                    } catch (e) {
                        return finish(e);
                    }
                }

                var downloadId = Math.floor(Math.random() * 1000000000);
                var downloading = false;
                var chunks = [];
                var totalSize = 0;

                var protocol = CreateRemoteFiles(
                    function (raw) {
                        var m = raw;
                        try { if (typeof m === 'string') m = JSON.parse(m); } catch (e) { return; }
                        if (!m) return;
                        if (Number(m.reqid) === 88 && Array.isArray(m.dir)) {
                            var hit = m.dir.some(function (f) { return f.n === marker + '.json'; });
                            if (hit && !downloading) {
                                downloading = true;
                                redirect.sendText(JSON.stringify({ action: 'download', sub: 'start', id: downloadId, path: resultFile }));
                            }
                        } else if (m.action === 'download' && String(m.id) === String(downloadId)) {
                            if (m.sub === 'start') {
                                redirect.sendText(JSON.stringify({ action: 'download', sub: 'startack', id: downloadId }));
                            } else if (m.sub === 'cancel') {
                                finish(new Error('Не удалось прочитать файл результата'));
                            }
                        }
                    },
                    function (data) {
                        var b = (typeof data === 'string')
                            ? Uint8Array.from(data, function (c) { return c.charCodeAt(0) & 255; })
                            : (data instanceof ArrayBuffer) ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

                        if (b.length < 4) return finish(new Error('Некорректный блок данных'));
                        totalSize += b.length - 4;
                        chunks.push(b.slice(4));

                        if (b[3] & 1) {
                            var all = new Uint8Array(totalSize);
                            var pos = 0;
                            chunks.forEach(function (c) { all.set(c, pos); pos += c.length; });
                            var jsonStr = new TextDecoder('utf-8').decode(all);

                            try {
                                redirect.sendText(JSON.stringify({ action: 'rm', reqid: 89, path: tempDir, delfiles: [marker + '.json'], rec: false }));
                            } catch (_) { }

                            try {
                                var parsedResult = JSON.parse(jsonStr);
                                finish(null, parsedResult);
                            } catch (e) {
                                finish(new Error('Ошибка разбора JSON: ' + e.message));
                            }
                        } else {
                            redirect.sendText(JSON.stringify({ action: 'download', sub: 'ack', id: downloadId }));
                        }
                    }
                );

                try {
                    redirect = CreateAgentRedirect(window.meshserver, protocol, window.serverPublicNamePort, window.authCookie, window.authRelayCookie, window.domainUrl);
                    redirect.onStateChanged = function (x, state) {
                        if (state === 3) {
                            try {
                                window.meshserver.send({
                                    action: 'runcommands',
                                    nodeids: [nodeId],
                                    type: 1,
                                    runAsUser: 0,
                                    cmds: 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + encoded,
                                    responseid: responseId
                                });
                                function query() {
                                    if (settled || downloading) return;
                                    redirect.sendText(JSON.stringify({ action: 'ls', reqid: 88, path: tempDir }));
                                }
                                query();
                                pollTimer = setInterval(query, 2000);
                            } catch (e) {
                                finish(new Error('Ошибка отправки: ' + e.message));
                            }
                        } else if (state === 0 && !settled) {
                            finish(new Error('Файловый канал соединения прерван'));
                        }
                    };
                    redirect.Start(nodeId);
                } catch (e) {
                    finish(new Error('Не удалось открыть канал связи: ' + e.message));
                }
            });
        }

        function createModal() {
            if (document.getElementById('rtt-overlay')) return;
            var overlay = document.createElement('div');
            overlay.id = 'rtt-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.innerHTML = `
                <div class="rtt-window">
                  <header class="rtt-header">
                    <div class="rtt-header-left">
                      <span class="rtt-logo-icon">🚑</span>
                      <div class="rtt-header-title">
                        <h3>Реаниматор ТТ <span class="rtt-badge">ИИ-агент</span></h3>
                        <p id="rtt-device-info">Загрузка данных компьютера...</p>
                      </div>
                    </div>
                    <div class="rtt-header-actions">
                      <button id="rtt-btn-settings" class="rtt-btn-icon" title="Настройки API ИИ" type="button">⚙️</button>
                      <button id="rtt-btn-clear" class="rtt-btn-icon" title="Очистить историю диалога" type="button">🗑️</button>
                      <button id="rtt-btn-close" class="rtt-btn-icon rtt-btn-close" title="Закрыть" type="button">✕</button>
                    </div>
                  </header>
                  <div class="rtt-scenarios-container">
                    <div class="rtt-scenarios-label">Быстрые сценарии ТТ:</div>
                    <div id="rtt-scenarios-list" class="rtt-scenarios-list"></div>
                  </div>
                  <div id="rtt-chat-body" class="rtt-chat-body">
                    <div class="rtt-welcome-card">
                      <div class="rtt-welcome-icon">🏥</div>
                      <h4>Аварийно-восстановительный комплекс «Реаниматор ТТ»</h4>
                      <p>ИИ-агент готов к диагностике и ремонту аптечного узла <strong>без передачи файлов</strong> на компьютер. Выберите быстрый сценарий выше или опишите проблему своими словами.</p>
                    </div>
                  </div>
                  <footer class="rtt-footer">
                    <div class="rtt-input-wrapper">
                      <textarea id="rtt-input" rows="2" placeholder="Опишите проблему (например: «Кассир не может пробить чек, зависает 1С» или «Не печатает чек, проверь службу АТОЛ»)..."></textarea>
                      <button id="rtt-btn-send" class="rtt-btn rtt-btn-primary" type="button">
                        <span>Отправить</span> ➔
                      </button>
                    </div>
                    <div class="rtt-footer-status" id="rtt-footer-status">Готов к работе</div>
                  </footer>
                  <div id="rtt-settings-drawer" class="rtt-settings-drawer" style="display:none;">
                    <div class="rtt-settings-header">
                      <h4>Настройки ИИ «Реаниматор ТТ»</h4>
                      <button id="rtt-settings-close" type="button" class="rtt-btn-icon">✕</button>
                    </div>
                    <div class="rtt-settings-content">
                      <label>Base URL API (OpenAI-совместимый)<input id="rtt-cfg-url" type="url" placeholder="https://ai.starimg.ru/v1"></label>
                      <label>API Key<input id="rtt-cfg-key" type="password" placeholder="sk-..."></label>
                      <label>Модель<input id="rtt-cfg-model" type="text" placeholder="gpt-6-luna"></label>
                      <div class="rtt-settings-row">
                        <label>Таймаут (сек)<input id="rtt-cfg-timeout" type="number" min="10" max="300" value="60"></label>
                        <label>Температура<input id="rtt-cfg-temp" type="number" min="0" max="1" step="0.1" value="0.2"></label>
                      </div>
                      <label class="rtt-checkbox-label">
                        <input id="rtt-cfg-confirm" type="checkbox" checked>
                        <span>Запрашивать подтверждение перед изменением системы</span>
                      </label>
                      <div class="rtt-settings-actions">
                        <button id="rtt-cfg-save" class="rtt-btn rtt-btn-primary" type="button">Сохранить</button>
                      </div>
                    </div>
                  </div>
                </div>
            `;
            ['keydown', 'keypress', 'keyup'].forEach(function (t) {
                overlay.addEventListener(t, function (e) { e.stopPropagation(); });
            });
            document.body.appendChild(overlay);

            document.getElementById('rtt-btn-close').onclick = closeModal;
            document.getElementById('rtt-btn-clear').onclick = clearConversation;
            document.getElementById('rtt-btn-settings').onclick = toggleSettings;
            document.getElementById('rtt-settings-close').onclick = toggleSettings;
            document.getElementById('rtt-cfg-save').onclick = saveSettingsFromUI;
            document.getElementById('rtt-btn-send').onclick = handleUserSend;

            var inputArea = document.getElementById('rtt-input');
            inputArea.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleUserSend();
                }
            });

            loadQuickScenarios();
            loadSettingsIntoUI();
        }

        function toggleSettings() {
            var drawer = document.getElementById('rtt-settings-drawer');
            if (drawer) drawer.style.display = (drawer.style.display === 'none') ? 'block' : 'none';
        }

        function loadSettingsIntoUI() {
            sendServerAction('getSettings').then(function (res) {
                if (res && res.settings) {
                    pluginSettings = res.settings;
                    isAdminUser = !!res.isAdmin;
                    var urlInput = document.getElementById('rtt-cfg-url');
                    var keyInput = document.getElementById('rtt-cfg-key');
                    var modelInput = document.getElementById('rtt-cfg-model');
                    var timeoutInput = document.getElementById('rtt-cfg-timeout');
                    var tempInput = document.getElementById('rtt-cfg-temp');
                    var confirmInput = document.getElementById('rtt-cfg-confirm');

                    if (urlInput) urlInput.value = res.settings.baseUrl || '';
                    if (keyInput) keyInput.value = res.settings.apiKey || '';
                    if (modelInput) modelInput.value = res.settings.model || '';
                    if (timeoutInput) timeoutInput.value = res.settings.timeoutSeconds || 60;
                    if (tempInput) tempInput.value = res.settings.temperature || 0.2;
                    if (confirmInput) confirmInput.checked = res.settings.requireDangerConfirmation !== false;

                    if (!isAdminUser) {
                        var saveBtn = document.getElementById('rtt-cfg-save');
                        if (saveBtn) {
                            saveBtn.disabled = true;
                            saveBtn.title = 'Только администратор MeshCentral может изменять настройки';
                        }
                    }
                }
            }).catch(function (e) { console.warn('[ReanimatorTT] loadSettings error:', e.message); });
        }

        function saveSettingsFromUI() {
            var urlInput = document.getElementById('rtt-cfg-url');
            var keyInput = document.getElementById('rtt-cfg-key');
            var modelInput = document.getElementById('rtt-cfg-model');
            var timeoutInput = document.getElementById('rtt-cfg-timeout');
            var tempInput = document.getElementById('rtt-cfg-temp');
            var confirmInput = document.getElementById('rtt-cfg-confirm');

            var newCfg = {
                baseUrl: urlInput ? urlInput.value.trim() : '',
                apiKey: keyInput ? keyInput.value.trim() : '',
                model: modelInput ? modelInput.value.trim() : '',
                timeoutSeconds: timeoutInput ? parseInt(timeoutInput.value, 10) : 60,
                temperature: tempInput ? parseFloat(tempInput.value) : 0.2,
                requireDangerConfirmation: confirmInput ? confirmInput.checked : true
            };

            sendServerAction('saveSettings', { settings: newCfg }).then(function (res) {
                if (res && res.success) {
                    alert('Настройки Реаниматор ТТ успешно сохранены.');
                    toggleSettings();
                } else {
                    alert('Ошибка сохранения настроек.');
                }
            }).catch(function (e) { alert('Ошибка: ' + e.message); });
        }

        function loadQuickScenarios() {
            sendServerAction('getQuickScenarios').then(function (res) {
                if (res && Array.isArray(res.scenarios)) {
                    quickScenarios = res.scenarios;
                    renderQuickScenarios();
                }
            }).catch(function (e) { console.warn('[ReanimatorTT] loadQuickScenarios error:', e.message); });
        }

        function renderQuickScenarios() {
            var list = document.getElementById('rtt-scenarios-list');
            if (!list) return;
            list.innerHTML = '';
            quickScenarios.forEach(function (sc) {
                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'rtt-scenario-card';
                card.innerHTML = '<span class="rtt-sc-icon">' + sc.icon + '</span><span class="rtt-sc-title">' + sc.title + '</span>';
                card.title = sc.description;
                card.onclick = function () { if (!isProcessing) startScenario(sc); };
                list.appendChild(card);
            });
        }

        function startScenario(sc) {
            var inputArea = document.getElementById('rtt-input');
            if (inputArea) inputArea.value = sc.prompt;
            handleUserSend();
        }

        function appendMessage(role, text, reasoning) {
            var body = document.getElementById('rtt-chat-body');
            if (!body) return;
            var msgEl = document.createElement('div');
            msgEl.className = 'rtt-message rtt-msg-' + role;
            var header = document.createElement('div');
            header.className = 'rtt-msg-header';
            header.innerHTML = (role === 'user') ? '<strong>Оператор ТТ</strong>' : '<strong>🚑 Реаниматор ТТ (ИИ)</strong>';
            msgEl.appendChild(header);

            if (reasoning) {
                var rBlock = document.createElement('details');
                rBlock.className = 'rtt-reasoning-block';
                rBlock.innerHTML = '<summary>Ход рассуждений ИИ</summary><pre>' + escapeHtml(reasoning) + '</pre>';
                msgEl.appendChild(rBlock);
            }

            var textBlock = document.createElement('div');
            textBlock.className = 'rtt-msg-content';
            textBlock.innerHTML = formatMarkdown(text);
            msgEl.appendChild(textBlock);

            body.appendChild(msgEl);
            body.scrollTop = body.scrollHeight;
            return msgEl;
        }

        function appendActionStep(title, command, status) {
            var body = document.getElementById('rtt-chat-body');
            if (!body) return;
            var stepEl = document.createElement('div');
            stepEl.className = 'rtt-action-step rtt-step-' + (status || 'running');
            stepEl.innerHTML = [
                '<div class="rtt-step-header">',
                '  <span class="rtt-step-spinner">⚙️</span>',
                '  <span class="rtt-step-title">' + escapeHtml(title) + '</span>',
                '</div>',
                command ? '<pre class="rtt-step-cmd"><code>' + escapeHtml(command) + '</code></pre>' : '',
                '<div class="rtt-step-output" style="display:none;"><pre></pre></div>'
            ].join('\n');
            body.appendChild(stepEl);
            body.scrollTop = body.scrollHeight;
            return stepEl;
        }

        function updateActionStep(stepEl, status, outputText) {
            if (!stepEl) return;
            stepEl.className = 'rtt-action-step rtt-step-' + status;
            var spinner = stepEl.querySelector('.rtt-step-spinner');
            if (spinner) spinner.textContent = (status === 'success') ? '✅' : (status === 'error') ? '❌' : '⚠️';
            if (outputText) {
                var outDiv = stepEl.querySelector('.rtt-step-output');
                var outPre = stepEl.querySelector('.rtt-step-output pre');
                if (outDiv && outPre) {
                    outPre.textContent = outputText.slice(-4000);
                    outDiv.style.display = 'block';
                }
            }
            var body = document.getElementById('rtt-chat-body');
            if (body) body.scrollTop = body.scrollHeight;
        }

        function requestCommandConfirmation(command, explanation, dangerLevel) {
            return new Promise(function (resolve) {
                var body = document.getElementById('rtt-chat-body');
                if (!body) return resolve(false);
                var card = document.createElement('div');
                card.className = 'rtt-confirm-card rtt-danger-' + (dangerLevel || 'medium');
                card.innerHTML = [
                    '<div class="rtt-confirm-header"><span class="rtt-confirm-icon">⚠️</span><strong>Требуется подтверждение исправления</strong></div>',
                    '<div class="rtt-confirm-explanation">' + escapeHtml(explanation) + '</div>',
                    '<pre class="rtt-confirm-cmd"><code>' + escapeHtml(command) + '</code></pre>',
                    '<div class="rtt-confirm-actions">',
                    '  <button class="rtt-btn rtt-btn-reject" type="button">Отклонить</button>',
                    '  <button class="rtt-btn rtt-btn-accept" type="button">Применить исправление</button>',
                    '</div>'
                ].join('\n');
                body.appendChild(card);
                body.scrollTop = body.scrollHeight;

                card.querySelector('.rtt-btn-reject').onclick = function () { card.remove(); resolve(false); };
                card.querySelector('.rtt-btn-accept').onclick = function () { card.remove(); resolve(true); };
            });
        }

        function setStatus(text, isBusy) {
            var el = document.getElementById('rtt-footer-status');
            if (el) {
                el.textContent = text;
                el.className = 'rtt-footer-status' + (isBusy ? ' rtt-status-busy' : '');
            }
        }

        async function processTurn() {
            if (!activeNode) return;
            isProcessing = true;
            var sendBtn = document.getElementById('rtt-btn-send');
            if (sendBtn) sendBtn.disabled = true;

            var deviceCtx = {
                name: activeNode.name || activeNode._id,
                id: activeNode._id,
                ip: activeNode.ip || '',
                os: activeNode.os || activeNode.osdesc || 'Windows',
                isOnline: (activeNode.conn & 1) !== 0
            };

            var maxTurns = 20, turnCount = 0;
            try {
                while (turnCount < maxTurns) {
                    turnCount++;
                    setStatus('Реаниматор ТТ анализирует ситуацию...', true);
                    var res = await sendServerAction('chatTurn', { messages: conversationHistory, deviceContext: deviceCtx, useTools: true });
                    if (res.type === 'chatError') {
                        appendMessage('system', '❌ Ошибка ИИ: ' + res.error);
                        break;
                    }

                    var msg = res.message;
                    var toolCalls = msg.tool_calls || [];
                    var content = msg.content || '';
                    var reasoning = msg.reasoning || '';

                    if (content || reasoning) {
                        appendMessage('assistant', content || 'Выполняю диагностику...', reasoning);
                        conversationHistory.push({ role: 'assistant', content: content, reasoning_content: reasoning, tool_calls: toolCalls.length ? toolCalls : undefined });
                    } else if (toolCalls.length) {
                        conversationHistory.push({ role: 'assistant', content: '', tool_calls: toolCalls });
                    }

                    if (!toolCalls.length) break;

                    for (var i = 0; i < toolCalls.length; i++) {
                        var tc = toolCalls[i];
                        var fnName = tc.function.name;
                        var args = {};
                        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { }

                        var toolOutput = '', cmdToRun = args.command || '';
                        if (fnName === 'run_readonly_cmd') {
                            var stepEl = appendActionStep('Диагностика: ' + (args.purpose || cmdToRun), cmdToRun, 'running');
                            setStatus('Выполняется диагностика на кассе: ' + cmdToRun.slice(0, 40) + '...', true);
                            try {
                                var cmdRes = await executeRemoteCommand(activeNode._id, cmdToRun);
                                toolOutput = (cmdRes.stdout || '') + (cmdRes.stderr ? '\nSTDERR: ' + cmdRes.stderr : '');
                                updateActionStep(stepEl, cmdRes.exit_code === 0 ? 'success' : 'error', toolOutput || '(вывод пуст)');
                            } catch (e) {
                                toolOutput = 'Ошибка выполнения: ' + e.message;
                                updateActionStep(stepEl, 'error', toolOutput);
                            }
                        } else if (fnName === 'execute_system_command') {
                            var requireConfirm = pluginSettings ? pluginSettings.requireDangerConfirmation !== false : true;
                            var approved = true;
                            if (requireConfirm) {
                                setStatus('Ожидание подтверждения оператора...', false);
                                approved = await requestCommandConfirmation(cmdToRun, args.explanation, args.danger_level);
                            }

                            if (approved) {
                                var stepEl2 = appendActionStep('Исправление: ' + cmdToRun, cmdToRun, 'running');
                                setStatus('Применение исправления на компьютере...', true);
                                try {
                                    var cmdRes2 = await executeRemoteCommand(activeNode._id, cmdToRun);
                                    toolOutput = (cmdRes2.stdout || '') + (cmdRes2.stderr ? '\nSTDERR: ' + cmdRes2.stderr : '');
                                    updateActionStep(stepEl2, cmdRes2.exit_code === 0 ? 'success' : 'error', toolOutput || 'Команда успешно выполнена');
                                } catch (e) {
                                    toolOutput = 'Ошибка применения: ' + e.message;
                                    updateActionStep(stepEl2, 'error', toolOutput);
                                }
                            } else {
                                appendActionStep('Оператор отклонил команду: ' + cmdToRun, null, 'rejected');
                                toolOutput = 'Оператор отклонил выполнение этой команды.';
                            }
                        } else {
                            toolOutput = 'Неизвестный инструмент: ' + fnName;
                        }

                        conversationHistory.push({ role: 'tool', tool_call_id: tc.id, content: toolOutput || '(пустой ответ)' });
                    }
                }
            } catch (err) {
                appendMessage('system', '❌ Ошибка цикла ИИ: ' + err.message);
            } finally {
                isProcessing = false;
                setStatus('Готов к работе', false);
                if (sendBtn) sendBtn.disabled = false;
            }
        }

        function handleUserSend() {
            if (isProcessing) return;
            var inputArea = document.getElementById('rtt-input');
            if (!inputArea) return;
            var text = inputArea.value.trim();
            if (!text) return;
            inputArea.value = '';
            appendMessage('user', text);
            conversationHistory.push({ role: 'user', content: text });
            processTurn();
        }

        function clearConversation() {
            conversationHistory = [];
            var body = document.getElementById('rtt-chat-body');
            if (body) {
                body.innerHTML = `
                    <div class="rtt-welcome-card">
                      <div class="rtt-welcome-icon">🏥</div>
                      <h4>История очищена</h4>
                      <p>ИИ-агент готов к новому сеансу диагностики на компьютере <strong>${escapeHtml((activeNode && activeNode.name) || '')}</strong>.</p>
                    </div>
                `;
            }
            setStatus('Диалог очищен', false);
        }

        function openModal(node) {
            activeNode = node || window.currentNode;
            if (!activeNode || !activeNode._id) {
                alert('Пожалуйста, выберите компьютер в MeshCentral.');
                return;
            }
            createModal();
            var overlay = document.getElementById('rtt-overlay');
            if (overlay) overlay.style.display = 'flex';
            var infoEl = document.getElementById('rtt-device-info');
            if (infoEl) {
                var statusStr = ((activeNode.conn & 1) !== 0) ? '🟢 В сети' : '🔴 Не в сети';
                infoEl.textContent = (activeNode.name || activeNode._id) + ' (' + (activeNode.ip || 'IP неизвестен') + ') · ' + statusStr + ' · ' + (activeNode.os || 'Windows');
            }
            clearConversation();
        }

        function closeModal() {
            var overlay = document.getElementById('rtt-overlay');
            if (overlay) overlay.style.display = 'none';
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        function formatMarkdown(str) {
            if (!str) return '';
            var s = escapeHtml(str);
            s = s.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
            s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
            s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            s = s.replace(/\n/g, '<br>');
            return s;
        }

        function injectButton() {
            var target = document.getElementById('p10info');
            if (!target) {
                target = document.getElementById('p10buttons') || document.getElementById('p10html3');
            }

            if (target && !document.getElementById('rtt-btn-open-status')) {
                var btn = document.createElement('button');
                btn.id = 'rtt-btn-open-status';
                btn.type = 'button';
                btn.className = 'rtt-btn-status-open';
                btn.innerHTML = '<span class="rtt-btn-icon-span">🚑</span> Реаниматор ТТ (ИИ)';
                btn.title = 'Запуск автономного ИИ-агента диагностики и восстановления аптеки без передачи файлов';
                btn.onclick = function () {
                    openModal(window.currentNode);
                };

                // Place in the same button bar next to Zabbix or Restic
                var lastBtn = document.getElementById('restic-open') || document.getElementById('zabbix-open');
                if (lastBtn && lastBtn.parentNode === target) {
                    target.insertBefore(btn, lastBtn.nextSibling);
                } else if (target.firstChild) {
                    target.insertBefore(btn, target.firstChild);
                } else {
                    target.appendChild(btn);
                }
            }

            var bar = document.getElementById('devListToolbar') || document.getElementById('devicesButtonBar');
            if (bar && !document.getElementById('rtt-bulk-open')) {
                var bulkBtn = document.createElement('input');
                bulkBtn.type = 'button';
                bulkBtn.id = 'rtt-bulk-open';
                bulkBtn.value = '🚑 Реаниматор ТТ';
                bulkBtn.title = 'Запустить ИИ Реаниматор на текущем компьютере';
                bulkBtn.onclick = function () {
                    openModal(window.currentNode);
                };
                var groupBtn = document.getElementById('GroupActionButton') || document.getElementById('sr-open');
                if (groupBtn && groupBtn.parentNode === bar) {
                    bar.insertBefore(bulkBtn, groupBtn.nextSibling);
                } else {
                    bar.appendChild(bulkBtn);
                }
            }
        }

        window.ReanimatorTT = {
            inject: injectButton,
            open: openModal,
            close: closeModal,
            receive: function (message) {
                if (!message || !message.requestId) return;
                var p = pendingRequests.get(message.requestId);
                if (p) {
                    pendingRequests.delete(message.requestId);
                    clearTimeout(p.timer);
                    if (message.error) p.reject(new Error(message.error));
                    else p.resolve(message);
                }
            }
        };

        injectButton();
        setInterval(injectButton, 2000);
    };

    obj.onDeviceRefreshEnd = function () {
        if (window.ReanimatorTT && typeof window.ReanimatorTT.inject === 'function') {
            window.ReanimatorTT.inject();
        }
    };

    obj.onReanimatorMessage = function (srv, message) {
        const m = message || srv;
        if (window.ReanimatorTT && typeof window.ReanimatorTT.receive === 'function') {
            window.ReanimatorTT.receive(m);
        }
    };

    obj.normalizeModelName = normalizeModelName;
    return obj;
}

module.exports = create;
module.exports.reanimatortt = create;
module.exports.normalizeModelName = normalizeModelName;
