export const b2Config = {
  keyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
  bucketId: process.env.B2_BUCKET_ID,
  bucketName: process.env.B2_BUCKET_NAME
};

if (!b2Config.keyId || !b2Config.applicationKey || !b2Config.bucketId || !b2Config.bucketName) {
  console.warn("WARNING: Backblaze B2 environment variables are missing! Movie operations will fail.");
}
