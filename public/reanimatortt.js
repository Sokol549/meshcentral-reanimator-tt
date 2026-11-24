(function () {
    'use strict';

    if (window.ReanimatorTT) return;

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
        for (var j = 0; j < utf16.length; j++) {
            binary += String.fromCharCode(utf16[j]);
        }
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

    // Zero-file command execution engine via native MeshCentral remote files & command channel
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

            // Safe wrapper script that executes command in memory and writes output to temporary JSON file
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

            // Step 1: Open remote files channel to monitor result and download output
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
                // Fallback: send command fire-and-forget if file channel is not exposed
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
                        stdout: 'Команда отправлена на выполнение (файловый канал вывода недоступен)',
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

                    // Directory listing poll response
                    if (Number(m.reqid) === 88 && Array.isArray(m.dir)) {
                        var hit = m.dir.some(function (f) { return f.n === marker + '.json'; });
                        if (hit && !downloading) {
                            downloading = true;
                            // Request download of result
                            redirect.sendText(JSON.stringify({
                                action: 'download',
                                sub: 'start',
                                id: downloadId,
                                path: resultFile
                            }));
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
                    // Binary handler for downloaded file
                    var b = (typeof data === 'string')
                        ? Uint8Array.from(data, function (c) { return c.charCodeAt(0) & 255; })
                        : (data instanceof ArrayBuffer) ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

                    if (b.length < 4) return finish(new Error('Некорректный блок данных'));
                    totalSize += b.length - 4;
                    chunks.push(b.slice(4));

                    if (b[3] & 1) {
                        // End of file
                        var all = new Uint8Array(totalSize);
                        var pos = 0;
                        chunks.forEach(function (c) { all.set(c, pos); pos += c.length; });
                        var jsonStr = new TextDecoder('utf-8').decode(all);

                        // Cleanup temporary JSON file immediately (Zero trace)
                        try {
                            redirect.sendText(JSON.stringify({
                                action: 'rm',
                                reqid: 89,
                                path: tempDir,
                                delfiles: [marker + '.json'],
                                rec: false
                            }));
                        } catch (_) { }

                        try {
                            var parsedResult = JSON.parse(jsonStr);
                            finish(null, parsedResult);
                        } catch (e) {
                            finish(new Error('Ошибка разбора JSON результата: ' + e.message));
                        }
                    } else {
                        redirect.sendText(JSON.stringify({ action: 'download', sub: 'ack', id: downloadId }));
                    }
                }
            );

            try {
                redirect = CreateAgentRedirect(
                    window.meshserver,
                    protocol,
                    window.serverPublicNamePort,
                    window.authCookie,
                    window.authRelayCookie,
                    window.domainUrl
                );

                redirect.onStateChanged = function (x, state) {
                    if (state === 3) {
                        // Channel connected, send the command
                        try {
                            window.meshserver.send({
                                action: 'runcommands',
                                nodeids: [nodeId],
                                type: 1,
                                runAsUser: 0,
                                cmds: 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + encoded,
                                responseid: responseId
                            });

                            // Poll for result file every 2 seconds
                            function query() {
                                if (settled || downloading) return;
                                redirect.sendText(JSON.stringify({ action: 'ls', reqid: 88, path: tempDir }));
                            }
                            query();
                            pollTimer = setInterval(query, 2000);
                        } catch (e) {
                            finish(new Error('Ошибка отправки команды: ' + e.message));
                        }
                    } else if (state === 0 && !settled) {
                        finish(new Error('Файловый канал соединения с узлом прерван'));
                    }
                };

                redirect.Start(nodeId);
            } catch (e) {
                finish(new Error('Не удалось открыть канал связи с узлом: ' + e.message));
            }
        });
    }

    // Modal UI Management
    function createModal() {
        if (document.getElementById('rtt-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'rtt-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = [
            '<div class="rtt-window">',
            '  <header class="rtt-header">',
            '    <div class="rtt-header-left">',
            '      <span class="rtt-logo-icon">🚑</span>',
            '      <div class="rtt-header-title">',
            '        <h3>Реаниматор ТТ <span class="rtt-badge">ИИ-агент</span></h3>',
            '        <p id="rtt-device-info">Загрузка данных компьютера...</p>',
            '      </div>',
            '    </div>',
            '    <div class="rtt-header-actions">',
            '      <button id="rtt-btn-settings" class="rtt-btn-icon" title="Настройки API ИИ" type="button">⚙️</button>',
            '      <button id="rtt-btn-clear" class="rtt-btn-icon" title="Очистить историю диалога" type="button">🗑️</button>',
            '      <button id="rtt-btn-close" class="rtt-btn-icon rtt-btn-close" title="Закрыть" type="button">✕</button>',
            '    </div>',
            '  </header>',
            '',
            '  <!-- Quick Scenarios Bar -->',
            '  <div class="rtt-scenarios-container">',
            '    <div class="rtt-scenarios-label">Быстрые сценарии ТТ:</div>',
            '    <div id="rtt-scenarios-list" class="rtt-scenarios-list"></div>',
            '  </div>',
            '',
            '  <!-- Main Chat / Timeline Area -->',
            '  <div id="rtt-chat-body" class="rtt-chat-body">',
            '    <div class="rtt-welcome-card">',
            '      <div class="rtt-welcome-icon">🏥</div>',
            '      <h4>Аварийно-восстановительный комплекс «Реаниматор ТТ»</h4>',
            '      <p>ИИ-агент готов к диагностике и ремонту аптечного узла <strong>без передачи файлов</strong> на компьютер. Выберите быстрый сценарий выше или опишите проблему своими словами.</p>',
            '    </div>',
            '  </div>',
            '',
            '  <!-- Footer Input Area -->',
            '  <footer class="rtt-footer">',
            '    <div class="rtt-input-wrapper">',
            '      <textarea id="rtt-input" rows="2" placeholder="Опишите проблему (например: «Кассир не может пробить чек, зависает 1С» или «Не печатает чек, проверь службу АТОЛ»)..."></textarea>',
            '      <button id="rtt-btn-send" class="rtt-btn rtt-btn-primary" type="button">',
            '        <span>Отправить</span> ➔',
            '      </button>',
            '    </div>',
            '    <div class="rtt-footer-status" id="rtt-footer-status">Готов к работе</div>',
            '  </footer>',
            '',
            '  <!-- Settings Drawer / Modal -->',
            '  <div id="rtt-settings-drawer" class="rtt-settings-drawer" style="display:none;">',
            '    <div class="rtt-settings-header">',
            '      <h4>Настройки ИИ «Реаниматор ТТ»</h4>',
            '      <button id="rtt-settings-close" type="button" class="rtt-btn-icon">✕</button>',
            '    </div>',
            '    <div class="rtt-settings-content">',
            '      <label>Base URL API (OpenAI-совместимый)<input id="rtt-cfg-url" type="url" placeholder="https://ai.starimg.ru/v1"></label>',
            '      <label>API Key<input id="rtt-cfg-key" type="password" placeholder="sk-..."></label>',
            '      <label>Модель<input id="rtt-cfg-model" type="text" placeholder="gpt-6-luna"></label>',
            '      <div class="rtt-settings-row">',
            '        <label>Таймаут (сек)<input id="rtt-cfg-timeout" type="number" min="10" max="300" value="60"></label>',
            '        <label>Температура<input id="rtt-cfg-temp" type="number" min="0" max="1" step="0.1" value="0.2"></label>',
            '      </div>',
            '      <label class="rtt-checkbox-label">',
            '        <input id="rtt-cfg-confirm" type="checkbox" checked>',
            '        <span>Запрашивать подтверждение перед изменением системы</span>',
            '      </label>',
            '      <div class="rtt-settings-actions">',
            '        <button id="rtt-cfg-save" class="rtt-btn rtt-btn-primary" type="button">Сохранить</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join('\n');

        // Prevent MeshCentral key listeners from capturing typing
        ['keydown', 'keypress', 'keyup'].forEach(function (t) {
            overlay.addEventListener(t, function (e) {
                e.stopPropagation();
            });
        });

        document.body.appendChild(overlay);

        // Bind events
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
        if (drawer) {
            drawer.style.display = (drawer.style.display === 'none') ? 'block' : 'none';
        }
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
                        saveBtn.title = 'Только администратор MeshCentral может менять настройки';
                    }
                }
            }
        }).catch(function (e) {
            console.warn('[ReanimatorTT] Не удалось загрузить настройки:', e.message);
        });
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
        }).catch(function (e) {
            alert('Ошибка: ' + e.message);
        });
    }

    function loadQuickScenarios() {
        sendServerAction('getQuickScenarios').then(function (res) {
            if (res && Array.isArray(res.scenarios)) {
                quickScenarios = res.scenarios;
                renderQuickScenarios();
            }
        }).catch(function (e) {
            console.warn('[ReanimatorTT] Ошибка получения сценариев:', e.message);
        });
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
            card.onclick = function () {
                if (isProcessing) return;
                startScenario(sc);
            };
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
        header.innerHTML = (role === 'user')
            ? '<strong>Оператор ТТ</strong>'
            : '<strong>🚑 Реаниматор ТТ (ИИ)</strong>';

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
        if (spinner) {
            spinner.textContent = (status === 'success') ? '✅' : (status === 'error') ? '❌' : '⚠️';
        }
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
                '<div class="rtt-confirm-header">',
                '  <span class="rtt-confirm-icon">⚠️</span>',
                '  <strong>Требуется подтверждение исправления</strong>',
                '</div>',
                '<div class="rtt-confirm-explanation">' + escapeHtml(explanation) + '</div>',
                '<pre class="rtt-confirm-cmd"><code>' + escapeHtml(command) + '</code></pre>',
                '<div class="rtt-confirm-actions">',
                '  <button class="rtt-btn rtt-btn-reject" type="button">Отклонить</button>',
                '  <button class="rtt-btn rtt-btn-accept" type="button">Применить исправление</button>',
                '</div>'
            ].join('\n');

            body.appendChild(card);
            body.scrollTop = body.scrollHeight;

            var rejectBtn = card.querySelector('.rtt-btn-reject');
            var acceptBtn = card.querySelector('.rtt-btn-accept');

            rejectBtn.onclick = function () {
                card.remove();
                resolve(false);
            };

            acceptBtn.onclick = function () {
                card.remove();
                resolve(true);
            };
        });
    }

    function setStatus(text, isBusy) {
        var el = document.getElementById('rtt-footer-status');
        if (el) {
            el.textContent = text;
            el.className = 'rtt-footer-status' + (isBusy ? ' rtt-status-busy' : '');
        }
    }

    // Process a full AI turn with possible autonomous multi-step tool calls
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

        var maxTurns = 20;
        var turnCount = 0;

        try {
            while (turnCount < maxTurns) {
                turnCount++;
                setStatus('Реаниматор ТТ анализирует ситуацию...', true);

                var res = await sendServerAction('chatTurn', {
                    messages: conversationHistory,
                    deviceContext: deviceCtx,
                    useTools: true
                });

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
                    conversationHistory.push({
                        role: 'assistant',
                        content: content,
                        reasoning_content: reasoning,
                        tool_calls: toolCalls.length ? toolCalls : undefined
                    });
                } else if (toolCalls.length) {
                    conversationHistory.push({
                        role: 'assistant',
                        content: '',
                        tool_calls: toolCalls
                    });
                }

                if (!toolCalls.length) {
                    // Turn complete, model gave final answer
                    break;
                }

                // Execute tool calls autonomously on target computer
                for (var i = 0; i < toolCalls.length; i++) {
                    var tc = toolCalls[i];
                    var fnName = tc.function.name;
                    var args = {};
                    try {
                        args = JSON.parse(tc.function.arguments || '{}');
                    } catch (_) { }

                    var toolOutput = '';
                    var cmdToRun = args.command || '';

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

                    // Feed tool result back to dialogue
                    conversationHistory.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: toolOutput || '(пустой ответ)'
                    });
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
            body.innerHTML = [
                '<div class="rtt-welcome-card">',
                '  <div class="rtt-welcome-icon">🏥</div>',
                '  <h4>История очищена</h4>',
                '  <p>ИИ-агент готов к новому сеансу диагностики на компьютере <strong>' + escapeHtml((activeNode && activeNode.name) || '') + '</strong>.</p>',
                '</div>'
            ].join('\n');
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
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatMarkdown(str) {
        if (!str) return '';
        var s = escapeHtml(str);
        // Code blocks
        s = s.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // Inline code
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italic
        s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // Newlines to br
        s = s.replace(/\n/g, '<br>');
        return s;
    }

    // Button injection into MeshCentral Computer Status view (#p10info / #p10buttons)
    function injectButton() {
        // Find computer details / status container in MeshCentral
        var target = document.getElementById('p10info');
        if (!target) {
            // Alternative targets in device view
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

            // Place prominently at the top of device status info
            if (target.firstChild) {
                target.insertBefore(btn, target.firstChild);
            } else {
                target.appendChild(btn);
            }
        }

        // Also add to device list toolbar if available
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

    // Public API
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

    // Auto-inject and setup periodic check
    injectButton();
    setInterval(injectButton, 2500);

})();
