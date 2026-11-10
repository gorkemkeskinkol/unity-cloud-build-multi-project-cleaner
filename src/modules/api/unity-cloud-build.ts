import { ApiClient, ApiError, CancelledError, WaitInfo } from './api-client';
import { UnityProject, UnityBuildTarget, ProjectScanData, TargetScanData } from '@/types';

export class UnityCloudBuildService {
  private apiClient: ApiClient;

  constructor(orgId: string, apiKey: string) {
    this.apiClient = new ApiClient(orgId, apiKey);
  }

  /** Rate limit / retry beklemelerini dışarı bildirir (loglama için) */
  setWaitCallback(callback?: (info: WaitInfo) => void): void {
    this.apiClient.setWaitCallback(callback);
  }

  /** true dönerse süren beklemeler kesilir */
  setCancelCheck(check?: () => boolean): void {
    this.apiClient.setCancelCheck(check);
  }

  /**
   * Python scriptindeki sanity_check_org_has_builds fonksiyonunun karşılığı.
   * Auth hatası (401) yukarı fırlatılır; diğer hatalarda 0 döner.
   */
  async sanityCheckOrg(): Promise<number> {
    try {
      const orgId = this.apiClient.getOrgId();
      const response = await this.apiClient.get(`/orgs/${orgId}/builds`, {
        per_page: 1,
        page: 1
      });

      const total = this.apiClient.getContentRangeTotal(response);
      console.log(`[ORG SCAN] Content-Range=${response.headers.get('Content-Range')} -> org toplam build: ${total}`);
      return total;
    } catch (error) {
      if (error instanceof ApiError && error.kind !== 'auth' && error.kind !== 'rate_limit') {
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
    return await response.json() as UnityProject[];
  }

  /**
   * Python scriptindeki list_build_targets fonksiyonunun karşılığı
   */
  async listBuildTargets(projectId: string): Promise<UnityBuildTarget[]> {
    const orgId = this.apiClient.getOrgId();
    const response = await this.apiClient.get(`/orgs/${orgId}/projects/${projectId}/buildtargets`);
    return await response.json() as UnityBuildTarget[];
  }

  /**
   * Python scriptindeki count_builds_for_target fonksiyonunun karşılığı
   */
  async countBuilds(projectId: string, buildTargetId: string): Promise<number> {
    const orgId = this.apiClient.getOrgId();
    const encodedBuildTargetId = encodeURIComponent(buildTargetId);
    const endpoint = `/orgs/${orgId}/projects/${projectId}/buildtargets/${encodedBuildTargetId}/builds`;

    const response = await this.apiClient.get(endpoint, { per_page: 1, page: 1 });
    const total = this.apiClient.getContentRangeTotal(response);
    console.log(`    ↳ target=${buildTargetId}  Content-Range=${response.headers.get('Content-Range')}  -> ${total}`);
    return total;
  }

  /**
   * Bir projeyi tek seferde tarar: target listesi + her target'ın build sayısı.
   * Sonuç hem toplamları hem de target bazında detayı içerir; çağıran taraf
   * aynı veriyi tekrar API'den çekmek zorunda kalmaz.
   *
   * - Tek bir target'ta kalıcı hata olursa o target `buildCount: null` ile işaretlenir, tarama sürer.
   * - Rate limit beklemeleri tükendiyse veya iptal edildiyse hata yukarı fırlatılır
   *   (devam etmenin anlamı yok; orkestratör karar verir).
   */
  async scanProject(projectId: string, limitTargets?: number): Promise<ProjectScanData> {
    const errors: string[] = [];
    const targets: TargetScanData[] = [];
    let totalBuilds = 0;
    let scannedTargets = 0;

    let rawTargets: UnityBuildTarget[];
    try {
      rawTargets = await this.listBuildTargets(projectId);
    } catch (error) {
      if (isFatal(error)) throw error;
      const message = error instanceof ApiError ? error.describe() : String(error);
      return {
        projectId,
        totalBuilds: 0,
        targetCount: 0,
        scannedTargets: 0,
        targets: [],
        errors: [`buildtargets alınamadı: ${message}`]
      };
    }

    const targetCount = rawTargets.length;
    console.log(`  Hedef sayısı: ${targetCount}`);
    const targetsToProcess = limitTargets ? rawTargets.slice(0, limitTargets) : rawTargets;

    for (const target of targetsToProcess) {
      const buildTargetId = target.buildtargetid || target.buildTargetId;
      if (!buildTargetId) {
        errors.push(`buildtargetid yok, anahtarlar: ${Object.keys(target).join(', ')}`);
        continue;
      }

      const entry: TargetScanData = {
        id: buildTargetId,
        name: target.name || buildTargetId,
        platform: target.platform,
        enabled: target.enabled ?? true,
        buildCount: null
      };

      try {
        const count = await this.countBuilds(projectId, buildTargetId);
        entry.buildCount = count;
        totalBuilds += count;
        scannedTargets++;
      } catch (error) {
        if (isFatal(error)) throw error;
        const message = error instanceof ApiError ? error.describe() : String(error);
        entry.error = message;
        errors.push(`${entry.name}: ${message}`);
        console.error(`[COUNT_BUILDS ERROR] projectId=${projectId}, targetId=${buildTargetId}: ${message}`);
      }

      targets.push(entry);
    }

    return {
      projectId,
      totalBuilds,
      targetCount,
      scannedTargets,
      targets,
      errors
    };
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
    } catch {
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
   * Bir projenin tüm buildtarget'lerinin artifact'lerini sil.
   * Tek target'ta kalıcı hata olursa kaydedilir ve devam edilir; rate limit
   * beklemeleri tükenirse, key geçersizse veya iptal edildiyse hata fırlatılır.
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

    let targets: UnityBuildTarget[];
    try {
      targets = await this.listBuildTargets(projectId);
    } catch (error) {
      if (isFatal(error)) throw error;
      const errorMessage = error instanceof ApiError ? error.describe() : String(error);
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

    const totalTargets = targets.length;
    console.log(`[DELETE_ALL_BUILDS] Proje ${projectId} için ${totalTargets} target bulundu`);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const buildTargetId = target.buildtargetid || target.buildTargetId;
      const targetName = target.name || buildTargetId || 'Unknown';

      if (!buildTargetId) {
        errors.push({ targetId: 'unknown', targetName, error: 'buildtargetid bulunamadı' });
        continue;
      }

      try {
        onProgress?.(i + 1, totalTargets, targetName);
        await this.deleteArtifactsForTarget(projectId, buildTargetId);
        deletedTargets++;
        console.log(`[DELETE_ALL_BUILDS] ✓ ${targetName} artifact'leri silindi (${i + 1}/${totalTargets})`);
      } catch (error) {
        // Rate limit tükendi veya key geçersiz: sonraki target'ları denemek anlamsız
        if (isFatal(error)) throw error;
        const errorMessage = error instanceof ApiError ? error.describe() : String(error);
        errors.push({ targetId: buildTargetId, targetName, error: errorMessage });
        console.error(`[DELETE_ALL_BUILDS] ✗ ${targetName} artifact silme hatası:`, errorMessage);
      }
    }

    return { deletedTargets, totalTargets, errors };
  }
}

/** Devam etmenin anlamsız olduğu hatalar: iptal, tükenmiş rate limit, geçersiz key */
function isFatal(error: unknown): boolean {
  if (error instanceof CancelledError) return true;
  if (error instanceof ApiError) {
    return error.kind === 'rate_limit' || error.kind === 'auth';
  }
  return false;
}

export { isFatal };
