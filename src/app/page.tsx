'use client';

import { useState, useEffect } from 'react';
import { CredentialManager } from '@/modules/config/credential-manager';
import { LogProvider, useLog } from '@/contexts/LogContext';
import { AppConfig } from '@/types';
import { JobRecord, isActive } from '@/types/jobs';
import { useJobs } from '@/hooks/useJobs';
import { JobsPanel } from '@/components/JobsPanel';

interface SortOptions {
  field: 'totalBuilds';
  direction: 'asc' | 'desc';
}

// Setup Wizard Component
function SetupWizard({ onComplete }: { onComplete: (config: AppConfig) => void }) {
  const [orgId, setOrgId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsValidating(true);
    setError('');

    try {
      // Format validation
      if (!CredentialManager.validateOrgIdFormat(orgId)) {
        throw new Error('Organization ID formatı geçersiz');
      }
      if (!CredentialManager.validateApiKeyFormat(apiKey)) {
        throw new Error('API Key formatı geçersiz');
      }

      // Store credentials
      CredentialManager.storeCredentials(orgId, apiKey);
      
      // Get saved config
      const config = CredentialManager.getCredentials();
      if (config) {
        onComplete(config);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation hatası');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div style={{ maxWidth: '500px', margin: '50px auto', padding: '20px' }}>
      <h2>Unity Cloud Build Setup</h2>
      <p>Unity Cloud Build credentials'larınızı girin:</p>
      
      <form onSubmit={handleSubmit} style={{ marginTop: '20px' }}>
        <div style={{ marginBottom: '15px' }}>
          <label htmlFor="orgId" style={{ display: 'block', marginBottom: '5px' }}>
            Organization ID:
          </label>
          <input
            id="orgId"
            type="text"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="your-unity-org-id"
            required
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label htmlFor="apiKey" style={{ display: 'block', marginBottom: '5px' }}>
            API Key:
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="your-unity-cloud-build-api-key"
            required
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
          />
        </div>

        {error && (
          <div style={{ color: 'red', marginBottom: '15px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isValidating}
          style={{
            backgroundColor: isValidating ? '#ccc' : '#007bff',
            color: 'white',
            padding: '10px 20px',
            border: 'none',
            borderRadius: '4px',
            cursor: isValidating ? 'not-allowed' : 'pointer',
            width: '100%'
          }}
        >
          {isValidating ? 'Doğrulanıyor...' : 'Kaydet ve Devam Et'}
        </button>
      </form>

      <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
        <p><strong>Unity Cloud Build credentials nasıl alınır:</strong></p>
        <ol>
          <li>Unity Cloud Build dashboard'a gidin</li>
          <li>Organization ID'yi URL'den veya ayarlardan alın</li>
          <li>Settings → API → New API Key ile API key oluşturun</li>
        </ol>
      </div>
    </div>
  );
}

// Log Panel Component
function LogPanel() {
  const { logs, clearLogs, hasErrors } = useLog();

  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: '4px',
      height: 'calc(100vh - 120px)',
      overflow: 'auto',
      backgroundColor: '#f8f9fa',
      position: 'sticky',
      top: '20px'
    }}>
      <div style={{
        padding: '10px',
        borderBottom: '1px solid #ddd',
        backgroundColor: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 1
      }}>
        <h4 style={{ margin: 0 }}>
          Real-time Logs {hasErrors && <span style={{ color: 'red' }}>⚠️</span>}
        </h4>
        <button
          onClick={clearLogs}
          style={{
            padding: '4px 8px',
            fontSize: '12px',
            border: '1px solid #ccc',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          Clear
        </button>
      </div>
      <div style={{ padding: '10px' }}>
        {logs.length === 0 ? (
          <div style={{ color: '#666', fontStyle: 'italic' }}>
            Henüz log yok. Scan başlattığınızda loglar burada görünecek.
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              style={{
                marginBottom: '5px',
                padding: '5px',
                fontSize: '13px',
                backgroundColor: 
                  log.level === 'error' ? '#fff5f5' :
                  log.level === 'warning' ? '#fffbf0' :
                  log.level === 'success' ? '#f0fff4' : 'white',
                borderLeft: `3px solid ${
                  log.level === 'error' ? '#dc3545' :
                  log.level === 'warning' ? '#ffc107' :
                  log.level === 'success' ? '#28a745' : '#007bff'
                }`,
                borderRadius: '3px'
              }}
            >
              <span style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                [{log.level}]
              </span>
              {log.source && <span style={{ color: '#666' }}> [{log.source}]</span>}
              <span> {log.message}</span>
              {log.details && (
                <div style={{ marginTop: '2px', color: '#666', fontSize: '12px' }}>
                  {log.details}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Dashboard Component
function Dashboard({ config }: { config: AppConfig }) {
  const [limitProjects, setLimitProjects] = useState<number | undefined>(undefined); // Default boş
  const [cachedProjects, setCachedProjects] = useState<any[]>([]);
  const [isLoadingCache, setIsLoadingCache] = useState(true);
  const [cacheReloadKey, setCacheReloadKey] = useState(0);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isDeletingBuilds, setIsDeletingBuilds] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ projectId: string; projectName: string } | null>(null);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [sortOptions, setSortOptions] = useState<SortOptions>({ field: 'totalBuilds', direction: 'desc' });
  const { addLog } = useLog();

  // Job sistemi: liste, canlı güncellemeler, otomatik resume. Bir iş bitince cache listesi yenilenir.
  const { jobs, isLoading: isLoadingJobs, isConnected, createJob, cancelJob, resumeJob } = useJobs(config, () => {
    setCacheReloadKey(k => k + 1);
  });
  const activeScan = jobs.find(j => j.type === 'full_scan' && isActive(j));
  const isScanning = !!activeScan;
  const lastScan: JobRecord | undefined = jobs.find(j => j.type === 'full_scan' && j.status === 'completed');
  const scanResults = lastScan?.result as {
    totalProjects: number; completedProjects: number; totalBuilds: number; totalTargets: number;
    cachedProjects: number; freshProjects: number; passes: number;
    failedProjects: Array<{ projectId: string; projectName: string; status: string; errors: string[] }>;
  } | undefined;

  // Load cached projects on mount, when sorting changes, and after a job finishes
  useEffect(() => {
    const loadCachedProjects = async () => {
      try {
        setIsLoadingCache(true);
        const response = await fetch('/api/cache/projects');
        if (response.ok) {
          let projects = await response.json();

          // Apply sorting
          projects = [...projects].sort((a, b) => {
            const aVal = a.totalBuilds || 0;
            const bVal = b.totalBuilds || 0;
            if (aVal !== bVal) {
              return sortOptions.direction === 'desc' ? bVal - aVal : aVal - bVal;
            }
            return (a.name || '').localeCompare(b.name || '');
          });

          setCachedProjects(projects);
        }
      } catch (error) {
        console.error('Failed to load cached projects:', error);
      } finally {
        setIsLoadingCache(false);
      }
    };

    loadCachedProjects();
  }, [sortOptions, cacheReloadKey]);

  // Close dropdown menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId) {
        setOpenMenuId(null);
      }
    };

    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [openMenuId]);

  const startScan = async () => {
    if (isScanning) {
      addLog('warning', 'Zaten bir full scan işi sırada veya çalışıyor', 'Dashboard');
      return;
    }
    addLog('info', 'Full scan işi oluşturuluyor...', 'Dashboard');
    const job = await createJob('full_scan', {
      limitProjects: limitProjects,
      limitTargets: config.limitTargets
    });
    if (job) {
      addLog('success', `Full scan işi sıraya alındı (${job.id.slice(-6)}). İlerleme "Jobs" panelinde; sekmeyi kapatsanız da iş sürer.`, 'Dashboard');
    }
  };

  const cancelScan = async () => {
    if (!activeScan) return;
    await cancelJob(activeScan.id);
  };

  const clearCredentials = () => {
    CredentialManager.clearCredentials();
    window.location.reload();
  };

  // Helper functions for checkbox management
  const toggleSelectAll = () => {
    if (selectedProjects.size === cachedProjects.length) {
      setSelectedProjects(new Set());
    } else {
      setSelectedProjects(new Set(cachedProjects.map(p => p.id)));
    }
  };

  const toggleSelectProject = (projectId: string, currentIndex: number, isShiftClick: boolean) => {
    const newSelected = new Set(selectedProjects);
    
    // Shift+Click range selection
    if (isShiftClick && lastClickedIndex !== null) {
      // Range: lastClickedIndex + 1'den currentIndex'e kadar (dahil)
      const rangeStart = Math.min(lastClickedIndex, currentIndex);
      const rangeEnd = Math.max(lastClickedIndex, currentIndex);
      
      // Son tıklananın bir sonrasından başla, yeni tıklanana kadar toggle et
      for (let i = rangeStart + 1; i <= rangeEnd; i++) {
        const rangeProjectId = cachedProjects[i].id;
        if (newSelected.has(rangeProjectId)) {
          newSelected.delete(rangeProjectId);
        } else {
          newSelected.add(rangeProjectId);
        }
      }
    } else {
      // Normal toggle - sadece tıklanan item
      if (newSelected.has(projectId)) {
        newSelected.delete(projectId);
      } else {
        newSelected.add(projectId);
      }
    }
    
    setSelectedProjects(newSelected);
    setLastClickedIndex(currentIndex);
  };

  const isAllSelected = cachedProjects.length > 0 && selectedProjects.size === cachedProjects.length;
  const isIndeterminate = selectedProjects.size > 0 && selectedProjects.size < cachedProjects.length;

  // Clear single project cache
  const clearSingleProjectCache = async (projectId: string, projectName: string) => {
    try {
      setIsClearingCache(true);
      addLog('info', `"${projectName}" projesi cache'i temizleniyor...`, 'Cache');
      
      const response = await fetch(`/api/cache/${projectId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Cache temizleme başarısız');
      }

      addLog('success', `"${projectName}" projesi cache'i temizlendi`, 'Cache');
      
      // Reload cached projects
      const reloadResponse = await fetch('/api/cache/projects');
      if (reloadResponse.ok) {
        let projects = await reloadResponse.json();

        // Apply sorting
        projects = [...projects].sort((a, b) => {
          const aVal = a.totalBuilds || 0;
          const bVal = b.totalBuilds || 0;
          if (aVal !== bVal) {
            return sortOptions.direction === 'desc' ? bVal - aVal : aVal - bVal;
          }
          return (a.name || '').localeCompare(b.name || '');
        });

        setCachedProjects(projects);
      }
      
      setOpenMenuId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      addLog('error', `Cache temizleme hatası: ${message}`, 'Cache');
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleSortToggle = (field: 'totalBuilds') => {
    setSortOptions(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Clear multiple projects cache
  const clearSelectedProjectsCache = async () => {
    if (selectedProjects.size === 0) return;

    try {
      setIsClearingCache(true);
      addLog('info', `${selectedProjects.size} proje cache'i temizleniyor...`, 'Cache');
      
      const response = await fetch('/api/cache/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectIds: Array.from(selectedProjects)
        })
      });

      if (!response.ok) {
        throw new Error('Bulk cache temizleme başarısız');
      }

      addLog('success', `${selectedProjects.size} proje cache'i temizlendi`, 'Cache');
      
      // Reload cached projects
      const reloadResponse = await fetch('/api/cache/projects');
      if (reloadResponse.ok) {
        const projects = await reloadResponse.json();
        setCachedProjects(projects);
      }
      
      setSelectedProjects(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      addLog('error', `Bulk cache temizleme hatası: ${message}`, 'Cache');
    } finally {
      setIsClearingCache(false);
    }
  };

  // Delete all builds for a project → job olarak sıraya alınır
  const deleteAllBuilds = async (projectId: string, projectName: string) => {
    try {
      setIsDeletingBuilds(true);
      setOpenMenuId(null);
      const job = await createJob('delete_builds', { projectId, projectName, updateCache: true });
      if (job) {
        addLog('success', `"${projectName}" için artifact silme işi sıraya alındı. İlerleme "Jobs" panelinde.`, 'DeleteBuilds');
      }
    } finally {
      setIsDeletingBuilds(false);
      setShowDeleteConfirm(null);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '100%', margin: '0 auto' }}>
      {/* Confirmation Dialog */}
      {showDeleteConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '8px',
            maxWidth: '500px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <h3 style={{ marginTop: 0, color: '#dc3545' }}>⚠️ Remove All Builds</h3>
            <p style={{ marginBottom: '20px' }}>
              <strong>{showDeleteConfirm.projectName}</strong> projesinin TÜM build artifact'leri Unity Cloud Build'den 
              kalıcı olarak silinecek.
            </p>
            <div style={{
              backgroundColor: '#fff3cd',
              padding: '15px',
              borderRadius: '4px',
              marginBottom: '20px',
              border: '1px solid #ffc107'
            }}>
              <p style={{ margin: 0, fontSize: '14px' }}>
                <strong>DİKKAT:</strong> Bu işlem geri alınamaz! Build metadata'ları Unity'de kalacak, 
                ancak tüm artifact dosyaları (APK, IPA, vb.) silinecektir.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                disabled={isDeletingBuilds}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isDeletingBuilds ? 'not-allowed' : 'pointer',
                  fontSize: '14px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteAllBuilds(showDeleteConfirm.projectId, showDeleteConfirm.projectName)}
                disabled={isDeletingBuilds}
                style={{
                  padding: '10px 20px',
                  backgroundColor: isDeletingBuilds ? '#ccc' : '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isDeletingBuilds ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                {isDeletingBuilds ? 'Deleting...' : 'DELETE ARTIFACTS'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Unity Cloud Build Dashboard</h1>
        <button
          onClick={clearCredentials}
          style={{
            padding: '8px 16px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Reset Credentials
        </button>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        {/* Left Column - Dashboard (2/3) */}
        <div style={{ flex: 2, minWidth: 0 }}>
          {/* Config Info */}
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '15px',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            <h3>Configuration</h3>
            <p><strong>Organization ID:</strong> {config.orgId}</p>
            <p><strong>API Key:</strong> {config.apiKey.slice(0, 8)}***</p>
            {config.limitProjects && <p><strong>Project Limit:</strong> {config.limitProjects}</p>}
            {config.limitTargets && <p><strong>Target Limit:</strong> {config.limitTargets}</p>}
          </div>

          {/* Scan Controls */}
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '15px',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            <div style={{
              display: 'flex',
              gap: '15px',
              alignItems: 'center',
              marginBottom: '15px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <label htmlFor="limitProjects" style={{ fontWeight: 'bold', minWidth: '120px' }}>
                  Project Limit:
                </label>
                <input
                  id="limitProjects"
                  type="number"
                  min="1"
                  max="1000"
                  value={limitProjects || ''}
                  onChange={(e) => setLimitProjects(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="Boş = tümü"
                  disabled={isScanning}
                  style={{
                    width: '120px',
                    padding: '8px',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                  }}
                />
                <span style={{ color: '#666', fontSize: '14px' }}>
                  (boş bırakılırsa tüm projeler taranır)
                </span>
              </div>
            </div>
            
            <div style={{
              display: 'flex',
              gap: '10px'
            }}>
              <button
                onClick={startScan}
                disabled={isScanning}
                style={{
                  padding: '12px 24px',
                  backgroundColor: isScanning ? '#ccc' : '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isScanning ? 'not-allowed' : 'pointer',
                  fontSize: '16px'
                }}
              >
                {isScanning ? (activeScan?.status === 'queued' ? 'Full Scan Sırada...' : 'Full Scan Çalışıyor...') : 'Start Full Scan'}
              </button>
              {isScanning && (
                <button
                  onClick={cancelScan}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  Cancel Scan
                </button>
              )}
            </div>
          </div>

          {/* Jobs */}
          <JobsPanel
            jobs={jobs}
            isLoading={isLoadingJobs}
            isConnected={isConnected}
            onCancel={cancelJob}
            onResume={resumeJob}
          />

          {/* Cached Projects List */}
          {!isLoadingCache && cachedProjects.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3>Cached Projects ({cachedProjects.length})</h3>
                {selectedProjects.size > 0 && (
                  <button
                    onClick={clearSelectedProjectsCache}
                    disabled={isClearingCache}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: isClearingCache ? '#ccc' : '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: isClearingCache ? 'not-allowed' : 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    {isClearingCache ? 'Temizleniyor...' : `Clear Selected (${selectedProjects.size})`}
                  </button>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '12px', textAlign: 'center', border: '1px solid #ddd', width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate = isIndeterminate;
                          }
                        }}
                        onChange={toggleSelectAll}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Project Name</th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Platforms</th>
                    <th 
                      style={{ 
                        padding: '12px', 
                        textAlign: 'left', 
                        border: '1px solid #ddd',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }} 
                      onClick={() => handleSortToggle('totalBuilds')}
                      title="Click to sort by Total Builds"
                    >
                      Total Builds
                      {sortOptions.field === 'totalBuilds' && (
                        <span style={{ marginLeft: '5px', fontSize: '12px' }}>
                          {sortOptions.direction === 'desc' ? '↓' : '↑'}
                        </span>
                      )}
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Last Scanned</th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'center', border: '1px solid #ddd', width: '60px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cachedProjects.map((project: any, index: number) => (
                    <tr key={project.id}>
                      <td style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedProjects.has(project.id)}
                          onChange={() => {}}
                          onClick={(e) => {
                            toggleSelectProject(project.id, index, e.shiftKey);
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>{project.name}</td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                        {project.platforms && project.platforms.length > 0 
                          ? project.platforms.join(', ') 
                          : '-'}
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'center' }}>
                        {project.totalBuilds || 0}
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                        {project.lastScannedAt ? new Date(project.lastScannedAt).toLocaleString('tr-TR') : 'N/A'}
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '12px',
                          backgroundColor: '#d4edda',
                          color: '#155724'
                        }}>
                          CACHED
                        </span>
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #ddd', textAlign: 'center', position: 'relative' }}>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === project.id ? null : project.id)}
                          disabled={isClearingCache}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'transparent',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            cursor: isClearingCache ? 'not-allowed' : 'pointer',
                            fontSize: '16px'
                          }}
                          title="Actions"
                        >
                          ⚙️
                        </button>
                        {openMenuId === project.id && (
                          <div
                            style={{
                              position: 'absolute',
                              right: '10px',
                              top: '40px',
                              backgroundColor: 'white',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                              zIndex: 1000,
                              minWidth: '180px'
                            }}
                          >
                            <button
                              onClick={() => {
                                setShowDeleteConfirm({ projectId: project.id, projectName: project.name });
                                setOpenMenuId(null);
                              }}
                              disabled={isDeletingBuilds}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                backgroundColor: 'white',
                                border: 'none',
                                borderBottom: '1px solid #eee',
                                textAlign: 'left',
                                cursor: isDeletingBuilds ? 'not-allowed' : 'pointer',
                                fontSize: '14px',
                                color: '#ff4444',
                                fontWeight: 'bold'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fff5f5'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                            >
                              🗑️ Remove All Builds
                            </button>
                            <button
                              onClick={() => clearSingleProjectCache(project.id, project.name)}
                              disabled={isClearingCache}
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                backgroundColor: 'white',
                                border: 'none',
                                textAlign: 'left',
                                cursor: isClearingCache ? 'not-allowed' : 'pointer',
                                fontSize: '14px',
                                color: '#dc3545'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                            >
                              Clear Cache
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isLoadingCache && (
            <div style={{
              backgroundColor: '#f8f9fa',
              padding: '15px',
              borderRadius: '4px',
              marginBottom: '20px'
            }}>
              <p>Cache yükleniyor...</p>
            </div>
          )}

          {!isLoadingCache && cachedProjects.length === 0 && (
            <div style={{
              backgroundColor: '#fff3cd',
              padding: '15px',
              borderRadius: '4px',
              marginBottom: '20px',
              border: '1px solid #ffc107'
            }}>
              <p>Henüz cache'lenmiş proje yok. Scan başlatarak projeleri cache'leyin.</p>
            </div>
          )}

          {/* Last Full Scan Summary */}
          {scanResults && (
            <div style={{ marginBottom: '20px' }}>
              <h3>Son Full Scan Özeti <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>({lastScan?.finishedAt ? new Date(lastScan.finishedAt).toLocaleString('tr-TR') : ''})</span></h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '15px',
                marginBottom: '20px'
              }}>
                <div style={{ backgroundColor: '#d4edda', padding: '15px', borderRadius: '4px' }}>
                  <h4>Total Projects</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.totalProjects}</p>
                </div>
                <div style={{ backgroundColor: '#cce5ff', padding: '15px', borderRadius: '4px' }}>
                  <h4>Total Builds</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.totalBuilds}</p>
                </div>
                <div style={{ backgroundColor: '#fff3cd', padding: '15px', borderRadius: '4px' }}>
                  <h4>Total Targets</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.totalTargets}</p>
                </div>
                <div style={{ backgroundColor: (scanResults.failedProjects?.length ?? 0) > 0 ? '#f8d7da' : '#d1ecf1', padding: '15px', borderRadius: '4px' }}>
                  <h4>Tamamlanamayan</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.failedProjects?.length ?? 0}</p>
                  {scanResults.passes > 1 && (
                    <p style={{ fontSize: '12px', margin: '4px 0 0 0', color: '#555' }}>{scanResults.passes} geçiş yapıldı</p>
                  )}
                </div>
              </div>

              {Array.isArray(scanResults.failedProjects) && scanResults.failedProjects.length > 0 && (
                <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '12px', borderRadius: '4px', marginBottom: '15px' }}>
                  <strong>Tüm denemelere rağmen tamamlanamayan projeler ({scanResults.failedProjects.length}):</strong>
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                    {scanResults.failedProjects.map((p) => (
                      <li key={p.projectId} style={{ marginBottom: '4px' }}>
                        <strong>{p.projectName}</strong> ({p.status})
                        {p.errors?.length > 0 && (
                          <span style={{ color: '#9b4a52' }}> - {p.errors.slice(0, 2).join('; ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: '8px 0 0 0', fontSize: '12px' }}>Jobs panelindeki &quot;Eksikleri tekrar dene&quot; ile yalnızca bu projeler yeniden taranır.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column - Log Panel (1/3) */}
        <div style={{ flex: 1, minWidth: '300px' }}>
          <LogPanel />
        </div>
      </div>
    </div>
  );
}

// Main App Component
function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing credentials
    const existingConfig = CredentialManager.getCredentials();
    setConfig(existingConfig);
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <h1>Unity Cloud Build Multi-Project Cleaner</h1>
        <p>Yükleniyor...</p>
      </div>
    );
  }

  return (
    <LogProvider>
      {config ? (
        <Dashboard config={config} />
      ) : (
        <SetupWizard onComplete={setConfig} />
      )}
    </LogProvider>
  );
}

export default App;
