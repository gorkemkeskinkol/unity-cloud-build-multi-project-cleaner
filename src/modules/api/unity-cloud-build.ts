import { ApiClient, ApiError } from './api-client';
import { UnityProject, UnityBuildTarget } from '@/types';

export class UnityCloudBuildService {
  private apiClient: ApiClient;

  constructor(orgId: string, apiKey: string) {
    this.apiClient = new ApiClient(orgId, apiKey);
  }

  /**
   * Python scriptindeki sanity_check_org_has_builds fonksiyonunun karşılığı
   */
  async sanityCheckOrg(): Promise<number> {
    try {
      const orgId = this.apiClient.getOrgId();
      const response = await this.apiClient.get(`/orgs/${orgId}/builds`, {
        per_page: 1,
        page: 1
      });

      const total = this.apiClient.getContentRangeTotal(response);
      const contentRangeHeader = response.headers.get('Content-Range');
      
      console.log(`[ORG SCAN] Content-Range=${contentRangeHeader} -> org toplam build: ${total}`);
      return total;
    } catch (error) {
      if (error instanceof ApiError) {
        console.log(`[ORG SCAN] Hata: ${error.status} ${error.details?.slice(0, 200)}`);
        return 0;
      }
      throw error;
    }
  }

  /**
   * Python scriptindeki list_projects fonksiyonunun karşılığı
   */
  async listProjects(): Promise<UnityProject[]> {
    const orgId = this.apiClient.getOrgId();
    const response = await this.apiClient.get(`/orgs/${orgId}/projects`);
    const projects = await response.json() as UnityProject[];
    return projects;
  }

  /**
   * Python scriptindeki list_build_targets fonksiyonunun karşılığı
   */
  async listBuildTargets(projectId: string): Promise<UnityBuildTarget[]> {
    const orgId = this.apiClient.getOrgId();
    const response = await this.apiClient.get(`/orgs/${orgId}/projects/${projectId}/buildtargets`);
    const buildTargets = await response.json() as UnityBuildTarget[];
    return buildTargets;
  }

  /**
   * Python scriptindeki count_builds_for_target fonksiyonunun karşılığı
   */
  async countBuilds(projectId: string, buildTargetId: string): Promise<number> {
    try {
      const orgId = this.apiClient.getOrgId();
      
      // buildtarget id path segmentini güvenli hale getir (Python'daki quote karşılığı)
      const encodedBuildTargetId = encodeURIComponent(buildTargetId);
      
      const endpoint = `/orgs/${orgId}/projects/${projectId}/buildtargets/${encodedBuildTargetId}/builds`;
      console.log(`[COUNT_BUILDS] Endpoint: ${endpoint}`);
      
      const response = await this.apiClient.get(
        endpoint,
        {
          per_page: 1,
          page: 1
        }
      );

      const total = this.apiClient.getContentRangeTotal(response);
      const contentRangeHeader = response.headers.get('Content-Range');
      
      console.log(`    ↳ target=${buildTargetId}  Content-Range=${contentRangeHeader}  -> ${total}`);
      return total;
    } catch (error) {
      console.error(`[COUNT_BUILDS ERROR] projectId=${projectId}, targetId=${buildTargetId}:`, error);
      throw error;
    }
  }

  /**
   * Credentials güncelleme
   */
  updateCredentials(orgId: string, apiKey: string): void {
    this.apiClient.updateCredentials(orgId, apiKey);
  }

