'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const pluginFactory = require('../reanimatortt');

console.log('--- Запуск тестов test-backend.js ---');

// Mock MeshCentral parent server object
const mockDataPath = path.join(__dirname, 'mock_datapath');
if (!fs.existsSync(mockDataPath)) fs.mkdirSync(mockDataPath, { recursive: true });

const mockServer = {
    datapath: mockDataPath,
    app: {
        _router: { stack: [] },
        get: function (route, handler) {
            this.routes = this.routes || {};
            this.routes[route] = handler;
        }
    }
};

const plugin = pluginFactory({ meshServer: mockServer });

// Test 1: Plugin metadata and exports
assert(Array.isArray(plugin.exports), 'plugin.exports must be an array');
assert(plugin.exports.includes('onWebUIStartupEnd'), 'Must export onWebUIStartupEnd');
assert(plugin.exports.includes('onDeviceRefreshEnd'), 'Must export onDeviceRefreshEnd');
assert(plugin.exports.includes('onReanimatorMessage'), 'Must export onReanimatorMessage');
console.log('✓ Тест 1: Экспортируемые хуки проверены');

// Test 2: HTTP routes registration
const routesRegistered = plugin.hook_setupHttpHandlers(mockServer.app);
assert(routesRegistered, 'HTTP routes must register successfully');
console.log('✓ Тест 2: HTTP роуты зарегистрированы');

// Test 3: Pre-template injection
const sampleHtml = '<html><head><title>MeshCentral</title></head><body>Content</body></html>';
const injectedHtml = plugin.hook_processTemplateHttpPre(sampleHtml, {});
assert(injectedHtml.includes('/plugin/reanimatortt/reanimatortt.js'), 'HTML template must contain reanimatortt.js');
assert(injectedHtml.includes('/plugin/reanimatortt/reanimatortt.css'), 'HTML template must contain reanimatortt.css');
console.log('✓ Тест 3: Инъекция в шаблон HTML проверена');

// Test 4: Settings retrieval for Admin vs Regular User
let lastClientMsg = null;
const adminClient = {
    user: { _id: 'user/admin', siteadmin: 0xFFFFFFFF },
    send: (msg) => { lastClientMsg = JSON.parse(msg); }
};

const regularClient = {
    user: { _id: 'user/pharmacy1', siteadmin: 0 },
    send: (msg) => { lastClientMsg = JSON.parse(msg); }
};

// Admin getSettings
plugin.serveraction({ pluginaction: 'saveSettings', requestId: 'save_admin', settings: { apiKey: 'sk-test-1234567890abcdef1234567890abcdef' } }, adminClient);
plugin.serveraction({ pluginaction: 'getSettings', requestId: 'req_1' }, adminClient);
assert(lastClientMsg !== null, 'Client should receive response');
assert.strictEqual(lastClientMsg.type, 'settings');
assert.strictEqual(lastClientMsg.isAdmin, true);
assert.strictEqual(lastClientMsg.settings.apiKey, 'sk-test-1234567890abcdef1234567890abcdef', 'Admin gets full API key');
assert.strictEqual(lastClientMsg.kbLoaded, true, 'Knowledge base should be loaded');
console.log('✓ Тест 4a: Получение настроек администратором проверено');

// Regular user getSettings
plugin.serveraction({ pluginaction: 'getSettings', requestId: 'req_2' }, regularClient);
assert.strictEqual(lastClientMsg.isAdmin, false);
assert(lastClientMsg.settings.apiKey.includes('...'), 'Regular user must see masked API key');
console.log('✓ Тест 4b: Маскирование ключа API для обычного пользователя проверено');

// Test 5: Quick scenarios list
plugin.serveraction({ pluginaction: 'getQuickScenarios', requestId: 'req_3' }, adminClient);
assert.strictEqual(lastClientMsg.type, 'quickScenarios');
assert(Array.isArray(lastClientMsg.scenarios), 'Scenarios must be an array');
assert(lastClientMsg.scenarios.length >= 6, 'Must contain at least 6 pharmacy scenarios');
const ids = lastClientMsg.scenarios.map(s => s.id);
assert(ids.includes('express_diag'), 'Must include express_diag');
assert(ids.includes('1c_emergency'), 'Must include 1c_emergency');
assert(ids.includes('atol_eou'), 'Must include atol_eou');
assert(ids.includes('print_spooler'), 'Must include print_spooler');
assert(ids.includes('disk_cleanup'), 'Must include disk_cleanup');
assert(ids.includes('network_vpn'), 'Must include network_vpn');
console.log('✓ Тест 5: Быстрые сценарии для аптек проверены');

// Test 6: Model name normalization in config
assert.strictEqual(typeof plugin.serveraction, 'function', 'plugin.serveraction must be a function');
assert.strictEqual(typeof plugin.normalizeModelName, 'function', 'normalizeModelName must be exported or functional');

// Cleanup
try {
    const testSettingsFile = path.join(mockDataPath, 'reanimatortt-settings.json');
    if (fs.existsSync(testSettingsFile)) fs.unlinkSync(testSettingsFile);
    fs.rmdirSync(mockDataPath);
} catch (_) {}

console.log('✓ ВСЕ ТЕСТЫ В test-backend.js УСПЕШНО ПРОЙДЕНЫ!');
