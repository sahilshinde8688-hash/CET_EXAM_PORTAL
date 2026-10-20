import { useCallback, useEffect, useState } from 'react'
import { Database, FileArchive, RefreshCw, HardDrive, Hash } from 'lucide-react'
import { superAdminAPI, type StorageOptimizationMetrics } from '../lib/api'
import '../storageOptimization.css'

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(2)} ${units[unit]}`
}

export default function StorageOptimizationDashboard() {
  const [metrics, setMetrics] = useState<StorageOptimizationMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await superAdminAPI.getStorageOptimization()
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Storage metrics were not returned.')
      }
      setMetrics(response.data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load storage metrics.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMetrics()
  }, [loadMetrics])

  return (
    <section className="storage-optimization">
      <header className="storage-optimization-header">
        <div>
          <h1>Storage Optimization</h1>
          <p>Measured PostgreSQL and Supabase Storage usage. No records are changed by this view.</p>
        </div>
        <button type="button" onClick={() => void loadMetrics()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'storage-refreshing' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="storage-error" role="alert">{error}</div>}
      {loading && !metrics && <p className="storage-status">Loading measured storage data…</p>}

      {metrics && (
        <>
          <div className="storage-metric-cards">
            <article>
              <Database size={20} />
              <span>Database size</span>
              <strong>{formatBytes(metrics.databaseBytes)}</strong>
            </article>
            <article>
              <HardDrive size={20} />
              <span>Storage object bytes</span>
              <strong>{formatBytes(metrics.storageBytes)}</strong>
            </article>
            <article>
              <FileArchive size={20} />
              <span>Storage objects</span>
              <strong>{metrics.storageObjectCount.toLocaleString()}</strong>
              <small>{metrics.sizeTrackedObjects.toLocaleString()} with measured size metadata</small>
            </article>
            <article>
              <Hash size={20} />
              <span>SHA-256 duplicate files</span>
              <strong>{metrics.sha256TrackedObjects
                ? metrics.duplicateObjects.toLocaleString()
                : 'Not measured'}</strong>
              <small>{metrics.sha256TrackedObjects.toLocaleString()} objects have SHA-256 metadata</small>
            </article>
          </div>

          <div className="storage-info">
            <strong>Limits and savings are not reported as numbers.</strong>
            Supabase plan quotas and historical pre-deployment measurements are not
            available from these database metrics. Compression jobs and estimated
            savings are not tracked by the current upload pipeline.
          </div>

          <div className="storage-grid">
            <section className="storage-card">
              <h2>Largest public tables</h2>
              <div className="storage-table-wrap">
                <table>
                  <thead><tr><th>Table</th><th>Relation size</th><th>Approx. rows</th></tr></thead>
                  <tbody>
                    {metrics.tables.map(table => (
                      <tr key={table.tableName}>
                        <td>{table.tableName}</td>
                        <td>{formatBytes(table.bytes)}</td>
                        <td>{table.approximateRows.toLocaleString()}</td>
                      </tr>
                    ))}
                    {!metrics.tables.length && <tr><td colSpan={3}>No public tables measured.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="storage-card">
              <h2>Storage by bucket</h2>
              <div className="storage-table-wrap">
                <table>
                  <thead><tr><th>Bucket</th><th>Size</th><th>Objects</th></tr></thead>
                  <tbody>
                    {metrics.buckets.map(bucket => (
                      <tr key={bucket.bucketId}>
                        <td>{bucket.bucketId}</td>
                        <td>{formatBytes(bucket.bytes)}</td>
                        <td>{bucket.objectCount.toLocaleString()}</td>
                      </tr>
                    ))}
                    {!metrics.buckets.length && <tr><td colSpan={3}>No Storage objects measured.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="storage-card">
              <h2>Largest files</h2>
              <div className="storage-table-wrap">
                <table>
                  <thead><tr><th>Bucket / path</th><th>Size</th></tr></thead>
                  <tbody>
                    {metrics.largestFiles.map(file => (
                      <tr key={`${file.bucketId}/${file.path}`}>
                        <td><span>{file.bucketId}</span><code>{file.path}</code></td>
                        <td>{formatBytes(file.bytes)}</td>
                      </tr>
                    ))}
                    {!metrics.largestFiles.length && <tr><td colSpan={2}>No sized files measured.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="storage-card">
              <h2>Storage history</h2>
              <div className="storage-table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Database</th><th>Storage</th></tr></thead>
                  <tbody>
                    {metrics.history.map(snapshot => (
                      <tr key={snapshot.snapshot_date}>
                        <td>{snapshot.snapshot_date}</td>
                        <td>{formatBytes(snapshot.database_bytes)}</td>
                        <td>{formatBytes(snapshot.storage_bytes)}</td>
                      </tr>
                    ))}
                    {!metrics.history.length && <tr><td colSpan={3}>A baseline will be recorded when metrics are first loaded.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <p className="storage-measured-at">
            Measured {new Date(metrics.measuredAt).toLocaleString()}
            {' · '}Database row counts are PostgreSQL planner estimates.
            {' · '}Files without size metadata are excluded from byte totals.
            {' · '}History is sampled when this view is opened; missing dates are not zero-growth readings.
          </p>
        </>
      )}
    </section>
  )
}
