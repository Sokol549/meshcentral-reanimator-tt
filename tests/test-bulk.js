'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const pluginFactory = require('../reanimatortt');

console.log('--- Запуск тестов test-bulk.js (Массовый режим и таймауты) ---');

const mockDataPath = path.join(__dirname, 'mock_datapath_bulk');
if (fs.existsSync(mockDataPath)) fs.rmSync(mockDataPath, { recursive: true, force: true });
fs.mkdirSync(mockDataPath, { recursive: true });

const mockServer = {
    datapath: mockDataPath,
    app: {
        _router: { stack: [] },
        get: function (route, handler) {}
    }
};

const plugin = pluginFactory({ meshServer: mockServer });

// Test 1: Configuration of cmdTimeoutSeconds
let lastClientMsg = null;
const adminClient = {
    user: { _id: 'user/admin', siteadmin: 0xFFFFFFFF },
    send: (msg) => { lastClientMsg = JSON.parse(msg); }
};

// 1a. Default cmdTimeoutSeconds is 180
plugin.serveraction({ pluginaction: 'getSettings', requestId: 'req_cfg' }, adminClient);
assert.strictEqual(lastClientMsg.settings.cmdTimeoutSeconds, 180, 'Default cmdTimeoutSeconds must be 180');
console.log('✓ Тест 1a: Базовый таймаут команд ПК равен 180 сек');

// 1b. Update cmdTimeoutSeconds valid
plugin.serveraction({
    pluginaction: 'saveSettings',
    requestId: 'req_save',
    settings: { cmdTimeoutSeconds: 300 }
}, adminClient);
plugin.serveraction({ pluginaction: 'getSettings', requestId: 'req_cfg2' }, adminClient);
assert.strictEqual(lastClientMsg.settings.cmdTimeoutSeconds, 300, 'cmdTimeoutSeconds should be updated to 300');
console.log('✓ Тест 1b: Сохранение корректного таймаута команд (300 сек) проверено');

// 1c. Out-of-bounds rejection (e.g. 5 seconds or 1000 seconds)
plugin.serveraction({
    pluginaction: 'saveSettings',
    requestId: 'req_save_invalid',
    settings: { cmdTimeoutSeconds: 5 } // below min 15
}, adminClient);
plugin.serveraction({ pluginaction: 'getSettings', requestId: 'req_cfg3' }, adminClient);
assert.strictEqual(lastClientMsg.settings.cmdTimeoutSeconds, 300, 'Out-of-bounds value must not overwrite valid config');
console.log('✓ Тест 1c: Валидация граничных значений таймаута команд подтверждена');

// Test 2: Client code inspection for Bulk Mode features
const clientCode = plugin.onWebUIStartupEnd.toString();
assert(clientCode.includes('openBulkModal'), 'Client code must define openBulkModal');
assert(clientCode.includes('rtt-bulk-open'), 'Client code must handle rtt-bulk-open button');
assert(clientCode.includes('rtt-bulk-panel'), 'Client code must contain rtt-bulk-panel UI');
assert(clientCode.includes('standardScenarioScripts'), 'Client code must contain standardScenarioScripts');
assert(clientCode.includes('openBulk: openBulkModal'), 'window.ReanimatorTT must export openBulk');
console.log('✓ Тест 2: Присутствие компонентов массового режима в коде клиента проверено');

// Test 3: Standard scenario scripts verification
assert(clientCode.includes('express_diag'), 'Must contain express_diag script');
assert(clientCode.includes('print_spooler'), 'Must contain print_spooler script');
assert(clientCode.includes('clean_disk'), 'Must contain clean_disk script');
assert(clientCode.includes('network_diag'), 'Must contain network_diag script');
assert(clientCode.includes('atol_eou'), 'Must contain atol_eou script');
assert(clientCode.includes('1c_emergency'), 'Must contain 1c_emergency script');
console.log('✓ Тест 3: Шаблоны сценариев для аптек в массовом режиме проверены');

// Test 4: Simulation of openBulkModal in browser environment
const domElements = {};
const mockHead = { appendChild: () => {} };
const mockBody = {
    appendChild: (el) => { domElements[el.id || 'body_child'] = el; },
    addEventListener: () => {}
};

const mockWindow = {
    currentNode: null,
    getCheckedDevices: () => ['node//a1', 'node//a2'],
    getNodeFromId: (id) => {
        if (id === 'node//a1') return { _id: 'node//a1', name: 'Касса 1', conn: 1, ip: '192.168.1.10' };
        if (id === 'node//a2') return { _id: 'node//a2', name: 'Касса 2', conn: 0, ip: '192.168.1.11' };
        return null;
    },
    meshserver: { send: () => {} }
};

// Test isolation: run in simulated browser context
const vm = require('vm');
const context = {
    window: mockWindow,
    document: {
        head: mockHead,
        body: mockBody,
        createElement: (tag) => ({
            tagName: tag,
            style: {},
            className: '',
            appendChild: () => {},
            addEventListener: () => {},
            setAttribute: () => {}
        }),
        getElementById: (id) => domElements[id] || null
    },
    console: console,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval
};
vm.createContext(context);

// Run onWebUIStartupEnd in context
vm.runInContext('(' + clientCode + ')()', context);

assert(context.window.ReanimatorTT, 'window.ReanimatorTT must be defined in window');
assert.strictEqual(typeof context.window.ReanimatorTT.openBulk, 'function', 'openBulk must be a function');
console.log('✓ Тест 4: Инициализация window.ReanimatorTT.openBulk в браузере прошла успешно');

console.log('--- ВСЕ ТЕСТЫ В test-bulk.js УСПЕШНО ПРОЙДЕНЫ! ---');
process.exit(0);
