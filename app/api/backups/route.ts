import { backupError, exportBackup, startBackupUpload } from '../../../lib/server/backups';

export async function GET(req: Request) { try { return await exportBackup(req); } catch (error) { return backupError(error); } }
export async function POST(req: Request) { try { return await startBackupUpload(req); } catch (error) { return backupError(error); } }
