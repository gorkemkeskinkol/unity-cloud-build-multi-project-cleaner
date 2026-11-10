import { JobStore } from './job-store';
import { getJobEventBus } from './job-events';
import { ScanOrchestrator, ProjectRef } from '@/modules/scanning/scan-orchestrator';
import { UnityCloudBuildService } from '@/modules/api/unity-cloud-build';
import { ApiError, CancelledError, describeWait, WaitInfo } from '@/modules/api/api-client';
import { DatabaseService } from '@/modules/database/database-service';
import { JobRecord, JobType, JobParams, JobProgress } from '@/types/jobs';

interface Credentials {
  orgId: string;
  apiKey: string;
}

interface RunningJob {
  jobId: string;
  cancel: () => void;
}

/**
 * Tek işçili, sıralı job çalıştırıcı.
 *
 * - Jobs ve item'ları veritabanında kalıcıdır; ilerleme her adımda yazılır.
 * - API key veritabanına YAZILMAZ: sadece bu nesnenin belleğinde, job bitince silinir.
 *   Servis yeniden başlayınca job "interrupted" olur; tarayıcı açıldığında
 *   localStorage'daki key ile /api/jobs/[id]/resume çağrılır ve kaldığı yerden devam eder.
 * - Aynı anda tek job çalışır (Unity rate limit). Diğerleri sırada bekler.
 */
class JobRunner {
  private store = new JobStore();
  private bus = getJobEventBus();
  private queue: string[] = [];
  private credentials = new Map<string, Credentials>();
  private running: RunningJob | null = null;
  private booted = false;
  private working = false;

