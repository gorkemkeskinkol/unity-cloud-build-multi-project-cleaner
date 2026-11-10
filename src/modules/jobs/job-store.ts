import { Prisma } from '@prisma/client';
import { DatabaseService } from '@/modules/database/database-service';
import {
  JobRecord, JobItemRecord, JobType, JobStatus, JobItemStatus, JobParams, JobProgress
} from '@/types/jobs';

/**
 * Job ve JobItem kayıtlarının kalıcı deposu (SQLite / Prisma).
 * Runner'ın bellek durumu kaybolsa bile buradaki kayıtlardan devam edilir.
 */
export class JobStore {
  private get prisma() {
    return DatabaseService.getInstance().getClient();
  }

  async createJob(type: JobType, title: string, params: JobParams): Promise<JobRecord> {
    const job = await this.prisma.job.create({
      data: {
        type,
        title,
        status: 'queued',
        params: JSON.stringify(params)
      }
    });
    return toJobRecord(job);
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const job = await this.prisma.job.findUnique({ where: { id } });
    return job ? toJobRecord(job) : null;
  }

  async listJobs(limit = 50): Promise<JobRecord[]> {
    const jobs = await this.prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return jobs.map(toJobRecord);
  }

  async updateJob(id: string, data: {
    status?: JobStatus;
    progress?: JobProgress | null;
    result?: Record<string, unknown> | null;
    error?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  }): Promise<JobRecord> {
    const job = await this.prisma.job.update({
      where: { id },
      data: {
        status: data.status,
        progress: data.progress === undefined ? undefined : (data.progress ? JSON.stringify(data.progress) : null),
        result: data.result === undefined ? undefined : (data.result ? JSON.stringify(data.result) : null),
        error: data.error,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt
      }
    });
    return toJobRecord(job);
  }

  /** Servis açılışında: bellekte olmayan "running/queued" işler yarım kalmıştır */
  async markInterrupted(): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { status: { in: ['running', 'queued'] } },
      data: { status: 'interrupted', error: 'Servis yeniden başladı; iş yarım kaldı. Resume ile kaldığı yerden devam eder.' }
    });
    // Yarım kalan item'lar tekrar bekleyen duruma döner
    await this.prisma.jobItem.updateMany({
      where: { status: 'running', job: { status: 'interrupted' } },
      data: { status: 'pending' }
    });
    return result.count;
  }

  // ---- Items ----

  async getItems(jobId: string): Promise<JobItemRecord[]> {
    const items = await this.prisma.jobItem.findMany({
      where: { jobId },
      orderBy: { id: 'asc' }
    });
    return items.map(toItemRecord);
  }

  /** İlk çalıştırmada iş birimlerini kaydeder; mevcut olanlar korunur */
  async ensureItems(jobId: string, kind: 'project' | 'target', items: Array<{ refId: string; name: string }>): Promise<void> {
    const existing = await this.prisma.jobItem.findMany({
      where: { jobId },
      select: { refId: true }
    });
    const have = new Set(existing.map(e => e.refId));
    const missing = items.filter(i => !have.has(i.refId));
    if (missing.length === 0) return;
    await this.prisma.jobItem.createMany({
      data: missing.map(i => ({
        jobId,
        kind,
        refId: i.refId,
        name: i.name,
        status: 'pending'
      }))
    });
  }

  async updateItem(jobId: string, refId: string, data: {
    status?: JobItemStatus;
    error?: string | null;
    result?: Record<string, unknown> | null;
    incrementAttempts?: boolean;
  }): Promise<void> {
    await this.prisma.jobItem.update({
      where: { jobId_refId: { jobId, refId } },
      data: {
        status: data.status,
        error: data.error,
        result: data.result === undefined ? undefined : (data.result ? JSON.stringify(data.result) : null),
        attempts: data.incrementAttempts ? { increment: 1 } : undefined
      }
    });
  }

  /** Resume öncesi: tamamlanmamış tüm item'lar yeniden bekleyen duruma */
  async resetUnfinishedItems(jobId: string): Promise<void> {
    await this.prisma.jobItem.updateMany({
      where: { jobId, status: { in: ['running', 'failed', 'partial', 'cancelled'] } },
      data: { status: 'pending' }
    });
  }

  async countItems(jobId: string): Promise<{ total: number; completed: number; failed: number }> {
    const groups = await this.prisma.jobItem.groupBy({
      by: ['status'],
      where: { jobId },
      _count: { _all: true }
    });
    let total = 0, completed = 0, failed = 0;
    for (const g of groups) {
      const n = g._count._all;
      total += n;
      if (g.status === 'completed') completed += n;
      if (g.status === 'failed' || g.status === 'partial') failed += n;
    }
    return { total, completed, failed };
  }
}

type JobRow = Prisma.JobGetPayload<Record<string, never>>;
type ItemRow = Prisma.JobItemGetPayload<Record<string, never>>;

function toJobRecord(job: JobRow): JobRecord {
  return {
    id: job.id,
    type: job.type as JobType,
    status: job.status as JobStatus,
    title: job.title,
    params: safeParse<JobParams>(job.params) ?? { orgId: '' },
    progress: safeParse<JobProgress>(job.progress),
    result: safeParse<Record<string, unknown>>(job.result),
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null
  };
}

function toItemRecord(item: ItemRow): JobItemRecord {
  return {
    id: item.id,
    jobId: item.jobId,
    kind: item.kind as 'project' | 'target',
    refId: item.refId,
    name: item.name,
    status: item.status as JobItemStatus,
    attempts: item.attempts,
    error: item.error,
    result: safeParse<Record<string, unknown>>(item.result),
    updatedAt: item.updatedAt.toISOString()
  };
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
