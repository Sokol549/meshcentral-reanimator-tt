'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

const PLUGIN_VERSION = '1.0.0';

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
            // chatTurn handles multi-step AI dialogue with tool calling
            const incomingMessages = Array.isArray(cmd.messages) ? cmd.messages : [];
            const deviceContext = cmd.deviceContext || null;
            const useTools = cmd.useTools !== false;

            // Build full messages payload with system prompt if not present
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

                // Clean <think>...</think> tags if reasoning was embedded in content
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
            // Pre-defined one-click pharmacy emergency recipes
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

    // Route registration for UI assets
    function registerRoutes(app) {
        if (!app || app._reanimatorTtRoutesRegistered) return false;
        app._reanimatorTtRoutesRegistered = true;

        const publicDir = path.join(__dirname, 'public');

        app.get('/plugin/reanimatortt/reanimatortt.js', function (req, res) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.sendFile(path.join(publicDir, 'reanimatortt.js'));
        });

        app.get('/plugin/reanimatortt/reanimatortt.css', function (req, res) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.sendFile(path.join(publicDir, 'reanimatortt.css'));
        });

        // Ensure routes are inserted high enough in Express router stack
        if (app._router && Array.isArray(app._router.stack)) {
            const stack = app._router.stack;
            const layers = [];
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].route && String(stack[i].route.path).startsWith('/plugin/reanimatortt/')) {
                    layers.unshift(stack.splice(i, 1)[0]);
                }
            }
            stack.splice(2, 0, ...layers);
        }
        return true;
    }

    obj.hook_setupHttpHandlers = function (webserver) {
        return registerRoutes(webserver && (webserver.app || webserver));
    };

    obj.server_startup = function () {
        let attempts = 0;
        function retry() {
            const app = server.app || (server.webserver && server.webserver.app);
            if (!registerRoutes(app) && ++attempts < 30) {
                setTimeout(retry, 1000);
            }
        }
        retry();
    };

    // Pre-template injection: add link and script to HTML
    obj.hook_processTemplateHttpPre = function (template, req) {
        try {
            if (typeof template === 'string') {
                const tags = [
                    '<link rel="stylesheet" type="text/css" href="/plugin/reanimatortt/reanimatortt.css?v=' + PLUGIN_VERSION + '">',
                    '<script type="text/javascript" src="/plugin/reanimatortt/reanimatortt.js?v=' + PLUGIN_VERSION + '"></script>'
                ].join('\n');

                if (template.indexOf('</head>') !== -1) {
                    return template.replace('</head>', tags + '\n</head>');
                } else if (template.indexOf('</body>') !== -1) {
                    return template.replace('</body>', tags + '\n</body>');
                }
            }
        } catch (e) {
            console.warn('[ReanimatorTT] template injection error:', e.message);
        }
        return template;
    };

    // WebUI hooks
    obj.onWebUIStartupEnd = function () {
        if (typeof document !== 'undefined' && !document.getElementById('reanimatortt-loader')) {
            const s = document.createElement('script');
            s.id = 'reanimatortt-loader';
            s.src = '/plugin/reanimatortt/reanimatortt.js?v=' + PLUGIN_VERSION;
            document.head.appendChild(s);

            const c = document.createElement('link');
            c.id = 'reanimatortt-style';
            c.rel = 'stylesheet';
            c.href = '/plugin/reanimatortt/reanimatortt.css?v=' + PLUGIN_VERSION;
            document.head.appendChild(c);
        }
    };

    obj.onDeviceRefreshEnd = function () {
        if (typeof window !== 'undefined' && window.ReanimatorTT && typeof window.ReanimatorTT.inject === 'function') {
            window.ReanimatorTT.inject();
        }
    };

    obj.onReanimatorMessage = function (srv, message) {
        const m = message || srv;
        if (typeof window !== 'undefined' && window.ReanimatorTT && typeof window.ReanimatorTT.receive === 'function') {
            window.ReanimatorTT.receive(m);
        }
    };

    obj.normalizeModelName = normalizeModelName;
    return obj;
}

module.exports = create;
module.exports.reanimatortt = create;
module.exports.normalizeModelName = normalizeModelName;
