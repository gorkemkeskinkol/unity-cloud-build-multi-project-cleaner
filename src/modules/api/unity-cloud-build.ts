import { ApiClient, ApiError, CancelledError, WaitInfo } from './api-client';
import { UnityProject, UnityBuildTarget, UnityBuild, ProjectScanData, TargetScanData, OrgBuildAggregate } from '@/types';

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
   * Bir projeyi tarar: /orgs/{org}/projects/{p}/builds listesi 100'lük sayfalarla
   * çekilir, target bazında build ve artifact'i duran build sayılır.
   * Çoğu proje için 1 istek (eski yöntem: 1 + target sayısı, Content-Range ile).
   * Yalnızca en az 1 build'i olan target'lar görünür.
   */
  async scanProject(projectId: string, limitTargets?: number): Promise<ProjectScanData> {
    const orgId = this.apiClient.getOrgId();
    const perPage = 100;
    const targets = new Map<string, TargetScanData>();
    let totalBuilds = 0;
    let artifactBuilds = 0;
    let page = 1;
    let fetched = 0;
    let total = Infinity;

    while (fetched < total) {
      const response = await this.apiClient.get(`/orgs/${orgId}/projects/${projectId}/builds`, { per_page: perPage, page });
      const builds = await response.json() as UnityBuild[];
      const range = this.apiClient.parseContentRange(response);
      if (range) total = range.total;
      else if (builds.length < perPage) total = fetched + builds.length;

      for (const build of builds) {
        const targetId = build.buildtargetid;
        if (!targetId) continue;
        let target = targets.get(targetId);
        if (!target) {
          target = { id: targetId, name: build.buildTargetName || targetId, platform: build.platform, enabled: true, buildCount: 0, artifactCount: 0 };
          targets.set(targetId, target);
        }
        target.buildCount = (target.buildCount ?? 0) + 1;
        totalBuilds++;
        if (hasArtifacts(build)) {
          target.artifactCount = (target.artifactCount ?? 0) + 1;
          artifactBuilds++;
        }
      }

      fetched += builds.length;
      if (builds.length === 0) break;
      page++;
    }

    const list = Array.from(targets.values());
    const limited = limitTargets ? list.slice(0, limitTargets) : list;
    console.log(`  ${projectId}: ${totalBuilds} build (${artifactBuilds} artifact'li), ${list.length} target, ${page} sayfa`);

    return {
      projectId,
      totalBuilds: limited.reduce((sum, t) => sum + (t.buildCount ?? 0), 0),
      artifactBuilds: limited.reduce((sum, t) => sum + (t.artifactCount ?? 0), 0),
      targetCount: list.length,
      scannedTargets: limited.length,
      targets: limited,
      errors: []
    };
  }

  /**
   * Org genelindeki build listesini sayfa sayfa çekip proje/target bazında sayar.
   *
   * Neden: target başına /builds çağrısı (per_page=1, Content-Range'den toplam)
   * 250 proje için ~650 istek demek ve Unity'nin abuse detection'ı ~170 /builds
   * isteğinden sonra saatlerce ban veriyor. Org listesi 3600 build'i 100'lük
   * sayfalarla ~40 istekte verir.
   *
   * Not: yalnızca en az 1 build'i olan target'lar görünür; boş target'lar
   * temizlik için zaten önemsizdir.
   */
  async aggregateOrgBuilds(options: {
    perPage?: number;
    onPage?: (page: number, totalPages: number, fetched: number, total: number) => Promise<void> | void;
  } = {}): Promise<OrgBuildAggregate> {
    const orgId = this.apiClient.getOrgId();
    const perPage = options.perPage ?? 100;
    const aggregate: OrgBuildAggregate = { projects: new Map(), totalBuilds: 0, pages: 0 };

    let page = 1;
    let fetched = 0;
    let total = Infinity;
    let totalPages = 1;

    while (fetched < total) {
      const response = await this.apiClient.get(`/orgs/${orgId}/builds`, { per_page: perPage, page });
      const builds = await response.json() as UnityBuild[];
      const range = this.apiClient.parseContentRange(response);

      if (range) {
        total = range.total;
        totalPages = Math.max(1, Math.ceil(total / perPage));
      } else if (builds.length < perPage) {
        total = fetched + builds.length;
      }

      if (page === 1) {
        console.log(`[ORG BUILDS] sayfa 1: ${builds.length} kayıt, Content-Range=${response.headers.get('Content-Range')}, örnek alanlar: ${builds[0] ? Object.keys(builds[0]).slice(0, 25).join(',') : '-'}`);
      }

      for (const build of builds) {
        const projectKey = build.projectGuid || build.projectId;
        const targetId = build.buildtargetid;
        if (!projectKey || !targetId) continue;

        let project = aggregate.projects.get(projectKey);
        if (!project) {
          project = { projectName: build.projectName, targets: new Map(), totalBuilds: 0 };
          aggregate.projects.set(projectKey, project);
        }
        let target = project.targets.get(targetId);
        if (!target) {
          target = { name: build.buildTargetName || targetId, platform: build.platform, count: 0, withArtifacts: 0 };
          project.targets.set(targetId, target);
        }
        target.count++;
        project.totalBuilds++;
        aggregate.totalBuilds++;
        if (hasArtifacts(build)) target.withArtifacts++;
      }

      fetched += builds.length;
      aggregate.pages = page;
      await options.onPage?.(page, totalPages, fetched, total === Infinity ? fetched : total);

      if (builds.length === 0) break; // güvenlik: boş sayfa gelirse sonsuz döngüye girme
      page++;
    }

    return aggregate;
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
   * `skipTargetIds` ile daha önce silinmiş target'lar atlanır (job resume).
   */
  async deleteAllBuildsForProject(
    projectId: string,
    options: {
      skipTargetIds?: Set<string>;
      onTargetsListed?: (targets: Array<{ id: string; name: string }>) => Promise<void> | void;
      onTargetStart?: (targetId: string, targetName: string, index: number, total: number) => Promise<void> | void;
      onTargetDone?: (targetId: string, targetName: string, error: string | null) => Promise<void> | void;
    } = {}
  ): Promise<{
    deletedTargets: number;
    totalTargets: number;
    skippedTargets: number;
    errors: Array<{ targetId: string; targetName: string; error: string }>;
  }> {
    const errors: Array<{ targetId: string; targetName: string; error: string }> = [];
    let deletedTargets = 0;
    let skippedTargets = 0;

    // Buildtarget listesi alınamazsa (yetki, 404...) devam edilemez: hata yukarı gider
    const rawTargets = await this.listBuildTargets(projectId);
    const targets = rawTargets
      .map(t => ({ id: t.buildtargetid || t.buildTargetId || '', name: t.name || t.buildtargetid || t.buildTargetId || 'Unknown' }))
      .filter(t => t.id);
    const totalTargets = targets.length;
    console.log(`[DELETE_ALL_BUILDS] Proje ${projectId} için ${totalTargets} target bulundu`);
    await options.onTargetsListed?.(targets);

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      if (options.skipTargetIds?.has(target.id)) {
        skippedTargets++;
        continue;
      }

      await options.onTargetStart?.(target.id, target.name, i + 1, totalTargets);
      try {
        await this.deleteArtifactsForTarget(projectId, target.id);
        deletedTargets++;
        console.log(`[DELETE_ALL_BUILDS] ✓ ${target.name} artifact'leri silindi (${i + 1}/${totalTargets})`);
        await options.onTargetDone?.(target.id, target.name, null);
      } catch (error) {
        // Rate limit tükendi veya key geçersiz: sonraki target'ları denemek anlamsız
        if (isFatal(error)) throw error;
        const errorMessage = error instanceof ApiError ? error.describe() : String(error);
        errors.push({ targetId: target.id, targetName: target.name, error: errorMessage });
        console.error(`[DELETE_ALL_BUILDS] ✗ ${target.name} artifact silme hatası:`, errorMessage);
        await options.onTargetDone?.(target.id, target.name, errorMessage);
      }
    }

    return { deletedTargets, totalTargets, skippedTargets, errors };
  }
}

/** Artifact'i hâlâ duran build: başarılı ve artifact'leri silinmemiş */
function hasArtifacts(build: UnityBuild): boolean {
  return build.buildStatus === 'success' && !build.deletedArtifacts && !build.deleted;
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