  /** Süreç başlangıcında bir kez: bellekte olmayan işler yarım kalmıştır */
  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    const count = await this.store.markInterrupted();
    if (count > 0) {
      this.bus.log('warning', `Servis yeniden başladı: ${count} iş yarım kalmıştı, "interrupted" olarak işaretlendi. Dashboard açıkken otomatik devam eder.`);
    }
  }

  async enqueue(type: JobType, params: JobParams, credentials: Credentials): Promise<JobRecord> {
    await this.boot();
    const title = type === 'full_scan'
      ? `Full scan${params.limitProjects ? ` (ilk ${params.limitProjects} proje)` : ''}`
      : `Artifact silme: ${params.projectName || params.projectId}`;
    const job = await this.store.createJob(type, title, params);
    this.credentials.set(job.id, credentials);
    this.queue.push(job.id);
    this.bus.emit({ kind: 'job', job });
    this.bus.log('info', `İş sıraya alındı: ${title}${this.running ? ' (önündeki iş bitince başlayacak)' : ''}`, 'Jobs', job.id);
    void this.work();
    return job;
  }

  async resume(jobId: string, credentials: Credentials): Promise<JobRecord> {
    await this.boot();
    const job = await this.store.getJob(jobId);
    if (!job) throw new Error('Job bulunamadı');
    if (job.status === 'running' || job.status === 'queued') {
      throw new Error('Job zaten çalışıyor veya sırada');
    }
    await this.store.resetUnfinishedItems(jobId);
    const counts = await this.store.countItems(jobId);
    const updated = await this.store.updateJob(jobId, {
      status: 'queued',
      error: null,
      finishedAt: null,
      progress: {
        ...(job.progress ?? { total: counts.total, done: 0, failed: 0 }),
        done: counts.completed,
        failed: 0,
        phase: 'Sırada (resume)',
        currentName: undefined,
        waitingUntil: null
      }
    });
    this.credentials.set(jobId, credentials);
    this.queue.push(jobId);
    this.bus.emit({ kind: 'job', job: updated });
    this.bus.log('info', `İş kaldığı yerden devam edecek: ${job.title} (${counts.completed}/${counts.total} tamamlanmıştı)`, 'Jobs', jobId);
    void this.work();
    return updated;
  }

  async cancel(jobId: string): Promise<boolean> {
    if (this.running?.jobId === jobId) {
      this.running.cancel();
      this.bus.log('warning', 'İptal isteği alındı; süren bekleme en geç 1 sn içinde kesilecek', 'Jobs', jobId);
      return true;
    }
    const idx = this.queue.indexOf(jobId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      this.credentials.delete(jobId);
      const job = await this.store.updateJob(jobId, { status: 'cancelled', finishedAt: new Date(), progress: null });
      this.bus.emit({ kind: 'job', job });
      this.bus.log('warning', `Sıradaki iş iptal edildi: ${job.title}`, 'Jobs', jobId);
      return true;
    }
    return false;
  }

  getRunningJobId(): string | null {
    return this.running?.jobId ?? null;
  }

  // ---------------------------------------------------------------------------

  private async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift()!;
        const credentials = this.credentials.get(jobId);
        if (!credentials) {
          const job = await this.store.updateJob(jobId, { status: 'interrupted', error: 'Credentials bellekte yok; resume gerekli' });
          this.bus.emit({ kind: 'job', job });
          continue;
        }
        await this.runJob(jobId, credentials);
        this.credentials.delete(jobId);
      }
    } finally {
      this.working = false;
    }
  }

  private async runJob(jobId: string, credentials: Credentials): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (!job) return;

    let cancelled = false;
    let cancelHook: () => void = () => { cancelled = true; };
    this.running = { jobId, cancel: () => cancelHook() };

    const started = await this.store.updateJob(jobId, {
      status: 'running',
      startedAt: job.startedAt ? undefined : new Date(),
      error: null
    });
    this.bus.emit({ kind: 'job', job: started });
    this.bus.log('info', `İş başladı: ${job.title}`, 'Jobs', jobId);

    try {
      if (job.type === 'full_scan') {
        await this.runFullScan(job, credentials, (hook) => { cancelHook = () => { cancelled = true; hook(); }; }, () => cancelled);
      } else {
        await this.runDeleteBuilds(job, credentials, (hook) => { cancelHook = () => { cancelled = true; hook(); }; }, () => cancelled);
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.describe() : (error instanceof Error ? error.message : String(error));
      const isCancel = error instanceof CancelledError || cancelled;
      const counts = await this.store.countItems(jobId);
      const failed = await this.store.updateJob(jobId, {
        status: isCancel ? 'cancelled' : 'failed',
        error: isCancel ? 'Kullanıcı iptal etti' : message,
        finishedAt: new Date(),
        progress: { ...(job.progress ?? { total: counts.total, done: 0, failed: 0 }), done: counts.completed, failed: counts.failed, phase: isCancel ? 'İptal edildi' : 'Hata', waitingUntil: null, currentName: undefined }
      });
      this.bus.emit({ kind: 'job', job: failed });
      this.bus.log(isCancel ? 'warning' : 'error', `${isCancel ? 'İş iptal edildi' : 'İş durdu'}: ${job.title} - ${message}`, 'Jobs', jobId);
    } finally {
      this.running = null;
    }
  }

  // ---- full_scan ----

  /**
   * Full scan = org geneli tarama: 1 proje listesi + ~40 build sayfası.
   * Resume'da sayfalar baştan alınır (ucuz, idempotent); item'lar proje bazında
   * takip edilir ve hepsi kaydedildikçe completed olur.
   */
  private async runFullScan(
    job: JobRecord,
    credentials: Credentials,
    setCancelHook: (hook: () => void) => void,
    isCancelled: () => boolean
  ): Promise<void> {
    const orchestrator = new ScanOrchestrator();
    setCancelHook(() => orchestrator.cancelScan());

    orchestrator.setLogCallback((level, message, source) => {
      this.bus.log(level, message, source, job.id);
    });

    const progress: JobProgress = { total: 0, done: 0, failed: 0, phase: 'Proje listesi alınıyor' };
    await this.publishProgress(job.id, progress);

    let projectCount = 0;
    const { summary } = await orchestrator.startOrgScan(
      {
        credentials: { orgId: credentials.orgId, apiKey: credentials.apiKey },
        limitProjects: job.params.limitProjects,
        limitTargets: job.params.limitTargets
      },
      {
        onProjectsListed: async (projects) => {
          projectCount = projects.length;
          await this.store.ensureItems(job.id, 'project', projects.map(p => ({ refId: p.projectId, name: p.projectName })));
          progress.phase = 'Build listesi alınıyor';
          await this.publishProgress(job.id, progress);
        },
        onPage: async (page, totalPages, fetched, total) => {
          progress.total = totalPages;
          progress.done = page;
          progress.phase = `Build listesi: sayfa ${page}/${totalPages} (${fetched}/${total} build)`;
          progress.waitingUntil = null;
          progress.currentName = undefined;
          await this.publishProgress(job.id, progress);
        },
        onProjectStart: async (ref) => {
          if (progress.phase !== 'Kaydediliyor') {
            progress.phase = 'Kaydediliyor';
            progress.total = projectCount;
            progress.done = 0;
          }
          progress.currentName = ref.projectName;
          await this.store.updateItem(job.id, ref.projectId, { status: 'running', incrementAttempts: true });
        },
        onProjectResult: async (result) => {
          await this.store.updateItem(job.id, result.projectId, {
            status: 'completed',
            error: null,
            result: { totalBuilds: result.totalBuilds, targetCount: result.targetCount, scannedTargets: result.scannedTargets }
          });
          progress.done++;
          // Her projede DB'ye yazmak yerine 10'da bir yayınla (UI için yeterli)
          if (progress.done % 10 === 0 || progress.done === progress.total) {
            await this.publishProgress(job.id, progress);
          }
        },
        onWait: async (info) => {
          progress.phase = shortWait(info);
          progress.waitingUntil = new Date(Date.now() + info.waitMs).toISOString();
          await this.publishProgress(job.id, progress);
        }
      }
    );

    if (isCancelled() || summary.cancelled) {
      throw new CancelledError();
    }

    const counts = await this.store.countItems(job.id);
    progress.total = counts.total;
    progress.done = counts.completed;
    progress.failed = counts.failed;
    await this.finishJob(job.id, progress, {
      totalProjects: summary.totalProjects,
      completedProjects: summary.completedProjects,
      totalBuilds: summary.totalBuilds,
      totalTargets: summary.totalTargets,
      cachedProjects: summary.cachedProjects,
      freshProjects: summary.freshProjects,
      passes: summary.passes,
      failedProjects: summary.failedProjects
    });
  }

  // ---- delete_builds ----

  private async runDeleteBuilds(
    job: JobRecord,
    credentials: Credentials,
    setCancelHook: (hook: () => void) => void,
    isCancelled: () => boolean
  ): Promise<void> {
    const projectId = job.params.projectId;
    if (!projectId) throw new Error('delete_builds için projectId gerekli');
    const projectName = job.params.projectName || projectId;

    const service = new UnityCloudBuildService(credentials.orgId, credentials.apiKey);
    service.setCancelCheck(isCancelled);
    setCancelHook(() => { /* isCancelled flag yeterli; servis bekleme içinde kontrol eder */ });

    const progress: JobProgress = { total: 0, done: 0, failed: 0, phase: 'Target listesi alınıyor' };
    service.setWaitCallback(async (info) => {
      this.bus.log('warning', describeWait(info), 'DeleteBuilds', job.id);
      progress.phase = shortWait(info);
      progress.waitingUntil = new Date(Date.now() + info.waitMs).toISOString();
      await this.publishProgress(job.id, progress);
    });
    await this.publishProgress(job.id, progress);

    const existingItems = await this.store.getItems(job.id);
    const alreadyDone = new Set(existingItems.filter(i => i.status === 'completed').map(i => i.refId));

    this.bus.log('info', `${projectName}: artifact silme başlıyor${alreadyDone.size > 0 ? ` (${alreadyDone.size} target daha önce silinmişti, atlanacak)` : ''}`, 'DeleteBuilds', job.id);

    const result = await service.deleteAllBuildsForProject(projectId, {
      skipTargetIds: alreadyDone,
      onTargetsListed: async (targets) => {
        await this.store.ensureItems(job.id, 'target', targets.map(t => ({ refId: t.id, name: t.name })));
        const counts = await this.store.countItems(job.id);
        progress.total = counts.total;
        progress.done = counts.completed;
        progress.phase = 'Artifact siliniyor';
        await this.publishProgress(job.id, progress);
      },
      onTargetStart: async (targetId, targetName) => {
        await this.store.updateItem(job.id, targetId, { status: 'running', incrementAttempts: true });
        progress.currentName = targetName;
        progress.waitingUntil = null;
        progress.phase = 'Artifact siliniyor';
        await this.publishProgress(job.id, progress);
        this.bus.log('info', `${targetName}: artifact'ler siliniyor...`, 'DeleteBuilds', job.id);
      },
      onTargetDone: async (targetId, targetName, error) => {
        await this.store.updateItem(job.id, targetId, { status: error ? 'failed' : 'completed', error: error ?? null });
        const counts = await this.store.countItems(job.id);
        progress.done = counts.completed;
        progress.failed = counts.failed;
        await this.publishProgress(job.id, progress);
        this.bus.log(error ? 'error' : 'success', error ? `${targetName}: ${error}` : `✓ ${targetName} artifact'leri silindi`, 'DeleteBuilds', job.id);
      }
    });

    if (isCancelled()) throw new CancelledError();

    // Cache'i temizle ve projeyi güncel sayılarla yeniden tara
    let rescan: { totalBuilds: number; status: string } | null = null;
    if (job.params.updateCache !== false) {
      progress.phase = 'Cache yenileniyor';
      progress.currentName = undefined;
      await this.publishProgress(job.id, progress);
      await DatabaseService.getInstance().clearProjectCache(projectId).catch(() => { /* proje cache'de olmayabilir */ });

      const orchestrator = new ScanOrchestrator();
      setCancelHook(() => orchestrator.cancelScan());
      orchestrator.setLogCallback((level, message, source) => this.bus.log(level, message, source, job.id));
      try {
        const scanResult = await orchestrator.scanSingleProject(projectId, {
          orgId: credentials.orgId,
          apiKey: credentials.apiKey,
          projectName,
          limitTargets: job.params.limitTargets
        });
        rescan = { totalBuilds: scanResult.totalBuilds, status: scanResult.status };
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        const message = error instanceof ApiError ? error.describe() : String(error);
        this.bus.log('warning', `Proje cache'e geri eklenemedi: ${message}. Bir sonraki full scan'de taranacak.`, 'DeleteBuilds', job.id);
      }
    }

    await this.finishJob(job.id, progress, {
      deletedTargets: result.deletedTargets,
      totalTargets: result.totalTargets,
      errors: result.errors,
      rescan
    });
  }

  // ---- helpers ----

  private async publishProgress(jobId: string, progress: JobProgress): Promise<void> {
    const job = await this.store.updateJob(jobId, { progress: { ...progress } });
    this.bus.emit({ kind: 'job', job });
  }

  private async finishJob(jobId: string, progress: JobProgress, result: Record<string, unknown>): Promise<void> {
    const done = await this.store.updateJob(jobId, {
      status: 'completed',
      finishedAt: new Date(),
      result,
      progress: { ...progress, currentName: undefined, waitingUntil: null, phase: progress.failed > 0 ? `Bitti, ${progress.failed} eksik` : 'Tamamlandı' }
    });
    this.bus.emit({ kind: 'job', job: done });
    this.bus.log(progress.failed > 0 ? 'warning' : 'success', `İş bitti: ${done.title} (${progress.done}/${progress.total}${progress.failed > 0 ? `, ${progress.failed} tamamlanamadı - Resume ile tekrar denenebilir` : ''})`, 'Jobs', jobId);
  }
}

function shortWait(info: WaitInfo): string {
  const seconds = Math.round(info.waitMs / 1000);
  const label = seconds >= 120 ? `${Math.round(seconds / 60)} dk` : `${seconds} sn`;
  return info.reason === 'rate_limit'
    ? `Rate limit: ${label} bekleniyor (${info.attempt}/${info.maxAttempts})`
    : `Geçici hata, ${label} sonra tekrar (${info.attempt}/${info.maxAttempts})`;
}

const KEY = '__ucb_job_runner__';
const g = globalThis as unknown as Record<string, JobRunner | undefined>;

export function getJobRunner(): JobRunner {
  if (!g[KEY]) {
    g[KEY] = new JobRunner();
  }
  return g[KEY];
}
