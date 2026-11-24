'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const pluginFactory = require('../reanimatortt');

console.log('--- Запуск тестов test-tools.js ---');

const mockDataPath = path.join(__dirname, 'mock_datapath_tools');
if (!fs.existsSync(mockDataPath)) fs.mkdirSync(mockDataPath, { recursive: true });

// Start a local mock OpenAI-compatible server to test LLM call mechanics
let mockServerReceived = null;
let mockServerResponse = {
    choices: [
        {
            index: 0,
            message: {
                role: 'assistant',
                content: 'Провожу проверку службы EoUService',
                tool_calls: [
                    {
                        id: 'call_12345',
                        type: 'function',
                        function: {
                            name: 'run_readonly_cmd',
                            arguments: JSON.stringify({
                                command: 'Get-Service EoUService | Select Status, StartType',
                                purpose: 'Проверка службы кассы АТОЛ'
                            })
                        }
                    }
                ]
            },
            finish_reason: 'tool_calls'
        }
    ]
};

const mockHttpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        mockServerReceived = {
            url: req.url,
            method: req.method,
            headers: req.headers,
            body: JSON.parse(body)
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockServerResponse));
    });
});

mockHttpServer.listen(0, '127.0.0.1', () => {
    const port = mockHttpServer.address().port;
    const testBaseUrl = 'http://127.0.0.1:' + port + '/v1';

    const plugin = pluginFactory({
        meshServer: {
            datapath: mockDataPath,
            app: { _router: { stack: [] }, get: () => {} }
        }
    });

    const adminClient = {
        user: { _id: 'user/admin', siteadmin: -1 },
        send: (msg) => { lastClientMsg = JSON.parse(msg); }
    };
    let lastClientMsg = null;

    // Save test settings pointing to local mock server
    plugin.serveraction({
        pluginaction: 'saveSettings',
        requestId: 'req_save',
        settings: {
            baseUrl: testBaseUrl,
            apiKey: 'test-key-12345',
            model: 'chatgpt6-luna', // should normalize to gpt-6-luna
            timeoutSeconds: 15
        }
    }, adminClient);

    // Test 1: Chat turn with LLM invocation and tool call return
    plugin.serveraction({
        pluginaction: 'chatTurn',
        requestId: 'req_chat_1',
        messages: [{ role: 'user', content: 'Касса АТОЛ не отправляет чеки в ОФД' }],
        deviceContext: { name: 'Аптека-42-Касса-1', id: 'node/test/1', os: 'Windows 10' }
    }, adminClient);

    // Wait for async response from mock HTTP
    setTimeout(() => {
        try {
            assert(mockServerReceived !== null, 'Mock LLM server should have received request');
            assert.strictEqual(mockServerReceived.method, 'POST');
            assert.strictEqual(mockServerReceived.url, '/v1/chat/completions');
            assert.strictEqual(mockServerReceived.headers.authorization, 'Bearer test-key-12345');
            assert.strictEqual(mockServerReceived.body.model, 'gpt-6-luna', 'Model name should be normalized to gpt-6-luna');
            assert(Array.isArray(mockServerReceived.body.tools), 'Tools should be defined');
            assert(mockServerReceived.body.tools.some(t => t.function.name === 'run_readonly_cmd'), 'Must include run_readonly_cmd');
            assert(mockServerReceived.body.tools.some(t => t.function.name === 'execute_system_command'), 'Must include execute_system_command');

            // Verify system prompt contains pharmacy instructions
            const sysMsg = mockServerReceived.body.messages.find(m => m.role === 'system');
            assert(sysMsg, 'System prompt must be injected');
            assert(sysMsg.content.includes('Реаниматор ТТ'), 'System prompt must identify as Reanimator TT');
            assert(sysMsg.content.includes('Аптека-42-Касса-1'), 'System prompt must contain device context');
            assert(sysMsg.content.includes('EoUService') || sysMsg.content.includes('1С'), 'System prompt must include pharmacy KB');

            // Verify response sent to client
            assert(lastClientMsg !== null, 'Client should receive response');
            assert.strictEqual(lastClientMsg.type, 'chatResponse');
            assert.strictEqual(lastClientMsg.message.role, 'assistant');
            assert(Array.isArray(lastClientMsg.message.tool_calls), 'tool_calls must be present');
            assert.strictEqual(lastClientMsg.message.tool_calls[0].function.name, 'run_readonly_cmd');

            console.log('✓ Тест 1: Интеграция с LLM и вызов инструментов проверен успешно');

            // Cleanup
            mockHttpServer.close();
            try {
                const testSettingsFile = path.join(mockDataPath, 'reanimatortt-settings.json');
                if (fs.existsSync(testSettingsFile)) fs.unlinkSync(testSettingsFile);
                fs.rmdirSync(mockDataPath);
            } catch (_) {}

            console.log('✓ ВСЕ ТЕСТЫ В test-tools.js УСПЕШНО ПРОЙДЕНЫ!');
        } catch (e) {
            mockHttpServer.close();
            console.error('Ошибка в test-tools.js:', e);
            process.exit(1);
        }
    }, 500);
});
