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
    const orgId = this.apiClient.getOrgId();
    
    // buildtarget id path segmentini güvenli hale getir (Python'daki quote karşılığı)
    const encodedBuildTargetId = encodeURIComponent(buildTargetId);
    
    const response = await this.apiClient.get(
      `/orgs/${orgId}/projects/${projectId}/buildtargets/${encodedBuildTargetId}/builds`,
      {
        per_page: 1,
        page: 1
      }
    );

    const total = this.apiClient.getContentRangeTotal(response);
    const contentRangeHeader = response.headers.get('Content-Range');
    
    console.log(`    ↳ target=${buildTargetId}  Content-Range=${contentRangeHeader}  -> ${total}`);
    return total;
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
