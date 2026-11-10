import { UnityCloudBuildService, isFatal } from '@/modules/api/unity-cloud-build';
import { ApiError, CancelledError, describeWait } from '@/modules/api/api-client';
import { CredentialManager } from '@/modules/config/credential-manager';
import { DatabaseService } from '@/modules/database/database-service';
import { DEFAULT_CACHE_MAX_AGE_MS } from '@/modules/config/cache-config';
import { ScanOptions, ScanProgress, ProjectScanResult, ScanSummary, UnityProject, ProjectScanData } from '@/types';
import type { WaitInfo } from '@/modules/api/api-client';

type LogLevel = 'info' | 'warning' | 'error' | 'success';
type LogCallback = (level: LogLevel, message: string, source?: string) => void;

export interface ProjectRef {
  projectId: string;
  projectName: string;
  description?: string;
}

/** Job sistemi gibi dış takipçiler için adım adım kancalar */
export interface ScanHooks {
  onProjectsListed?: (projects: ProjectRef[]) => Promise<void> | void;
  /** Org geneli taramada her build sayfası alındığında */
  onPage?: (page: number, totalPages: number, fetched: number, total: number) => Promise<void> | void;
  onProjectStart?: (project: ProjectRef, pass: number, maxPasses: number) => Promise<void> | void;
  onProjectResult?: (result: ProjectScanResult, pass: number) => Promise<void> | void;
  onWait?: (info: WaitInfo) => Promise<void> | void;
  onPassCooldown?: (pass: number, maxPasses: number, waitMs: number) => Promise<void> | void;
}

/** Varsayılan geçiş sayısı: 1 ana tarama + 2 yeniden deneme */
const DEFAULT_MAX_PASSES = 3;
/** Yeniden deneme geçişlerinden önce soğuma süresi */
const RETRY_PASS_COOLDOWN_MS = 60_000;

export class ScanOrchestrator {
  private isScanning = false;
  private shouldCancel = false;
  private currentProgress: ScanProgress;
  private onProgressUpdate?: (progress: ScanProgress) => void;
  private onLogUpdate?: LogCallback;

  constructor() {
    this.currentProgress = {
      currentProject: 0,
      totalProjects: 0,
      currentProjectName: '',
      currentTarget: 0,
      totalTargets: 0,
      isScanning: false,
      canCancel: false
    };
  }

  setProgressCallback(callback: (progress: ScanProgress) => void): void {
    this.onProgressUpdate = callback;
  }

  setLogCallback(callback: LogCallback): void {
    this.onLogUpdate = callback;
  }

