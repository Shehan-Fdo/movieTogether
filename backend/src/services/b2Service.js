import { b2Config } from '../config/b2.js';
import crypto from 'crypto';

class B2Service {
  constructor() {
    this.token = null;
    this.apiUrl = null;
    this.downloadUrl = null;
    this.accountId = null;
    this.recommendedPartSize = 100 * 1024 * 1024; // default 100MB
    this.tokenExpiry = null;
  }

  async authorize() {
    // If token exists and has not expired (within 20 hours to be safe)
    if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return {
        token: this.token,
        apiUrl: this.apiUrl,
        downloadUrl: this.downloadUrl,
        accountId: this.accountId,
        recommendedPartSize: this.recommendedPartSize
      };
    }

    const credentials = Buffer.from(`${b2Config.keyId}:${b2Config.applicationKey}`).toString('base64');
    const response = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
      headers: {
        'Authorization': `Basic ${credentials}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`B2 Authorization failed: ${errText}`);
    }

    const data = await response.json();
    this.token = data.authorizationToken;
    const storageApi = data.apiInfo.storageApi;
    this.apiUrl = storageApi.apiUrl;
    this.downloadUrl = storageApi.downloadUrl;
    this.accountId = data.accountId;
    this.recommendedPartSize = storageApi.recommendedPartSize;
    // Set expiry to 20 hours from now
    this.tokenExpiry = Date.now() + 20 * 60 * 60 * 1000;

    return {
      token: this.token,
      apiUrl: this.apiUrl,
      downloadUrl: this.downloadUrl,
      accountId: this.accountId,
      recommendedPartSize: this.recommendedPartSize
    };
  }

  // Wrapper that handles auto-reauthorization on 401
  async callAPI(endpointPath, body = {}, method = 'POST') {
    let { token, apiUrl } = await this.authorize();
    
    let url = `${apiUrl}/b2api/v3/${endpointPath}`;
    let headers = {
      'Authorization': token,
      'Content-Type': 'application/json'
    };

    let response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body)
    });

    if (response.status === 401) {
      this.token = null;
      ({ token, apiUrl } = await this.authorize());
      url = `${apiUrl}/b2api/v3/${endpointPath}`;
      headers['Authorization'] = token;
      response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body)
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`B2 API Error (${endpointPath}): ${errText}`);
    }

    return response.json();
  }

  async listFiles() {
    const data = await this.callAPI('b2_list_file_names', {
      bucketId: b2Config.bucketId,
      maxFileCount: 100
    });
    return data.files;
  }

  async startLargeFile(fileName, contentType = 'video/mp4') {
    const data = await this.callAPI('b2_start_large_file', {
      bucketId: b2Config.bucketId,
      fileName,
      contentType
    });
    return data.fileId;
  }

  async getUploadPartUrl(fileId) {
    return this.callAPI('b2_get_upload_part_url', { fileId });
  }

  async uploadPart(uploadUrl, uploadAuthToken, partNumber, partBuffer) {
    const sha1 = crypto.createHash('sha1').update(partBuffer).digest('hex');
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': uploadAuthToken,
        'X-Bz-Part-Number': partNumber.toString(),
        'Content-Length': partBuffer.length.toString(),
        'X-Bz-Content-Sha1': sha1
      },
      body: partBuffer
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`B2 Part Upload failed (Part ${partNumber}): ${errText}`);
    }

    const data = await response.json();
    return {
      partNumber: data.partNumber,
      contentSha1: data.contentSha1
    };
  }

  async finishLargeFile(fileId, partSha1Array) {
    return this.callAPI('b2_finish_large_file', {
      fileId,
      partSha1Array
    });
  }

  async cancelLargeFile(fileId) {
    return this.callAPI('b2_cancel_large_file', { fileId });
  }

  async getDownloadAuthorization(fileNamePrefix, validDurationInSeconds = 28800) {
    const data = await this.callAPI('b2_get_download_authorization', {
      bucketId: b2Config.bucketId,
      fileNamePrefix,
      validDurationInSeconds
    });
    return data.authorizationToken;
  }

  async deleteFileByName(fileName) {
    const data = await this.callAPI('b2_list_file_names', {
      bucketId: b2Config.bucketId,
      startFileName: fileName,
      maxFileCount: 1
    });
    
    if (data.files && data.files.length > 0 && data.files[0].fileName === fileName) {
      const fileId = data.files[0].fileId;
      return this.callAPI('b2_delete_file_version', {
        fileName,
        fileId
      });
    } else {
      throw new Error(`File ${fileName} not found in bucket`);
    }
  }
}

export const b2Service = new B2Service();
