import { AppConfig } from '@/types';

const STORAGE_KEY = 'unity-cloud-build-config';

export class CredentialManager {
  /**
   * Local storage'dan credentials'ları getir
   */
  static getCredentials(): AppConfig | null {
    if (typeof window === 'undefined') return null;
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      
      const config = JSON.parse(stored) as AppConfig;
      
      // Temel validation
      if (!config.orgId || !config.apiKey) {
        return null;
      }
      
      return config;
    } catch (error) {
      console.error('Credentials parse error:', error);
      return null;
    }
  }

  /**
   * Credentials'ları local storage'a kaydet
   */
  static storeCredentials(orgId: string, apiKey: string, options?: {
    limitProjects?: number;
    limitTargets?: number;
  }): void {
    if (typeof window === 'undefined') return;
    
    const config: AppConfig = {
      orgId: orgId.trim(),
      apiKey: apiKey.trim(),
      limitProjects: options?.limitProjects,
      limitTargets: options?.limitTargets
    };
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('Credentials store error:', error);
      throw new Error('Local storage yazma hatası');
    }
  }

  /**
   * Credentials'ları temizle
   */
  static clearCredentials(): void {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Credentials clear error:', error);
    }
  }

  /**
   * API key format validation
   */
  static validateApiKeyFormat(apiKey: string): boolean {
    if (!apiKey || typeof apiKey !== 'string') {
      return false;
    }
    
    const trimmed = apiKey.trim();
    
    // Unity Cloud Build API key genelde base64 benzeri format
    // En az 20 karakter, alfanumerik + bazı özel karakterler
    const apiKeyPattern = /^[A-Za-z0-9+/=_-]{20,}$/;
    
    return apiKeyPattern.test(trimmed);
  }

  /**
   * Organization ID format validation
   */
  static validateOrgIdFormat(orgId: string): boolean {
    if (!orgId || typeof orgId !== 'string') {
      return false;
    }
    
    const trimmed = orgId.trim();
    
    // Unity org ID genelde UUID format veya özel string
    // En az 8 karakter, alfanumerik + tire
    const orgIdPattern = /^[A-Za-z0-9-]{8,}$/;
    
    return orgIdPattern.test(trimmed);
  }

  /**
   * Credentials'ın dolu olup olmadığını kontrol et
   */
  static hasValidCredentials(): boolean {
    const credentials = this.getCredentials();
    
    if (!credentials) return false;
    
    return this.validateOrgIdFormat(credentials.orgId) && 
           this.validateApiKeyFormat(credentials.apiKey);
  }

  /**
   * Credentials'ı güncelle (merge)
   */
  static updateCredentials(updates: Partial<AppConfig>): void {
    const current = this.getCredentials();
    
    if (!current) {
      throw new Error('Mevcut credentials bulunamadı');
    }
    
    const updated: AppConfig = {
      ...current,
      ...updates
    };
    
    // Temel alanlar boş olamaz
    if (!updated.orgId || !updated.apiKey) {
      throw new Error('OrgId ve ApiKey boş olamaz');
    }
    
    this.storeCredentials(updated.orgId, updated.apiKey, {
      limitProjects: updated.limitProjects,
      limitTargets: updated.limitTargets
    });
  }

  /**
   * Credentials export (yedekleme için)
   */
  static exportCredentials(): string | null {
    const credentials = this.getCredentials();
    
    if (!credentials) return null;
    
    // API key'i güvenlik için maskeleyerek export et
    const masked = {
      ...credentials,
      apiKey: credentials.apiKey.slice(0, 4) + '***' + credentials.apiKey.slice(-4)
    };
    
    return JSON.stringify(masked, null, 2);
  }
}