  /**
   * Tüm projeleri tarar. Tamamlanamayan projeler (rate limit, geçici hata)
   * sonraki geçişlerde yeniden denenir; scan ancak her proje tamamlandığında
   * ya da geçiş hakkı bittiğinde biter. Sonuçta hangi projelerin eksik kaldığı
   * açıkça raporlanır.
   */
  async startScan(options: ScanOptions = {}, hooks: ScanHooks = {}): Promise<{
    results: ProjectScanResult[];
    summary: ScanSummary;
  }> {
    if (this.isScanning) {
      throw new Error('Zaten bir scan işlemi devam ediyor');
    }

    const credentials = options.credentials || CredentialManager.getCredentials();
    if (!credentials) {
      throw new Error('Unity Cloud Build credentials bulunamadı');
    }

    this.isScanning = true;
    this.shouldCancel = false;

    const unityService = this.createService(credentials.orgId, credentials.apiKey, hooks.onWait);
    const db = DatabaseService.getInstance();
    const limitTargets = options.limitTargets || credentials.limitTargets;
    const maxPasses = Math.max(1, options.maxPasses ?? DEFAULT_MAX_PASSES);
    const cacheMaxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS;

    this.log('info', 'Scan işlemi başlatılıyor...');
    this.log('info', `ORG_ID=${credentials.orgId}`);

    try {
      // Not: eski kodda burada /orgs/{org}/builds ile "sanity check" yapılıyordu.
      // O uç nokta organizasyondaki tüm build'leri listelediği için ağır ve
      // rate limit'e en çabuk takılan istek; kimlik doğrulama zaten proje
      // listesinde (401 → fatal) yapıldığından kaldırıldı.

      let initialQueue: ProjectRef[];
      if (options.projects) {
        // Dışarıdan verilen liste (ör. job resume: yalnızca tamamlanmamış projeler)
        initialQueue = options.projects;
        this.log('info', `${initialQueue.length} proje taranacak (verilen liste)`);
      } else {
        const projects = await unityService.listProjects();
        const limitProjects = options.limitProjects || credentials.limitProjects || -1;
        const projectsToScan = limitProjects > 0 ? projects.slice(0, limitProjects) : projects;
        this.log('info', `Toplam proje: ${projects.length} (${projectsToScan.length} taranacak)`);
        initialQueue = projectsToScan.map(toProjectRef);
      }
      await hooks.onProjectsListed?.(initialQueue);

      await db.upsertOrganization(credentials.orgId);

      // Sonuçlar proje id'sine göre tutulur; yeniden denemeler eski sonucu ezer
      const results = new Map<string, ProjectScanResult>();
      const order: string[] = [];
      let queue: ProjectRef[] = initialQueue;
      for (const ref of queue) order.push(ref.projectId);
      const projectsToScan = initialQueue;

      let cachedProjects = 0;
      let passesRun = 0;
      let cancelled = false;

      this.updateProgress({
        totalProjects: projectsToScan.length,
        currentProject: 0,
        currentProjectName: '',
        isScanning: true,
        canCancel: true,
        pass: 1,
        maxPasses,
        pendingProjects: queue.length
      });

      for (let pass = 1; pass <= maxPasses && queue.length > 0 && !cancelled; pass++) {
        passesRun = pass;

        if (pass > 1) {
          this.log('warning', `${queue.length} proje tamamlanamadı. ${RETRY_PASS_COOLDOWN_MS / 1000} sn beklenip yeniden denenecek (geçiş ${pass}/${maxPasses})`);
          await hooks.onPassCooldown?.(pass, maxPasses, RETRY_PASS_COOLDOWN_MS);
          try {
            await this.sleep(RETRY_PASS_COOLDOWN_MS);
          } catch (error) {
            if (error instanceof CancelledError) { cancelled = true; break; }
            throw error;
          }
          this.log('info', `Geçiş ${pass}/${maxPasses} başlıyor: ${queue.map(p => p.projectName).join(', ')}`);
        }

        const nextQueue: ProjectRef[] = [];

        for (let i = 0; i < queue.length; i++) {
          if (this.shouldCancel) {
            cancelled = true;
            break;
          }

          const ref = queue[i];
          const label = pass > 1 ? `[geçiş ${pass}] ` : '';
          this.log('info', `${label}[${i + 1}/${queue.length}] Proje: ${ref.projectName} (${ref.projectId})`);
          this.updateProgress({
            currentProject: i + 1,
            totalProjects: queue.length,
            currentProjectName: ref.projectName,
            pass,
            maxPasses,
            pendingProjects: queue.length - i
          });

          await hooks.onProjectStart?.(ref, pass, maxPasses);

          // Cache kontrolü: sadece tamamlanmış taramalar cache sayılır
          if (pass === 1) {
            const cached = await this.readFromCache(db, ref, cacheMaxAgeMs);
            if (cached) {
              results.set(ref.projectId, cached);
              cachedProjects++;
              this.log('success', `${ref.projectName}: ${cached.totalBuilds} builds (cache'den)`);
              await hooks.onProjectResult?.(cached, pass);
              continue;
            }
          }

          this.log('info', `${ref.projectName}: API'den taranıyor...`);

          let result: ProjectScanResult;
          try {
            result = await this.scanAndPersist(unityService, db, credentials.orgId, ref, limitTargets);
          } catch (error) {
            if (error instanceof CancelledError) {
              cancelled = true;
              break;
            }
            if (isFatal(error)) {
              // Rate limit beklemeleri tükendi veya key geçersiz: devam etmek anlamsız
              throw error;
            }
            const message = error instanceof ApiError ? error.describe() : (error instanceof Error ? error.message : String(error));
            this.log('error', `${ref.projectName} işlenirken hata: ${message}`);
            result = {
              projectId: ref.projectId,
              projectName: ref.projectName,
              totalBuilds: 0,
              targetCount: 0,
              scannedTargets: 0,
              status: 'failed',
              errors: [message],
              isFromCache: false
            };
          }

          results.set(ref.projectId, result);
          await hooks.onProjectResult?.(result, pass);

          if (result.status === 'completed') {
            this.log('success', `${ref.projectName}: ${result.totalBuilds} builds (${result.scannedTargets}/${result.targetCount} targets)`);
          } else {
            this.log('warning', `${ref.projectName}: ${result.status} (${result.scannedTargets}/${result.targetCount} targets) - ${result.errors.join('; ')}`);
            nextQueue.push(ref);
          }
        }

        queue = nextQueue;
      }

      // İptal edildiyse hiç sıra gelmeyen projeleri de 'failed' olarak işaretle
      if (cancelled) {
        this.log('warning', 'Scan işlemi kullanıcı tarafından iptal edildi');
        for (const ref of queue) {
          if (!results.has(ref.projectId)) {
            results.set(ref.projectId, {
              projectId: ref.projectId,
              projectName: ref.projectName,
              totalBuilds: 0,
              targetCount: 0,
              scannedTargets: 0,
              status: 'failed',
              errors: ['Scan iptal edildi'],
              isFromCache: false
            });
          }
        }
      }

      const orderedResults = order
        .map(id => results.get(id))
        .filter((r): r is ProjectScanResult => !!r);

      const failed = orderedResults.filter(r => r.status !== 'completed');
      const summary: ScanSummary = {
        totalProjects: projectsToScan.length,
        completedProjects: orderedResults.filter(r => r.status === 'completed').length,
        totalBuilds: orderedResults.reduce((sum, r) => sum + r.totalBuilds, 0),
        totalTargets: orderedResults.reduce((sum, r) => sum + r.targetCount, 0),
        totalErrors: failed.length,
        cachedProjects,
        freshProjects: orderedResults.length - cachedProjects,
        failedProjects: failed.map(r => ({
          projectId: r.projectId,
          projectName: r.projectName,
          status: r.status as 'failed' | 'partial',
          errors: r.errors
        })),
        passes: passesRun,
        cancelled
      };

      if (failed.length === 0 && !cancelled) {
        this.log('success', `Scan tamamlandı! ${summary.completedProjects}/${summary.totalProjects} proje (${cachedProjects} cache'den, ${summary.freshProjects} yeni), ${passesRun} geçiş. Toplam ${summary.totalBuilds} build`);
      } else {
        this.log('error', `Scan bitti ama ${failed.length} proje tamamlanamadı (${passesRun} geçiş): ${failed.map(r => r.projectName).join(', ')}`);
      }

      this.updateProgress({
        currentProject: 0,
        totalProjects: 0,
        currentProjectName: '',
        isScanning: false,
        canCancel: false,
        pendingProjects: failed.length
      });

      return { results: orderedResults, summary };

    } catch (error) {
      const message = error instanceof ApiError ? error.describe() : (error instanceof Error ? error.message : String(error));
      this.log('error', `Scan işlemi başarısız: ${message}`);
      throw error;
    } finally {
      this.isScanning = false;
      this.shouldCancel = false;
    }
  }

