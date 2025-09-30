import { UnityCloudBuildService } from '@/modules/api/unity-cloud-build';
import { CredentialManager } from '@/modules/config/credential-manager';
import { DatabaseService } from '@/modules/database/database-service';
import { ScanOptions, ScanProgress, ProjectScanResult, ScanSummary } from '@/types';

export class ScanOrchestrator {
  private isScanning = false;
  private shouldCancel = false;
  private currentProgress: ScanProgress;
  private unityService: UnityCloudBuildService | null = null;
  private onProgressUpdate?: (progress: ScanProgress) => void;
  private onLogUpdate?: (level: 'info' | 'warning' | 'error' | 'success', message: string, source?: string) => void;

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

  /**
   * Progress callback'ini set et
   */
  setProgressCallback(callback: (progress: ScanProgress) => void): void {
    this.onProgressUpdate = callback;
  }

  /**
   * Log callback'ini set et
   */
  setLogCallback(callback: (level: 'info' | 'warning' | 'error' | 'success', message: string, source?: string) => void): void {
    this.onLogUpdate = callback;
  }

  /**
   * Scanning başlat (Cache-aware)
   */
  async startScan(options: ScanOptions = {}): Promise<{
    results: ProjectScanResult[];
    summary: ScanSummary;
  }> {
    if (this.isScanning) {
      throw new Error('Zaten bir scan işlemi devam ediyor');
    }

    // Credentials kontrolü - önce options'dan, sonra localStorage'dan
    const credentials = options.credentials || CredentialManager.getCredentials();
    if (!credentials) {
      throw new Error('Unity Cloud Build credentials bulunamadı');
    }

    this.isScanning = true;
    this.shouldCancel = false;
    this.unityService = new UnityCloudBuildService(credentials.orgId, credentials.apiKey);

    this.log('info', 'Scan işlemi başlatılıyor...', 'ScanOrchestrator');
    this.log('info', `ORG_ID=${credentials.orgId}`, 'ScanOrchestrator');
    this.log('info', `API_KEY loaded: Yes`, 'ScanOrchestrator');

    try {
      // Sanity check
      const orgTotalBuilds = await this.unityService.sanityCheckOrg();
      this.log('info', `Organizasyon toplam build sayısı: ${orgTotalBuilds}`, 'ScanOrchestrator');

      // Projeleri listele
      const projects = await this.unityService.listProjects();
      const limitProjects = options.limitProjects || credentials.limitProjects || -1;
      const projectsToScan = limitProjects > 0 ? projects.slice(0, limitProjects) : projects;

      this.log('info', `Toplam proje: ${projects.length} (ilk ${projectsToScan.length} taranacak)`, 'ScanOrchestrator');

      this.updateProgress({
        totalProjects: projectsToScan.length,
        currentProject: 0,
        currentProjectName: '',
        currentTarget: 0,
        totalTargets: 0,
        isScanning: true,
        canCancel: true
      });

      const db = DatabaseService.getInstance();
      const cacheMaxAgeMs = options.cacheMaxAgeMs || 3600000; // Default 1 saat
      
      // Organization'ı database'e kaydet
      await db.upsertOrganization(credentials.orgId);

      const results: ProjectScanResult[] = [];
      let totalBuilds = 0;
      let totalTargets = 0;
      let totalErrors = 0;
      let cachedProjects = 0;
      let freshProjects = 0;

      // Her projeyi sırayla işle
      for (let i = 0; i < projectsToScan.length; i++) {
        if (this.shouldCancel) {
          this.log('warning', 'Scan işlemi kullanıcı tarafından iptal edildi', 'ScanOrchestrator');
          break;
        }

        const project = projectsToScan[i];
        const projectId = project.projectid || project.projectId || project.id || '';
        const projectName = project.name || project.projectName || projectId;

        this.log('info', `[${i + 1}/${projectsToScan.length}] Proje: ${projectName} (${projectId})`, 'ScanOrchestrator');

        this.updateProgress({
          currentProject: i + 1,
          currentProjectName: projectName,
          currentTarget: 0,
          totalTargets: 0
        });

        try {
          // Cache kontrolü yap
          const isCached = await db.isProjectCached(projectId, cacheMaxAgeMs);
          
          if (isCached) {
            // Cache'den veri çek
            this.log('info', `${projectName}: Cache'den çekiliyor...`, 'ScanOrchestrator');
            
            const cachedProject = await db.getProject(projectId);
            const latestScanResult = await db.getLatestScanResult(projectId);
            
            if (latestScanResult && cachedProject) {
              results.push({
                projectId,
                projectName,
                totalBuilds: latestScanResult.totalBuilds,
                targetCount: latestScanResult.totalTargets,
                scannedTargets: latestScanResult.scannedTargets,
                status: latestScanResult.status,
                errors: latestScanResult.errorMessage ? [latestScanResult.errorMessage] : [],
                isFromCache: true,
                cachedAt: cachedProject.lastScannedAt
              });

              totalBuilds += latestScanResult.totalBuilds;
              totalTargets += latestScanResult.totalTargets;
              cachedProjects++;

              this.log('success', `${projectName}: ${latestScanResult.totalBuilds} builds (Cache'den)`, 'ScanOrchestrator');
              continue;
            }
          }

          // Cache'de yok veya expired - API'den çek
          this.log('info', `${projectName}: API'den taranıyor...`, 'ScanOrchestrator');
          const startTime = Date.now();
          
          const result = await this.unityService.getTotalBuildsForProject(
            projectId,
            options.limitTargets || credentials.limitTargets
          );

          const scanStatus: 'completed' | 'failed' | 'partial' = 
            result.errors.length === 0 ? 'completed' : 
            result.scannedTargets > 0 ? 'partial' : 'failed';

          const completedAt = new Date();
          const durationMs = Date.now() - startTime;

          // Projeyi database'e kaydet
          await db.saveProject({
            id: projectId,
            name: projectName,
            organizationId: credentials.orgId,
            description: project.description,
            lastScannedAt: completedAt
          });

          // Scan result'ı kaydet
          const scanResultId = await db.saveScanResult({
            projectId,
            status: scanStatus,
            totalBuilds: result.totalBuilds,
            totalTargets: result.targetCount,
            scannedTargets: result.scannedTargets,
            errorMessage: result.errors.length > 0 ? result.errors.join('; ') : undefined,
            startedAt: new Date(startTime),
            completedAt,
            durationMs
          });

          // Build targets bilgilerini çek ve kaydet
          try {
            const targets = await this.unityService.listBuildTargets(projectId);
            const limitTargets = options.limitTargets || credentials.limitTargets;
            const targetsToSave = limitTargets ? targets.slice(0, limitTargets) : targets;
            
            for (const target of targetsToSave) {
              const targetId = target.buildtargetid || target.buildTargetId || '';
              if (targetId) {
                await db.saveBuildTarget({
                  id: targetId,
                  name: target.name,
                  platform: target.platform,
                  projectId,
                  enabled: target.enabled ?? true
                });

                // Build count'u API'den çek ve kaydet
                try {
                  const buildCount = await this.unityService.countBuilds(projectId, targetId);
                  await db.saveBuildCount(targetId, buildCount, scanResultId);
                } catch (error) {
                  // Build count hatası kritik değil, devam et
                  this.log('warning', `${projectName} - ${target.name}: Build count alınamadı`, 'ScanOrchestrator');
                }
              }
            }
          } catch (error) {
            // Build target bilgilerini kaydetme hatası kritik değil
            this.log('warning', `${projectName}: Build target bilgileri kaydedilemedi`, 'ScanOrchestrator');
          }

          results.push({
            projectId,
            projectName,
            totalBuilds: result.totalBuilds,
            targetCount: result.targetCount,
            scannedTargets: result.scannedTargets,
            status: scanStatus,
            errors: result.errors,
            isFromCache: false
          });

          totalBuilds += result.totalBuilds;
          totalTargets += result.targetCount;
          totalErrors += result.errors.length;
          freshProjects++;

          this.log('success', `${projectName}: ${result.totalBuilds} builds (${result.scannedTargets}/${result.targetCount} targets)`, 'ScanOrchestrator');

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.log('error', `${projectName} işlenirken hata: ${errorMessage}`, 'ScanOrchestrator');

          results.push({
            projectId,
            projectName,
            totalBuilds: 0,
            targetCount: 0,
            scannedTargets: 0,
            status: 'failed',
            errors: [errorMessage],
            isFromCache: false
          });

          totalErrors++;
          freshProjects++;
        }

        // Kısa bir bekleme (rate limiting için)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const summary: ScanSummary = {
        totalProjects: projectsToScan.length,
        completedProjects: results.filter(r => r.status === 'completed').length,
        totalBuilds,
        totalTargets,
        totalErrors,
        cachedProjects,
        freshProjects
      };

      this.log('success', `Scan tamamlandı! ${summary.completedProjects}/${summary.totalProjects} proje, ${cachedProjects} cache'den, ${freshProjects} yeni tarandı. Toplam ${totalBuilds} build`, 'ScanOrchestrator');

      // Progress'i sıfırla
      this.updateProgress({
        currentProject: 0,
        totalProjects: 0,
        currentProjectName: '',
        currentTarget: 0,
        totalTargets: 0,
        isScanning: false,
        canCancel: false
      });

      return { results, summary };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `Scan işlemi başarısız: ${errorMessage}`, 'ScanOrchestrator');
      throw error;
    } finally {
      this.isScanning = false;
      this.shouldCancel = false;
    }
  }

  /**
   * Scan'i iptal et
   */
  cancelScan(): void {
    if (this.isScanning) {
      this.shouldCancel = true;
      this.log('info', 'Scan iptal ediliyor...', 'ScanOrchestrator');
    }
  }

  /**
   * Mevcut progress'i getir
   */
  getScanProgress(): ScanProgress {
    return { ...this.currentProgress };
  }

  /**
   * Scan durumunu kontrol et
   */
  isCurrentlyScanning(): boolean {
    return this.isScanning;
  }

  /**
   * Progress güncelle ve callback'i çağır
   */
  private updateProgress(updates: Partial<ScanProgress>): void {
    this.currentProgress = {
      ...this.currentProgress,
      ...updates
    };

    if (this.onProgressUpdate) {
      this.onProgressUpdate(this.currentProgress);
    }
  }

  /**
   * Log mesajı gönder
   */
  private log(level: 'info' | 'warning' | 'error' | 'success', message: string, source?: string): void {
    if (this.onLogUpdate) {
      this.onLogUpdate(level, message, source);
    }
  }
}
