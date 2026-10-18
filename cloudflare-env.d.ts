declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    IMPORT_QUEUE?: Queue<{id:string}|{cleanup:string[]}>;
    CONVERTER_URL?: string;
    CONVERTER_SECRET?: string;
    AI_API_KEY?: string;
    AI_MODEL?: string;
    PUBLIC_ORIGIN?: string;
    SPEECH_SERVICE_URL?: string;
    SPEECH_SERVICE_SECRET?: string;
  }
}
