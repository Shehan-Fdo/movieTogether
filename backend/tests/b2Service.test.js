import test from 'node:test';
import assert from 'node:assert';
import { b2Service } from '../src/services/b2Service.js';

test('B2Service authorization success', async (t) => {
  const originalFetch = globalThis.fetch;
  
  globalThis.fetch = async (url, options) => {
    if (url === 'https://api.backblazeb2.com/b2api/v3/b2_authorize_account') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accountId: 'test-account-id',
          authorizationToken: 'test-token',
          apiInfo: {
            storageApi: {
              apiUrl: 'https://api-test.backblazeb2.com',
              downloadUrl: 'https://download-test.backblazeb2.com',
              recommendedPartSize: 5000000
            }
          }
        })
      };
    }
    return originalFetch(url, options);
  };

  b2Service.token = null;
  b2Service.apiUrl = null;
  b2Service.downloadUrl = null;
  b2Service.tokenExpiry = null;

  const authData = await b2Service.authorize();
  assert.strictEqual(authData.token, 'test-token');
  assert.strictEqual(authData.apiUrl, 'https://api-test.backblazeb2.com');
  assert.strictEqual(authData.downloadUrl, 'https://download-test.backblazeb2.com');

  globalThis.fetch = originalFetch;
});
