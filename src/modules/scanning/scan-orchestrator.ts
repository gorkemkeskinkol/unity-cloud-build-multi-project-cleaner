import { UnityCloudBuildService } from '@/modules/api/unity-cloud-build';
import { CredentialManager } from '@/modules/config/credential-manager';
import { ScanOptions, ScanProgress, ScanResult, UnityProject } from '@/types';

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
   * Scanning başlat
   */
  async startScan(options: ScanOptions = {}): Promise<{
    results: Array<{
      projectId: string;
      projectName: string;
      totalBuilds: number;
      targetCount: number;
      scannedTargets: number;
      status: 'completed' | 'failed' | 'partial';
      errors: string[];
    }>;
    summary: {
      totalProjects: number;
      completedProjects: number;
      totalBuilds: number;
      totalTargets: number;
      totalErrors: number;
    };
  }> {
    if (this.isScanning) {
      throw new Error('Zaten bir scan işlemi devam ediyor');
    }

    // Credentials kontrolü
    const credentials = CredentialManager.getCredentials();
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

      const results: Array<{
        projectId: string;
        projectName: string;
        totalBuilds: number;
        targetCount: number;
        scannedTargets: number;
        status: 'completed' | 'failed' | 'partial';
        errors: string[];
      }> = [];
      let totalBuilds = 0;
      let totalTargets = 0;
      let totalErrors = 0;

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
          const result = await this.unityService.getTotalBuildsForProject(
            projectId,
            options.limitTargets || credentials.limitTargets
          );

          results.push({
            projectId,
            projectName,
            totalBuilds: result.totalBuilds,
            targetCount: result.targetCount,
            scannedTargets: result.scannedTargets,
            status: result.errors.length === 0 ? 'completed' as const : 
                   result.scannedTargets > 0 ? 'partial' as const : 'failed' as const,
            errors: result.errors
          });

          totalBuilds += result.totalBuilds;
          totalTargets += result.targetCount;
          totalErrors += result.errors.length;

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
            errors: [errorMessage]
          });

          totalErrors++;
        }

        // Kısa bir bekleme (rate limiting için)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const summary = {
        totalProjects: projectsToScan.length,
        completedProjects: results.filter(r => r.status === 'completed').length,
        totalBuilds,
        totalTargets,
        totalErrors
      };

      this.log('success', `Scan tamamlandı! ${summary.completedProjects}/${summary.totalProjects} proje, toplam ${totalBuilds} build`, 'ScanOrchestrator');

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