  /**
   * Tek bir projeyi tara ve cache'e kaydet.
   * Build silme sonrası projeyi güncel bilgilerle cache'e geri eklemek için kullanılır.
   */
  async scanSingleProject(
    projectId: string,
    options: {
      orgId: string;
      apiKey: string;
      projectName?: string;
      limitTargets?: number;
    }
  ): Promise<ProjectScanResult> {
    this.log('info', `Tek proje taraması başlatılıyor: ${options.projectName || projectId}`);

    const unityService = this.createService(options.orgId, options.apiKey);
    const db = DatabaseService.getInstance();

    try {
      await db.upsertOrganization(options.orgId);

      let projectName = options.projectName;
      if (!projectName) {
        const projects = await unityService.listProjects();
        const project = projects.find(p => (p.projectid || p.projectId || p.id) === projectId);
        projectName = project?.name || projectId;
      }

      this.log('info', `${projectName}: API'den taranıyor...`);
      const result = await this.scanAndPersist(unityService, db, options.orgId, { projectId, projectName }, options.limitTargets);

      if (result.status === 'completed') {
        this.log('success', `✓ ${projectName}: ${result.totalBuilds} builds (${result.scannedTargets}/${result.targetCount} targets)`);
      } else {
        this.log('warning', `${projectName}: ${result.status} - ${result.errors.join('; ')}`);
      }
      return result;

    } catch (error) {
      const message = error instanceof ApiError ? error.describe() : (error instanceof Error ? error.message : String(error));
      this.log('error', `Tek proje taraması başarısız: ${message}`);
      throw error;
    }
  }

