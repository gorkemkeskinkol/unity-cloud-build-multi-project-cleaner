'use client';

import { useState, useEffect } from 'react';
import { CredentialManager } from '@/modules/config/credential-manager';
import { LogProvider, useLog } from '@/contexts/LogContext';
import { AppConfig } from '@/types';

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
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any>(null);
  const [limitProjects, setLimitProjects] = useState<number | undefined>(undefined); // Default boş
  const [cachedProjects, setCachedProjects] = useState<any[]>([]);
  const [isLoadingCache, setIsLoadingCache] = useState(true);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const { addLog } = useLog();

  // Load cached projects on mount
  useEffect(() => {
    const loadCachedProjects = async () => {
      try {
        setIsLoadingCache(true);
        const response = await fetch('/api/cache/projects');
        if (response.ok) {
          const projects = await response.json();
          setCachedProjects(projects);
        }
      } catch (error) {
        console.error('Failed to load cached projects:', error);
      } finally {
        setIsLoadingCache(false);
      }
    };

    loadCachedProjects();
  }, []);

  // Reload cached projects after successful scan
  useEffect(() => {
    if (scanResults && !isScanning) {
      const reloadCache = async () => {
        try {
          const response = await fetch('/api/cache/projects');
          if (response.ok) {
            const projects = await response.json();
            setCachedProjects(projects);
          }
        } catch (error) {
          console.error('Failed to reload cached projects:', error);
        }
      };
      reloadCache();
    }
  }, [scanResults, isScanning]);

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
    // Double-click guard
    if (isScanning) {
      addLog('warning', 'Zaten bir scan işlemi devam ediyor', 'Dashboard');
      return;
    }

    try {
      setScanResults(null);
      setIsScanning(true);
      addLog('info', 'Scan başlatılıyor (server-side SSE)...', 'Dashboard');
      
      // SSE için fetch isteği yap
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          credentials: config,
          limitProjects: limitProjects,
          limitTargets: config.limitTargets,
          cacheMaxAgeMs: 3600000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Scan API hatası');
      }

      if (!response.body) {
        throw new Error('Response body yok');
      }

      // SSE stream'ini oku
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        // Buffer'a yeni veriyi ekle
        buffer += decoder.decode(value, { stream: true });
        
        // Satırları ayır
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Son satırı buffer'da tut (eksik olabilir)

        for (const line of lines) {
          if (line.startsWith('event:')) {
            // Event type'ı oku
            const eventType = line.substring(6).trim();
            continue;
          }
          
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.substring(5).trim());
              
              // Event'e göre işle
              if (line.includes('"level"')) {
                // Log event'i
                addLog(data.level, data.message, data.source);
              } else if (line.includes('"summary"')) {
                // Complete event'i
                setScanResults({
                  results: data.results,
                  summary: data.summary
                });
                addLog('success', `Scan tamamlandı! ${data.summary.totalBuilds} build bulundu (${data.summary.cachedProjects} cache, ${data.summary.freshProjects} yeni).`, 'Dashboard');
              } else if (line.includes('"message"') && !line.includes('"level"')) {
                // Error event'i
                addLog('error', `Scan hatası: ${data.message}`, 'Dashboard');
              }
            } catch (e) {
              console.error('SSE parse error:', e, line);
            }
          }
        }
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      addLog('error', `Scan hatası: ${message}`, 'Dashboard');
    } finally {
      setIsScanning(false);
    }
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
        const projects = await reloadResponse.json();
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

  return (
    <div style={{ padding: '20px', maxWidth: '100%', margin: '0 auto' }}>
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
                {isScanning ? 'Scanning (Server-Side)...' : 'Start Project Scan'}
              </button>
            </div>
          </div>

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
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Total Builds</th>
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
                              minWidth: '150px'
                            }}
                          >
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
                              🗑️ Clear Cache
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

          {/* Scanning Indicator */}
          {isScanning && (
            <div style={{
              backgroundColor: '#fff3cd',
              padding: '15px',
              borderRadius: '4px',
              marginBottom: '20px',
              border: '1px solid #ffc107'
            }}>
              <h4>⏳ Scan İşleniyor (Server-Side)</h4>
              <p>Projeler server-side taranıyor ve cache'leniyor. Lütfen bekleyin...</p>
              <p style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>
                Log panelinde detaylı ilerleme görebilirsiniz.
              </p>
            </div>
          )}

          {/* Scan Results */}
          {scanResults && (
            <div style={{ marginBottom: '20px' }}>
              <h3>Scan Results</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '15px',
                marginBottom: '20px'
              }}>
                <div style={{ backgroundColor: '#d4edda', padding: '15px', borderRadius: '4px' }}>
                  <h4>Total Projects</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.summary.totalProjects}</p>
                </div>
                <div style={{ backgroundColor: '#cce5ff', padding: '15px', borderRadius: '4px' }}>
                  <h4>Total Builds</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.summary.totalBuilds}</p>
                </div>
                <div style={{ backgroundColor: '#fff3cd', padding: '15px', borderRadius: '4px' }}>
                  <h4>Total Targets</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.summary.totalTargets}</p>
                </div>
                <div style={{ backgroundColor: scanResults.summary.totalErrors > 0 ? '#f8d7da' : '#d1ecf1', padding: '15px', borderRadius: '4px' }}>
                  <h4>Errors</h4>
                  <p style={{ fontSize: '24px', margin: 0 }}>{scanResults.summary.totalErrors}</p>
                </div>
              </div>

              {/* Project Results Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Project</th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Total Builds</th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Targets</th>
                    <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResults.results.map((result: any, index: number) => (
                    <tr key={index}>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>{result.projectName}</td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>{result.totalBuilds}</td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                        {result.scannedTargets}/{result.targetCount}
                      </td>
                      <td style={{ padding: '12px', border: '1px solid #ddd' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '3px',
                          fontSize: '12px',
                          backgroundColor:
                            result.status === 'completed' ? '#d4edda' :
                            result.status === 'partial' ? '#fff3cd' : '#f8d7da',
                          color:
                            result.status === 'completed' ? '#155724' :
                            result.status === 'partial' ? '#856404' : '#721c24'
                        }}>
                          {result.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
