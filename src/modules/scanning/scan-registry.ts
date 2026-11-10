import { ScanOrchestrator } from './scan-orchestrator';

/**
 * Süreç genelinde tek aktif scan. İki scan'in aynı anda Unity API'yi
 * yoklaması rate limit'i tetiklediği için ikinci istek reddedilir.
 * globalThis üzerinde tutulur ki dev modda modül yeniden yüklense de kaybolmasın.
 */
interface ActiveScan {
  orchestrator: ScanOrchestrator;
  startedAt: Date;
}

const KEY = '__ucb_active_scan__';
const g = globalThis as unknown as Record<string, ActiveScan | undefined>;

export function getActiveScan(): ActiveScan | null {
  return g[KEY] ?? null;
}

export function registerActiveScan(orchestrator: ScanOrchestrator): boolean {
  if (g[KEY]) return false;
  g[KEY] = { orchestrator, startedAt: new Date() };
  return true;
}

export function clearActiveScan(orchestrator: ScanOrchestrator): void {
  if (g[KEY]?.orchestrator === orchestrator) {
    delete g[KEY];
  }
}