  /**
   * Org geneli tarama: proje listesi (1 istek) + org build listesi (~40 sayfa).
   * Target başına istek atmadığı için Unity abuse detection'ına takılmaz.
   * Cache kullanılmaz; her çalıştırmada tüm projeler tazelenir (zaten ucuz).
   */
  async startOrgScan(options: ScanOptions = {}, hooks: ScanHooks = {}): Promise<{
    results: ProjectScanResult[];
    summary: ScanSummary;
  }> {
    if (this.isScanning) {
      throw new Error('Zaten bir scan işlemi devam ediyor');
    }
    const credentials = options.credentials || CredentialManager.getCredentials();
    if (!credentials) {
      throw new Error('Unity Cloud Build credentials bulunamadı');
    }

    this.isScanning = true;
    this.shouldCancel = false;
    const unityService = this.createService(credentials.orgId, credentials.apiKey, hooks.onWait);
    const db = DatabaseService.getInstance();
    const startTime = Date.now();

    this.log('info', 'Org geneli tarama başlatılıyor (proje listesi + build listesi sayfaları)...');

    try {
      const projects = await unityService.listProjects();
      const limitProjects = options.limitProjects || credentials.limitProjects || -1;
      const projectsToScan = (limitProjects > 0 ? projects.slice(0, limitProjects) : projects).map(toProjectRef);
      this.log('info', `Toplam proje: ${projects.length} (${projectsToScan.length} raporlanacak)`);
      await hooks.onProjectsListed?.(projectsToScan);
      await db.upsertOrganization(credentials.orgId);

      this.updateProgress({ totalProjects: projectsToScan.length, currentProject: 0, currentProjectName: '', isScanning: true, canCancel: true });

      const aggregate = await unityService.aggregateOrgBuilds({
        onPage: async (page, totalPages, fetched, total) => {
          if (this.shouldCancel) throw new CancelledError();
          this.log('info', `Build listesi: sayfa ${page}/${totalPages} (${fetched}/${total} build)`);
          await hooks.onPage?.(page, totalPages, fetched, total);
        }
      });
      this.log('success', `Build listesi alındı: ${aggregate.totalBuilds} build, ${aggregate.projects.size} projede, ${aggregate.pages} sayfa`);

      // Build listesindeki proje anahtarı guid ya da id olabilir; ikisini de eşle
      const results: ProjectScanResult[] = [];
      for (let i = 0; i < projectsToScan.length; i++) {
        if (this.shouldCancel) throw new CancelledError();
        const ref = projectsToScan[i];
        const entry = aggregate.projects.get(ref.projectId);
        const targets = entry ? Array.from(entry.targets.entries()) : [];

        const data: ProjectScanData = {
          projectId: ref.projectId,
          totalBuilds: entry?.totalBuilds ?? 0,
          targetCount: targets.length,
          scannedTargets: targets.length,
          targets: targets.map(([id, t]) => ({ id, name: t.name, platform: t.platform, enabled: true, buildCount: t.count })),
          errors: []
        };

        await hooks.onProjectStart?.(ref, 1, 1);
        const result = await this.persistProjectData(db, credentials.orgId, ref, data, startTime);
        results.push(result);
        await hooks.onProjectResult?.(result, 1);
        this.updateProgress({ currentProject: i + 1, currentProjectName: ref.projectName });
      }

      // Build listesinde olup proje listesinde olmayan anahtarlar (eski/silinmiş proje) bilgi amaçlı
      const unmatched = Array.from(aggregate.projects.keys()).filter(k => !projectsToScan.some(p => p.projectId === k));
      if (unmatched.length > 0 && limitProjects <= 0) {
        this.log('warning', `${unmatched.length} proje anahtarı proje listesiyle eşleşmedi (örnek: ${unmatched.slice(0, 3).join(', ')}). Bu build'ler sayılmadı.`);
      }

      const summary: ScanSummary = {
        totalProjects: projectsToScan.length,
        completedProjects: results.length,
        totalBuilds: results.reduce((sum, r) => sum + r.totalBuilds, 0),
        totalTargets: results.reduce((sum, r) => sum + r.targetCount, 0),
        totalErrors: 0,
        cachedProjects: 0,
        freshProjects: results.length,
        failedProjects: [],
        passes: 1,
        cancelled: false
      };

      this.log('success', `Scan tamamlandı! ${summary.completedProjects} proje, ${summary.totalBuilds} build, ${summary.totalTargets} target; toplam ${aggregate.pages + 1} API isteği`);
      this.updateProgress({ currentProject: 0, totalProjects: 0, currentProjectName: '', isScanning: false, canCancel: false });
      return { results, summary };
    } catch (error) {
      const message = error instanceof ApiError ? error.describe() : (error instanceof Error ? error.message : String(error));
      this.log(error instanceof CancelledError ? 'warning' : 'error', `Org taraması ${error instanceof CancelledError ? 'iptal edildi' : 'başarısız: ' + message}`);
      throw error;
    } finally {
      this.isScanning = false;
      this.shouldCancel = false;
    }
  }

  cancelScan(): void {
    this.shouldCancel = true;
    if (this.isScanning) {
      this.log('info', 'Scan iptal ediliyor...');
    }
  }

  getScanProgress(): ScanProgress {
    return { ...this.currentProgress };
  }

