# Job Sistemi

Uzun süren işler (full scan, artifact silme) **job** olarak sıraya alınır, ilerlemeleri
veritabanında tutulur ve servis kapanıp açılsa bile kaldığı yerden devam eder.

## Neden

- Full scan 250+ proje ve Unity rate limit beklemeleriyle saatler sürebilir; tarayıcı
  sekmesine bağlı bir SSE isteği bunu taşıyamaz.
- Aynı anda birden fazla iş Unity API'yi yoklayınca abuse detection tetikleniyor;
  işler **sıralı** çalışmalı.
- Servis yeniden başlayınca yarım kalan iş kaybolmamalı.

## Veri Modeli (`prisma/schema.prisma`)

```
Job
  id, type ("full_scan" | "delete_builds"), status, title
  params   JSON { orgId, limitProjects?, limitTargets?, projectId?, projectName?, updateCache? }
  progress JSON { total, done, failed, currentName?, pass?, maxPasses?, phase?, waitingUntil? }
  result   JSON (bitince özet), error
  createdAt, startedAt, updatedAt, finishedAt

JobItem  (iş birimi: full_scan → proje, delete_builds → build target)
  jobId, kind, refId, name, status, attempts, error, result
  @@unique([jobId, refId])
```

**API key veritabanına yazılmaz.** Sadece runner belleğinde tutulur, iş bitince silinir.

## Durumlar

| Job status    | Anlamı |
|---------------|--------|
| `queued`      | Sırada; önündeki iş bitince başlar |
| `running`     | Çalışıyor; `progress.phase` ne yaptığını söyler ("Taranıyor", "Rate limit: 5 dk bekleniyor (3/10)", "Cache yenileniyor") |
| `interrupted` | Servis kapandı; `resume` ile kaldığı yerden devam eder |
| `completed`   | Bitti. `progress.failed > 0` ise eksik item var; "Eksikleri tekrar dene" yalnızca onları işler |
| `failed`      | Ölümcül hata: rate limit beklemeleri tükendi veya API key geçersiz (401) |
| `cancelled`   | Kullanıcı iptal etti |

Item status: `pending | running | completed | partial | failed | cancelled`.

## Akış

```
Dashboard "Start Full Scan" / "DELETE ARTIFACTS"
    ↓
POST /api/jobs { type, params, credentials }
    ├─ Job (queued) + credentials runner belleğine
    └─ 202 { job }
    ↓
JobRunner.work()  (tek işçi, sıralı)
    ├─ Job → running
    ├─ full_scan:   ScanOrchestrator.startScan(options, hooks)
    │     onProjectsListed → JobItem'lar oluşturulur (ilk çalıştırmada)
    │     onProjectStart   → item running, progress.currentName
    │     onProjectResult  → item completed/partial/failed, progress.done/failed
    │     onWait           → progress.phase = "Rate limit: ... bekleniyor", waitingUntil
    │     onPassCooldown   → progress.phase = "Geçiş N öncesi soğuma"
    ├─ delete_builds: UnityCloudBuildService.deleteAllBuildsForProject(projectId, { skipTargetIds, hooks })
    │     onTargetsListed / onTargetStart / onTargetDone → item'lar
    │     sonra cache temizlenir ve proje scanSingleProject ile yeniden taranır
    └─ Job → completed | failed | cancelled, result yazılır
    ↓
Her adımda JobEventBus.emit({ kind: 'job' | 'log' })
    ↓
GET /api/jobs/events (SSE, EventSource)
    ├─ backlog: son 300 log (geç bağlanan sekme için)
    ├─ log:     canlı log → LogPanel
    └─ job:     JobRecord → JobsPanel (ilerleme çubuğu, aşama, geri sayım)
```

## Servis Yeniden Başlayınca

```
İlk API isteği → JobRunner.boot()
    ├─ status running/queued olan job'lar → interrupted
    └─ status running olan item'lar → pending
    ↓
Dashboard açılır → useJobs
    ├─ GET /api/jobs
    └─ interrupted job'lar için POST /api/jobs/[id]/resume { credentials }  (localStorage'dan)
    ↓
JobRunner.resume()
    ├─ tamamlanmamış item'lar → pending
    ├─ job → queued → running
    └─ full_scan: yalnızca tamamlanmamış projeler ScanOptions.projects ile taranır
       delete_builds: tamamlanmış target'lar skipTargetIds ile atlanır
```

Dashboard kapalıyken iş otomatik devam **etmez** (API key sunucuda yok); açıldığı an devam eder.
Birden fazla sekme açıksa ilk resume kazanır, diğerleri 409 alır (log'da info).

## API

| Endpoint | Açıklama |
|----------|----------|
| `GET /api/jobs` | Son 50 job + `runningJobId` |
| `POST /api/jobs` | Yeni job: `{ type, params, credentials }` → 202 |
| `GET /api/jobs/[id]` | Job + item listesi |
| `POST /api/jobs/[id]/cancel` | Çalışan: bekleme en geç 1 sn'de kesilir. Sıradaki: sıradan çıkar |
| `POST /api/jobs/[id]/resume` | `{ credentials }` ile kaldığı yerden devam |
| `GET /api/jobs/events` | SSE: backlog, log, job |

Eski `POST /api/scan` ve `DELETE .../delete-builds` rotaları kaldırıldı; UI yalnızca job API'sini kullanır.

## Dosyalar

- `src/types/jobs.ts` – tipler, `isActive`, `isResumable`
- `src/modules/jobs/job-store.ts` – Prisma CRUD
- `src/modules/jobs/job-events.ts` – süreç içi olay yayını (globalThis)
- `src/modules/jobs/job-runner.ts` – kuyruk, çalıştırma, resume, cancel (globalThis singleton)
- `src/app/api/jobs/**` – rotalar
- `src/hooks/useJobs.ts` – client: liste, SSE, otomatik resume
- `src/components/JobsPanel.tsx` – UI
