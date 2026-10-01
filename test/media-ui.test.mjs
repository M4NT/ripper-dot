import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isImage, downloadName, fileApiUrl, fileHref } from '../web/src/media.js';

describe('media helpers (web)', () => {
  it('isImage reconhece tipos comuns', () => {
    assert.equal(isImage('image/png'), true);
    assert.equal(isImage('image/jpeg'), true);
    assert.equal(isImage('application/pdf'), false);
    assert.equal(isImage(''), false);
  });

  it('downloadName remove caracteres perigosos', () => {
    assert.equal(downloadName('foto legal.png'), 'foto legal.png');
    assert.equal(downloadName('a/b\\c'), 'a_b_c');
  });

  it('fileApiUrl e fileHref', () => {
    assert.equal(fileApiUrl('abc'), '/api/files/abc');
    assert.equal(fileApiUrl(''), '');
    assert.equal(fileHref({ id: 'x' }), '/api/files/x');
    assert.equal(fileHref({ url: '/blob' }), '/blob');
  });
});
