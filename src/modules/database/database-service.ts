import { PrismaClient } from '@prisma/client';
import { ProjectData, BuildTargetData, ScanResult, LogEntry } from '@/types';

export class DatabaseService {
  private static instance: DatabaseService;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = new PrismaClient();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Organization operations
  async upsertOrganization(orgId: string, name?: string): Promise<void> {
    await this.prisma.organization.upsert({
      where: { id: orgId },
      update: { name, updatedAt: new Date() },
      create: { id: orgId, name }
    });
  }

  // Project operations
  async saveProject(projectData: ProjectData): Promise<void> {
    await this.prisma.project.upsert({
      where: { id: projectData.id },
      update: {
        name: projectData.name,
        description: projectData.description,
        lastScannedAt: projectData.lastScannedAt,
        updatedAt: new Date()
      },
      create: {
        id: projectData.id,
        name: projectData.name,
        organizationId: projectData.organizationId,
        description: projectData.description,
        lastScannedAt: projectData.lastScannedAt
      }
    });
  }

  async getProject(projectId: string): Promise<ProjectData | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project) return null;

    return {
      id: project.id,
      name: project.name,
      organizationId: project.organizationId,
      description: project.description || undefined,
      lastScannedAt: project.lastScannedAt || undefined
    };
  }

  async getCachedProjects(orgId: string, cacheMaxAgeMs: number = 3600000): Promise<ProjectData[]> {
    const cutoffTime = new Date(Date.now() - cacheMaxAgeMs);
    
    const projects = await this.prisma.project.findMany({
      where: {
        organizationId: orgId,
        lastScannedAt: {
          gte: cutoffTime
        }
      },
      orderBy: { lastScannedAt: 'desc' }
    });

    return projects.map(p => ({
      id: p.id,
      name: p.name,
      organizationId: p.organizationId,
      description: p.description || undefined,
      lastScannedAt: p.lastScannedAt || undefined
    }));
  }

  async isProjectCached(projectId: string, cacheMaxAgeMs: number = 3600000): Promise<boolean> {
    const cutoffTime = new Date(Date.now() - cacheMaxAgeMs);
    
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        lastScannedAt: {
          gte: cutoffTime
        }
      }
    });

    return !!project;
  }

  // Build Target operations
  async saveBuildTarget(targetData: BuildTargetData): Promise<void> {
    await this.prisma.buildTarget.upsert({
      where: { id: targetData.id },
      update: {
        name: targetData.name,
        platform: targetData.platform,
        enabled: targetData.enabled,
        updatedAt: new Date()
      },
      create: {
        id: targetData.id,
        name: targetData.name,
        platform: targetData.platform,
        projectId: targetData.projectId,
        enabled: targetData.enabled
      }
    });
  }

  async getBuildTargetsForProject(projectId: string): Promise<BuildTargetData[]> {
    const targets = await this.prisma.buildTarget.findMany({
      where: { projectId }
    });

    return targets.map(t => ({
      id: t.id,
      name: t.name,
      platform: t.platform || undefined,
      projectId: t.projectId,
      enabled: t.enabled
    }));
  }

  // Scan Result operations
  async saveScanResult(scanData: Omit<ScanResult, 'id'> & { id?: string }): Promise<string> {
    const result = await this.prisma.scanResult.upsert({
      where: { id: scanData.id || 'new' },
      update: {
        status: scanData.status,
        totalBuilds: scanData.totalBuilds,
        totalTargets: scanData.totalTargets,
        scannedTargets: scanData.scannedTargets,
        errorMessage: scanData.errorMessage,
        completedAt: scanData.completedAt,
        durationMs: scanData.durationMs
      },
      create: {
        projectId: scanData.projectId,
        status: scanData.status,
        totalBuilds: scanData.totalBuilds,
        totalTargets: scanData.totalTargets,
        scannedTargets: scanData.scannedTargets,
        errorMessage: scanData.errorMessage,
        startedAt: scanData.startedAt,
        completedAt: scanData.completedAt,
        durationMs: scanData.durationMs
      }
    });

    return result.id;
  }

  async getLatestScanResult(projectId: string): Promise<ScanResult | null> {
    const result = await this.prisma.scanResult.findFirst({
      where: { projectId },
      orderBy: { startedAt: 'desc' }
    });

    if (!result) return null;

    return {
      id: result.id,
      projectId: result.projectId,
      status: result.status as 'completed' | 'failed' | 'partial',
      totalBuilds: result.totalBuilds,
      totalTargets: result.totalTargets,
      scannedTargets: result.scannedTargets,
      errorMessage: result.errorMessage || undefined,
      startedAt: result.startedAt,
      completedAt: result.completedAt || undefined,
      durationMs: result.durationMs || undefined
    };
  }

  async saveBuildCount(buildTargetId: string, count: number, scanResultId: string): Promise<void> {
    await this.prisma.buildCount.create({
      data: {
        buildTargetId,
        count,
        scanResultId
      }
    });
  }

  async getBuildCountsForScanResult(scanResultId: string): Promise<Array<{
    buildTargetId: string;
    count: number;
    scannedAt: Date;
  }>> {
    const counts = await this.prisma.buildCount.findMany({
      where: { scanResultId }
    });

    return counts.map(c => ({
      buildTargetId: c.buildTargetId,
      count: c.count,
      scannedAt: c.scannedAt
    }));
  }

  // Cache management operations
  async clearProjectCache(projectId: string): Promise<void> {
    // Delete scan results and related build counts for this project
    await this.prisma.buildCount.deleteMany({
      where: {
        scanResult: {
          projectId
        }
      }
    });

    await this.prisma.scanResult.deleteMany({
      where: { projectId }
    });

    // Reset lastScannedAt for the project
    await this.prisma.project.update({
      where: { id: projectId },
      data: { lastScannedAt: null }
    });
  }

  async bulkClearProjectsCache(projectIds: string[]): Promise<void> {
    // Delete build counts for all specified projects
    await this.prisma.buildCount.deleteMany({
      where: {
        scanResult: {
          projectId: {
            in: projectIds
          }
        }
      }
    });

    // Delete scan results for all specified projects
    await this.prisma.scanResult.deleteMany({
      where: {
        projectId: {
          in: projectIds
        }
      }
    });

    // Reset lastScannedAt for all specified projects
    await this.prisma.project.updateMany({
      where: {
        id: {
          in: projectIds
        }
      },
      data: { lastScannedAt: null }
    });
  }

  async clearAllCache(orgId: string): Promise<void> {
    // Get all project IDs for the organization
    const projects = await this.prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true }
    });

    const projectIds = projects.map(p => p.id);

    if (projectIds.length > 0) {
      await this.bulkClearProjectsCache(projectIds);
    }
  }

  // Log operations
  async saveLog(logData: Omit<LogEntry, 'id' | 'timestamp'> & { timestamp?: Date }): Promise<void> {
    await this.prisma.logEntry.create({
      data: {
        level: logData.level,
        message: logData.message,
        details: logData.details,
        source: logData.source,
        timestamp: logData.timestamp || new Date()
      }
    });
  }

  async getLogs(limit: number = 100, offset: number = 0): Promise<LogEntry[]> {
    const logs = await this.prisma.logEntry.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset
    });

    return logs.map(l => ({
      id: l.id,
      level: l.level as 'info' | 'warning' | 'error' | 'success',
      message: l.message,
      details: l.details || undefined,
      timestamp: l.timestamp,
      source: l.source || undefined
    }));
  }

  // Utility operations
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async getProjectStats(orgId: string): Promise<{
    totalProjects: number;
    cachedProjects: number;
    totalBuilds: number;
    lastScanDate: Date | null;
  }> {
    const totalProjects = await this.prisma.project.count({
      where: { organizationId: orgId }
    });

    const cachedProjects = await this.prisma.project.count({
      where: {
        organizationId: orgId,
        lastScannedAt: {
          not: null
        }
      }
    });

    const buildCounts = await this.prisma.scanResult.aggregate({
      where: {
        project: {
          organizationId: orgId
        }
      },
      _sum: {
        totalBuilds: true
      }
    });

    const lastScan = await this.prisma.project.findFirst({
      where: {
        organizationId: orgId,
        lastScannedAt: {
          not: null
        }
      },
      orderBy: {
        lastScannedAt: 'desc'
      },
      select: {
        lastScannedAt: true
      }
    });

    return {
      totalProjects,
      cachedProjects,
      totalBuilds: buildCounts._sum.totalBuilds || 0,
      lastScanDate: lastScan?.lastScannedAt || null
    };
  }
}
