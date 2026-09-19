import * as XLSX from 'xlsx'
import type { AuthUser } from './api'

export interface ExportStudentOptions {
  batch?: string | number
  status?: string
  filename?: string
}

export function exportStudentsToExcel(
  students: AuthUser[],
  options: ExportStudentOptions = {}
) {
  const { batch, status, filename } = options

  // Filter students based on batch and status if provided
  let filtered = [...students]
  if (status && status !== 'All') {
    filtered = filtered.filter(s => (s.status || 'pending').toLowerCase() === status.toLowerCase())
  }
  if (batch && batch !== 'All') {
    filtered = filtered.filter(s => String(s.batch) === String(batch))
  }

  const formatStudentRow = (s: AuthUser) => {
    // Password display logic: show plain text temp password if available, or state
    let passwordDisplay = '••••••••'
    if (s.mhcetPassword) {
      passwordDisplay = s.mhcetPassword
    } else if (s.password && !s.password.startsWith('$2')) {
      passwordDisplay = s.password
    } else if (s.status === 'pending') {
      passwordDisplay = 'Pending Approval'
    }

    return {
      'Name of the student': s.name || '',
      'Email ID': s.email || '',
      'Student Unique No.': s.mhcetId || s._id || s.id || 'Pending',
      'Username': s.mhcetId || s.email || '',
      'Password': passwordDisplay,
      'Batch': s.batch ? `Batch ${s.batch}` : 'N/A',
      'Branch': s.branch || 'N/A',
      'Phone Number': s.phone || 'N/A',
      'Status': s.status ? (s.status.charAt(0).toUpperCase() + s.status.slice(1)) : 'Pending',
      'Registered Date': s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }) : 'N/A',
    }
  }

  const wb = XLSX.utils.book_new()

  const colWidths = [
    { wch: 26 }, // Name of the student
    { wch: 28 }, // Email ID
    { wch: 20 }, // Student Unique No.
    { wch: 20 }, // Username
    { wch: 18 }, // Password
    { wch: 14 }, // Batch
    { wch: 16 }, // Branch
    { wch: 16 }, // Phone Number
    { wch: 14 }, // Status
    { wch: 16 }, // Registered Date
  ]

  // If exporting a single specific batch
  if (batch && batch !== 'All') {
    const rows = filtered.map(formatStudentRow)
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [
      {
        'Name of the student': 'No students found for this batch',
        'Email ID': '',
        'Student Unique No.': '',
        'Username': '',
        'Password': '',
        'Batch': String(batch),
        'Branch': '',
        'Phone Number': '',
        'Status': '',
        'Registered Date': '',
      }
    ])
    ws['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, ws, `Batch ${batch}`)
  } else {
    // All Batches: master sheet + batch-wise tab sheets
    const masterRows = filtered.map(formatStudentRow)
    const wsMaster = XLSX.utils.json_to_sheet(masterRows)
    wsMaster['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, wsMaster, 'All Students')

    // Find all distinct batches present
    const batches = Array.from(new Set(students.map(s => s.batch).filter(Boolean))).sort()
    batches.forEach(b => {
      const batchStudents = filtered.filter(s => s.batch === b)
      if (batchStudents.length > 0) {
        const batchRows = batchStudents.map(formatStudentRow)
        const wsBatch = XLSX.utils.json_to_sheet(batchRows)
        wsBatch['!cols'] = colWidths
        XLSX.utils.book_append_sheet(wb, wsBatch, `Batch ${b}`)
      }
    })
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const defaultFilename = batch && batch !== 'All'
    ? `Students_Batch_${batch}_${dateStr}.xlsx`
    : `Students_Batchwise_${dateStr}.xlsx`

  XLSX.writeFile(wb, filename || defaultFilename)
}
