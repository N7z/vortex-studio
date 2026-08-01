import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { uniqueName, verifyIdentity, verifyName } from '../src/identity.js';

const SECRET = 'shared-with-laravel';

const sign = (name, exp, secret = SECRET) => {
    const encoded = Buffer.from(name, 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${encoded}.${exp}`).digest('hex');

    return `${encoded}.${exp}.${sig}`;
};

const soon = () => Math.floor(Date.now() / 1000) + 300;

test('accepts a token signed with the shared secret', () => {
    assert.equal(verifyName(sign('zpaulin', soon()), SECRET), 'zpaulin');
});

test('rejects a forged signature', () => {
    assert.equal(verifyName(sign('zpaulin', soon(), 'wrong-secret'), SECRET), null);
});

test('rejects a name swapped into a valid signature', () => {
    const token = sign('guest', soon());
    const [, exp, sig] = token.split('.');
    const forged = `${Buffer.from('zpaulin').toString('base64url')}.${exp}.${sig}`;
    assert.equal(verifyName(forged, SECRET), null);
});

test('rejects an expired token', () => {
    assert.equal(verifyName(sign('zpaulin', Math.floor(Date.now() / 1000) - 1), SECRET), null);
});

test('rejects junk and missing input', () => {
    for (const bad of [null, undefined, '', 'a.b', 'a.b.c.d', 'a.b.c', 42, {}]) {
        assert.equal(verifyName(bad, SECRET), null);
    }
});

test('verifies nothing when no secret is configured', () => {
    assert.equal(verifyName(sign('zpaulin', soon()), ''), null);
});

test('trims and caps the name', () => {
    assert.equal(verifyName(sign('  spaced   out  ', soon()), SECRET), 'spaced out');
    assert.equal(verifyName(sign('x'.repeat(80), soon()), SECRET).length, 32);
    assert.equal(verifyName(sign('   ', soon()), SECRET), null);
});

test('uniqueName steps aside for a name already in the room', () => {
    assert.equal(uniqueName('zpaulin', new Set()), 'zpaulin');
    assert.equal(uniqueName('zpaulin', new Set(['zpaulin'])), 'zpaulin (2)');
    assert.equal(uniqueName('zpaulin', new Set(['zpaulin', 'zpaulin (2)'])), 'zpaulin (3)');
});

const v2 = (over = {}) => JSON.stringify({
    v: 2, u: 7, n: 'Ada', m: 'castle', t: 3, r: 'editor', ...over,
});

test('a v2 token carries the account, map and role', () => {
    assert.deepEqual(verifyIdentity(sign(v2(), soon()), SECRET), {
        userId: 7, name: 'Ada', mapName: 'castle', teamId: 3, role: 'editor',
    });
});

test('a v1 token still proves the name and claims nothing else', () => {
    assert.deepEqual(verifyIdentity(sign('Ada', soon()), SECRET), {
        userId: null, name: 'Ada', mapName: null, teamId: null, role: null,
    });
});

test('an expired v2 token is refused', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    assert.equal(verifyIdentity(sign(v2(), past), SECRET), null);
});

test('an unknown role is dropped rather than trusted', () => {
    assert.equal(verifyIdentity(sign(v2({ r: 'admin' }), soon()), SECRET).role, null);
});

test('a tampered v2 payload is refused', () => {
    const token = sign(v2(), soon());
    const broken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    assert.equal(verifyIdentity(broken, SECRET), null);
});
