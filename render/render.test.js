import { test, mock, beforeEach, afterEach } from 'node:test';
const doc = global.document = {
    createElement() { },
    createElementNS() { },
    createTextNode() { },
};
beforeEach(() => {
    mock.method(doc, 'createElement', function (...args) {
        console.log('createElement', args);
    });
    mock.method(doc, 'createElementNS', function (...args) {
        console.log('createElementNS', args);
    });
    mock.method(doc, 'createTextNode', function (...args) {
        console.log('createTextNode', args);
    });
});
afterEach(() => {
    console.log({ doc: doc.createElement.mock.calls });
});
test('a', function () { });
test('b', function () { });
test('c', function () { });
test('d', function () { });
