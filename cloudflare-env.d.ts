declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PUBLIC_ORIGIN?: string;
    SPEECH_SERVICE_URL?: string;
    SPEECH_SERVICE_SECRET?: string;
  }
}