  /**
   * API key test etme
   */
  async validateCredentials(): Promise<boolean> {
    try {
      await this.sanityCheckOrg();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Bir buildtarget'ın tüm artifact'lerini sil
   */
  async deleteArtifactsForTarget(projectId: string, buildTargetId: string): Promise<void> {
    const orgId = this.apiClient.getOrgId();
    const encodedBuildTargetId = encodeURIComponent(buildTargetId);
    
    const endpoint = `/orgs/${orgId}/projects/${projectId}/buildtargets/${encodedBuildTargetId}/builds/artifacts`;
    console.log(`[DELETE_ARTIFACTS] Endpoint: ${endpoint}`);
    
    await this.apiClient.delete(endpoint);
  }

  /**
   * Bir projenin tüm buildtarget'lerinin artifact'lerini sil
   */
  async deleteAllBuildsForProject(
    projectId: string,
    onProgress?: (current: number, total: number, targetName: string) => void
  ): Promise<{
    deletedTargets: number;
    totalTargets: number;
    errors: Array<{ targetId: string; targetName: string; error: string }>;
  }> {
    const errors: Array<{ targetId: string; targetName: string; error: string }> = [];
    let deletedTargets = 0;

    try {
      // Tüm buildtarget'leri listele
      const targets = await this.listBuildTargets(projectId);
      const totalTargets = targets.length;
      
      console.log(`[DELETE_ALL_BUILDS] Proje ${projectId} için ${totalTargets} target bulundu`);
      
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const buildTargetId = target.buildtargetid || target.buildTargetId;
        const targetName = target.name || buildTargetId || 'Unknown';
        
        if (!buildTargetId) {
          errors.push({
            targetId: 'unknown',
            targetName: targetName,
            error: 'buildtargetid bulunamadı'
          });
          continue;
        }

        try {
          // Progress callback
          if (onProgress) {
            onProgress(i + 1, totalTargets, targetName);
          }

          // Artifact'leri sil
          await this.deleteArtifactsForTarget(projectId, buildTargetId);
          deletedTargets++;
          
          console.log(`[DELETE_ALL_BUILDS] ✓ ${targetName} artifact'leri silindi (${i + 1}/${totalTargets})`);
          
          // Rate limiting için küçük delay
          if (i < targets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 700));
          }
        } catch (error) {
          const errorMessage = error instanceof ApiError 
            ? `${error.status}: ${error.details?.slice(0, 200)}` 
            : String(error);
          
          errors.push({
            targetId: buildTargetId,
            targetName: targetName,
            error: errorMessage
          });
          
          console.error(`[DELETE_ALL_BUILDS] ✗ ${targetName} artifact silme hatası:`, errorMessage);
        }
      }

      return {
        deletedTargets,
        totalTargets,
        errors
      };
    } catch (error) {
      // Buildtarget listelenemedi
      const errorMessage = error instanceof ApiError 
        ? `${error.status}: ${error.details?.slice(0, 200)}` 
        : String(error);
      
      console.error(`[DELETE_ALL_BUILDS] buildtargets alınamadı:`, errorMessage);
      
      return {
        deletedTargets: 0,
        totalTargets: 0,
        errors: [{
          targetId: 'N/A',
          targetName: 'N/A',
          error: `Buildtarget listesi alınamadı: ${errorMessage}`
        }]
      };
    }
  }

  /**
   * Tek bir proje için tüm build sayılarını topla
   */
  async getTotalBuildsForProject(projectId: string, limitTargets?: number): Promise<{
    projectId: string;
    totalBuilds: number;
    targetCount: number;
    scannedTargets: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let totalBuilds = 0;
    let scannedTargets = 0;

    try {
      const targets = await this.listBuildTargets(projectId);
      const targetCount = targets.length;
      
      console.log(`  Hedef sayısı: ${targetCount}`);
      
      // Limit varsa hedefleri kısıtla
      const targetsToProcess = limitTargets ? targets.slice(0, limitTargets) : targets;
      
      for (const target of targetsToProcess) {
        const buildTargetId = target.buildtargetid || target.buildTargetId;
        
        if (!buildTargetId) {
          errors.push(`buildtargetid yok, anahtarlar: ${Object.keys(target).join(', ')}`);
          continue;
        }

        try {
          const buildCount = await this.countBuilds(projectId, buildTargetId);
          totalBuilds += buildCount;
          scannedTargets++;
        } catch (error) {
          if (error instanceof ApiError) {
            errors.push(`/builds isteğinde hata: ${error.status} ${error.details?.slice(0, 200)}`);
          } else {
            errors.push(`Bilinmeyen hata: ${error}`);
          }
        }
      }

      return {
        projectId,
        totalBuilds,
        targetCount,
        scannedTargets,
        errors
      };
    } catch (error) {
      if (error instanceof ApiError) {
        errors.push(`buildtargets alınamadı: ${error.status} ${error.details?.slice(0, 200)}`);
      } else {
        errors.push(`Bilinmeyen hata: ${error}`);
      }

      return {
        projectId,
        totalBuilds: 0,
        targetCount: 0,
        scannedTargets: 0,
        errors
      };
    }
  }
}