  isCurrentlyScanning(): boolean {
    return this.isScanning;
  }

  // ---------------------------------------------------------------------------

  /**
   * Projeyi API'den tarar ve sonucu veritabanına yazar.
   * lastScannedAt yalnızca tarama eksiksiz tamamlandığında set edilir; böylece
   * yarım kalan projeler cache sayılmaz ve bir sonraki taramada tekrar denenir.
   */
  private async scanAndPersist(
    unityService: UnityCloudBuildService,
    db: DatabaseService,
    orgId: string,
    ref: ProjectRef,
    limitTargets?: number
  ): Promise<ProjectScanResult> {
    const startTime = Date.now();
    const data = await unityService.scanProject(ref.projectId, limitTargets);
    return this.persistProjectData(db, orgId, ref, data, startTime);
  }

  /** Hazır tarama verisini (API'den ya da org listesinden) veritabanına yazar */
  private async persistProjectData(
    db: DatabaseService,
    orgId: string,
    ref: ProjectRef,
    data: ProjectScanData,
    startTime: number
  ): Promise<ProjectScanResult> {
    const status: ProjectScanResult['status'] =
      data.errors.length === 0 ? 'completed' :
      data.scannedTargets > 0 ? 'partial' : 'failed';

    const completedAt = new Date();

    await db.saveProject({
      id: ref.projectId,
      name: ref.projectName,
      organizationId: orgId,
      description: ref.description
    });

    const scanResultId = await db.saveScanResult({
      projectId: ref.projectId,
      status,
      totalBuilds: data.totalBuilds,
      totalTargets: data.targetCount,
      scannedTargets: data.scannedTargets,
      errorMessage: data.errors.length > 0 ? data.errors.join('; ') : undefined,
      startedAt: new Date(startTime),
      completedAt,
      durationMs: completedAt.getTime() - startTime
    });

    for (const target of data.targets) {
      await db.saveBuildTarget({
        id: target.id,
        name: target.name,
        platform: target.platform,
        projectId: ref.projectId,
        enabled: target.enabled
      });
      if (target.buildCount !== null) {
        await db.saveBuildCount(target.id, target.buildCount, scanResultId);
      }
    }

    if (status === 'completed') {
      await db.saveProject({
        id: ref.projectId,
        name: ref.projectName,
        organizationId: orgId,
        description: ref.description,
        lastScannedAt: completedAt
      });
    }

    return {
      projectId: ref.projectId,
      projectName: ref.projectName,
      totalBuilds: data.totalBuilds,
      targetCount: data.targetCount,
      scannedTargets: data.scannedTargets,
      status,
      errors: data.errors,
      isFromCache: false
    };
  }

  private async readFromCache(db: DatabaseService, ref: ProjectRef, maxAgeMs?: number): Promise<ProjectScanResult | null> {
    const isCached = await db.isProjectCached(ref.projectId, maxAgeMs);
    if (!isCached) return null;

    const cachedProject = await db.getProject(ref.projectId);
    const latest = await db.getLatestScanResult(ref.projectId);
    if (!cachedProject || !latest || latest.status !== 'completed') return null;

    return {
      projectId: ref.projectId,
      projectName: ref.projectName,
      totalBuilds: latest.totalBuilds,
      targetCount: latest.totalTargets,
      scannedTargets: latest.scannedTargets,
      status: latest.status,
      errors: [],
      isFromCache: true,
      cachedAt: cachedProject.lastScannedAt
    };
  }

  private createService(orgId: string, apiKey: string, onWait?: ScanHooks['onWait']): UnityCloudBuildService {
    const service = new UnityCloudBuildService(orgId, apiKey);
    service.setCancelCheck(() => this.shouldCancel);
    service.setWaitCallback((info) => {
      this.logWait(info);
      void onWait?.(info);
    });
    return service;
  }

  private logWait(info: Parameters<typeof describeWait>[0]): void {
    this.log('warning', describeWait(info));
  }

  /** İptal kontrolü yapan bekleme */
  private async sleep(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.shouldCancel) throw new CancelledError();
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
    }
  }

  private updateProgress(updates: Partial<ScanProgress>): void {
    this.currentProgress = { ...this.currentProgress, ...updates };
    this.onProgressUpdate?.(this.currentProgress);
  }

  private log(level: LogLevel, message: string, source: string = 'ScanOrchestrator'): void {
    this.onLogUpdate?.(level, message, source);
  }
}

function toProjectRef(project: UnityProject): ProjectRef {
  const projectId = project.projectid || project.projectId || project.id || '';
  return {
    projectId,
    projectName: project.name || project.projectName || projectId,
    description: project.description
  };
}
